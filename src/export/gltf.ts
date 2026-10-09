// Exporter: Massing -> glTF 2.0 JSON (embedded base64 buffer). Pure except writeGltf. Units: feet, Y-up.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Box, Massing, RoomKind } from '../massing.ts';

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;

/** One PBR material per room kind. Order defines material indices. */
const MATERIALS: { kind: RoomKind; color: [number, number, number, number] }[] = [
  { kind: 'bedroom', color: [0.45, 0.58, 0.75, 1] },
  { kind: 'living', color: [0.87, 0.78, 0.62, 1] },
];

type V3 = [number, number, number];

/** Faces as [normal, 4 corners CCW seen from outside] in unit-cube coordinates (scaled by w,h,d). */
const FACES: { n: V3; c: V3[] }[] = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const POSITION_BYTES = 24 * 3 * 4;
const NORMAL_BYTES = 24 * 3 * 4;
const INDEX_BYTES = 36 * 2;
const BOX_BYTES = POSITION_BYTES + NORMAL_BYTES + INDEX_BYTES; // all 4-byte aligned

export function toGltf(m: Massing): object {
  const boxes: Box[] = m.floors.flatMap((f) => f.rooms);
  const buffer = Buffer.alloc(boxes.length * BOX_BYTES);

  const accessors: object[] = [];
  const bufferViews: object[] = [];
  const meshes: object[] = [];
  const nodes: object[] = [];

  boxes.forEach((box, i) => {
    const base = i * BOX_BYTES;
    const dims: V3 = [box.w, box.h, box.d];
    let pOff = base;
    let nOff = base + POSITION_BYTES;
    let iOff = base + POSITION_BYTES + NORMAL_BYTES;
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];

    FACES.forEach((face, fi) => {
      for (const corner of face.c) {
        for (let a = 0; a < 3; a++) {
          const v = Math.fround((corner[a] as number) * (dims[a] as number));
          buffer.writeFloatLE(v, pOff);
          pOff += 4;
          if (v < (min[a] as number)) min[a] = v;
          if (v > (max[a] as number)) max[a] = v;
        }
        for (let a = 0; a < 3; a++) {
          buffer.writeFloatLE(face.n[a] as number, nOff);
          nOff += 4;
        }
      }
      for (const k of [0, 1, 2, 0, 2, 3]) {
        buffer.writeUInt16LE(fi * 4 + k, iOff);
        iOff += 2;
      }
    });

    const viewBase = bufferViews.length;
    bufferViews.push(
      { buffer: 0, byteOffset: base, byteLength: POSITION_BYTES, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: base + POSITION_BYTES, byteLength: NORMAL_BYTES, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: base + POSITION_BYTES + NORMAL_BYTES, byteLength: INDEX_BYTES, target: ELEMENT_ARRAY_BUFFER },
    );
    const accBase = accessors.length;
    accessors.push(
      { bufferView: viewBase, componentType: FLOAT, count: 24, type: 'VEC3', min, max },
      { bufferView: viewBase + 1, componentType: FLOAT, count: 24, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: viewBase + 2, componentType: UNSIGNED_SHORT, count: 36, type: 'SCALAR', min: [0], max: [23] },
    );
    const material = MATERIALS.findIndex((mat) => mat.kind === box.kind);
    meshes.push({
      name: box.label,
      primitives: [{ attributes: { POSITION: accBase, NORMAL: accBase + 1 }, indices: accBase + 2, material, mode: TRIANGLES }],
    });
    nodes.push({ name: box.label, mesh: i, translation: [box.x, box.y, box.z] });
  });

  return {
    asset: { version: '2.0', generator: 'house-proto' },
    extras: { spec: m.spec },
    scene: 0,
    scenes: [{ name: 'House', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: MATERIALS.map(({ kind, color }) => ({
      name: kind,
      pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.9 },
      alphaMode: 'OPAQUE',
    })),
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: buffer.length,
        uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
      },
    ],
  };
}

export function writeGltf(m: Massing, filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(toGltf(m)));
}
