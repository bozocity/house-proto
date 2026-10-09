import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toGltf, writeGltf } from '../src/export/gltf.ts';
import { buildMassing, type Box } from '../src/massing.ts';
import { parseSpec } from '../src/spec.ts';

const specs = [
  { sqft: 1800, bedrooms: 3, floors: 2 },
  { sqft: 1200, bedrooms: 0 },
  { sqft: 3000, bedrooms: 5, floors: 3 },
];

interface Gltf {
  asset: { version: string };
  extras: { spec: unknown; floorHeight: unknown; applied: unknown };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name: string; mesh: number; translation: number[]; extras: Record<string, unknown> }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: {
    name: string;
    alphaMode: string;
    doubleSided: boolean;
    pbrMetallicRoughness: { baseColorFactor: number[] };
  }[];
  accessors: { bufferView: number; count: number; min: number[]; max: number[] }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number }[];
  buffers: { byteLength: number; uri: string }[];
}

function build(raw: Parameters<typeof parseSpec>[0]) {
  const massing = buildMassing(parseSpec(raw));
  const boxes: Box[] = massing.floors.flatMap((f) => f.rooms);
  const json = JSON.parse(JSON.stringify(toGltf(massing))) as Gltf;
  return { massing, boxes, json };
}

describe('toGltf', () => {
  it.each(specs)('is valid glTF 2.0 JSON for %o', (raw) => {
    const { massing, json } = build(raw);
    expect(json.asset.version).toBe('2.0');
    expect(json.extras.spec).toEqual(massing.spec);
    expect(json.scenes[json.scene]?.nodes).toHaveLength(json.nodes.length);
  });

  it.each(specs)('has one node and mesh per box for %o', (raw) => {
    const { boxes, json } = build(raw);
    expect(json.nodes).toHaveLength(boxes.length);
    expect(json.meshes).toHaveLength(boxes.length);
    boxes.forEach((box, i) => {
      const node = json.nodes[i]!;
      expect(node.name).toBe(box.label);
      expect(node.mesh).toBe(i);
      expect(node.translation).toEqual([box.x, box.y, box.z]);
    });
  });

  it.each(specs)('accessor min/max match box extents for %o', (raw) => {
    const { boxes, json } = build(raw);
    boxes.forEach((box, i) => {
      const prim = json.meshes[i]!.primitives[0]!;
      const pos = json.accessors[prim.attributes.POSITION!]!;
      expect(pos.count).toBe(24);
      expect(pos.min).toEqual([0, 0, 0].map((v) => Math.fround(v)));
      [box.w, box.h, box.d].forEach((dim, a) => expect(pos.max[a]).toBeCloseTo(dim, 5));
      expect(json.accessors[prim.attributes.NORMAL!]!.count).toBe(24);
      expect(json.accessors[prim.indices]!.count).toBe(36);
    });
  });

  it.each(specs)('buffer byteLength matches decoded base64 and views fit for %o', (raw) => {
    const { json } = build(raw);
    const buf = json.buffers[0]!;
    expect(buf.uri.startsWith('data:application/octet-stream;base64,')).toBe(true);
    const decoded = Buffer.from(buf.uri.split(',')[1]!, 'base64');
    expect(buf.byteLength).toBe(decoded.length);
    for (const v of json.bufferViews) {
      expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(buf.byteLength);
    }
  });

  it('stored vertex data agrees with accessor bounds', () => {
    const { json } = build({ sqft: 1800, bedrooms: 3, floors: 2 });
    const decoded = Buffer.from(json.buffers[0]!.uri.split(',')[1]!, 'base64');
    const prim = json.meshes[0]!.primitives[0]!;
    const acc = json.accessors[prim.attributes.POSITION!]!;
    const view = json.bufferViews[acc.bufferView]!;
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < acc.count; v++) {
      for (let a = 0; a < 3; a++) hi[a] = Math.max(hi[a]!, decoded.readFloatLE(view.byteOffset + (v * 3 + a) * 4));
    }
    expect(hi).toEqual(acc.max);
  });

  it.each(specs)('materials cover every room kind used for %o', (raw) => {
    const { boxes, json } = build(raw);
    for (const kind of new Set(boxes.map((b) => b.kind))) {
      expect(json.materials.some((m) => m.name === kind)).toBe(true);
    }
    boxes.forEach((box, i) => {
      const mat = json.materials[json.meshes[i]!.primitives[0]!.material]!;
      expect(mat.name).toBe(box.kind);
      expect(mat.alphaMode).toBe('BLEND');
    });
  });

  it('makes every material translucent and double-sided', () => {
    const { json } = build({ sqft: 1800, bedrooms: 3, floors: 2 });
    expect(json.materials.length).toBeGreaterThan(0);
    for (const mat of json.materials) {
      expect(mat.alphaMode).toBe('BLEND');
      expect(mat.pbrMetallicRoughness.baseColorFactor[3]).toBe(0.35);
      expect(mat.doubleSided).toBe(true);
    }
  });

  it.each(specs)('node extras match the massing boxes for %o', (raw) => {
    const massing = buildMassing(parseSpec(raw));
    const expected = massing.floors.flatMap((f) =>
      f.rooms.map((b) => ({ id: b.id, kind: b.kind, level: f.level, sqft: b.sqft, label: b.label })),
    );
    const json = JSON.parse(JSON.stringify(toGltf(massing))) as Gltf;
    expect(json.nodes.map((n) => n.extras)).toEqual(expected);
    expect(new Set(expected.map((e) => e.id)).size).toBe(expected.length);
  });

  it('puts spec, floorHeight and applied overrides in the root extras', () => {
    const spec = parseSpec({ sqft: 1800, bedrooms: 3, floors: 2 });
    const massing = buildMassing(spec, { 'bedroom-2': { floor: 0, sqft: 150 } });
    const json = JSON.parse(JSON.stringify(toGltf(massing))) as Gltf;
    expect(json.extras).toEqual({ spec, floorHeight: massing.floorHeight, applied: massing.applied });
    expect(Object.keys(json.extras.applied as object)).toEqual(['bedroom-2']);
    expect(build({ sqft: 1200, bedrooms: 0 }).json.extras.applied).toEqual({});
  });
});

describe('writeGltf', () => {
  it('writes parseable JSON, creating the directory', () => {
    const massing = buildMassing(parseSpec({ sqft: 1800, bedrooms: 3, floors: 2 }));
    const file = join(mkdtempSync(join(tmpdir(), 'gltf-')), 'nested', 'model.gltf');
    writeGltf(massing, file);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Gltf;
    expect(parsed.asset.version).toBe('2.0');
  });
});
