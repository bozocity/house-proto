import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutToGltf, serve } from '../src/serve.ts';

interface GltfJson {
  extras: {
    spec: unknown;
    floorHeight: number;
    applied: Record<string, { floor: number; sqft: number }>;
    roof: { kind: string };
    footprint: { width: number; depth: number };
  };
  nodes: unknown[];
}

let base: string;
let close: () => void;

beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'serve-'));
  writeFileSync(join(outDir, 'model.gltf'), '{}');
  const s = await serve({ outDir, port: 0 });
  base = s.url;
  close = s.close;
});
afterAll(() => close());

function post(body: string, path = 'layout') {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

const spec = { sqft: 1800, bedrooms: 3, floors: 2 };

describe('POST /layout', () => {
  it('returns glTF JSON with applied overrides echoed', async () => {
    const res = await post(JSON.stringify({ spec, overrides: { 'bedroom-2': { floor: 0, sqft: 150 } } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = (await res.json()) as GltfJson;
    const expected = layoutToGltf({ spec, overrides: { 'bedroom-2': { floor: 0, sqft: 150 } } }) as GltfJson;
    expect(json.nodes).toHaveLength(expected.nodes.length);
    expect(json.extras.spec).toEqual({ ...spec, style: 'colonial' });
    expect(json.extras.applied['bedroom-2']?.floor).toBe(0);
    expect(json.extras).toEqual(JSON.parse(JSON.stringify(expected.extras)));
  });

  it('works without overrides and accepts string spec values', async () => {
    const res = await post(JSON.stringify({ spec: { sqft: '1200', bedrooms: '2' } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as GltfJson).extras.applied).toEqual({});
  });

  it('applies spec.style and defaults the rest', async () => {
    const res = await post(JSON.stringify({ spec: { style: 'ranch' } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as GltfJson;
    expect(json.extras.spec).toEqual({ sqft: 1800, bedrooms: 3, floors: 1, style: 'ranch' });
    expect(json.extras.roof.kind).toBe('gable');
    expect(json.extras.footprint).toEqual({ width: 60, depth: 30 });
  });

  it('400s on an unknown or non-string style', async () => {
    for (const style of ['gothic', 5]) {
      const res = await post(JSON.stringify({ spec: { sqft: 1800, bedrooms: 3, style } }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/style/);
    }
  });

  it('400s on a bad spec', async () => {
    for (const body of [{ spec: { sqft: 10, bedrooms: 2 } }, { spec: { sqft: {}, bedrooms: 2 } }, { spec: 5 }, {}, []]) {
      const res = await post(JSON.stringify(body));
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(typeof ((await res.json()) as { error: string }).error).toBe('string');
    }
  });

  it('400s on a bad overrides key', async () => {
    const res = await post(JSON.stringify({ spec, overrides: { 'kitchen-1': { sqft: 100 } } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/kitchen-1/);
  });

  it('400s on malformed JSON', async () => {
    const res = await post('{not json');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(((await res.json()) as { error: string }).error).toMatch(/JSON/);
  });

  it('413s when the body exceeds 64 KB', async () => {
    const res = await post(JSON.stringify({ spec, pad: 'x'.repeat(70 * 1024) }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/64|exceeds/);
  });

  it('rejects GET /layout with 405', async () => {
    const res = await fetch(`${base}layout`);
    expect(res.status).toBe(405);
  });
});

describe('static routes', () => {
  it('GET / still serves the viewer', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('GET /model.gltf still served', async () => {
    const res = await fetch(`${base}model.gltf`);
    expect(res.status).toBe(200);
  });

  it('404s a raw /../package.json path', async () => {
    const { port } = new URL(base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: Number(port), path: '/../package.json', method: 'GET' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it('404s a // network-path request', async () => {
    const { port } = new URL(base);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: Number(port), path: '//etc/passwd', method: 'GET' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(404);
  });
});
