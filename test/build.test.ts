import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '../scripts/build.ts';

describe('static build', () => {
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'house-build-'));
    await build(dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes layout.js and index.html', () => {
    expect(existsSync(join(dir, 'layout.js'))).toBe(true);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('layout.js has no node: imports or require()', () => {
    const js = readFileSync(join(dir, 'layout.js'), 'utf8');
    expect(js).not.toMatch(/node:/);
    expect(js).not.toMatch(/require\(/);
    expect(js).not.toMatch(/\bBuffer\b/); // Node-only global; the bundle runs in browsers
  });

  it('index.html loads layout.js before the main module script', () => {
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    const tag = html.indexOf('<script type="module" src="./layout.js"></script>');
    const main = html.indexOf('<script type="module">');
    expect(tag).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(tag);
  });

  it('built bundle computes layouts and rejects bad specs', async () => {
    await import(pathToFileURL(join(dir, 'layout.js')).href);
    const fn = (globalThis as any).layoutToGltf;
    const gltf = fn({ spec: { sqft: 1800, bedrooms: 3, floors: 2 } });
    expect(gltf.nodes).toHaveLength(6);
    expect(gltf.extras.spec.style).toBe('colonial');
    expect(() => fn({ spec: { sqft: -5 } })).toThrowError(/sqft/);
    try {
      fn({ spec: { sqft: -5 } });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
