// Static build for GitHub Pages: bundles the layout pipeline for the browser and emits a viewer that uses it.
//   npm run build  ->  docs/layout.js + docs/index.html
import { build as esbuild, type Plugin } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_MODULE_TAG = '<script type="module">';
const LAYOUT_TAG = '<script type="module" src="./layout.js"></script>\n';

// export/gltf.ts imports node:fs / node:path for writeGltf(), which the browser never calls. Resolve them to
// empty modules so tree-shaking drops writeGltf and the bundle carries no node: imports.
const stubNodeBuiltins: Plugin = {
  name: 'stub-node-builtins',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-stub' }));
    // Named exports keep esbuild quiet; they are only reachable from writeGltf, which is tree-shaken away.
    b.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents: 'export const mkdirSync = undefined, writeFileSync = undefined, dirname = undefined;',
      loader: 'js',
    }));
  },
};

export async function build(outDir: string = join(ROOT, 'docs')): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  await esbuild({
    entryPoints: [join(ROOT, 'src/browser-entry.ts')],
    outfile: join(outDir, 'layout.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
    plugins: [stubNodeBuiltins],
  });

  const html = readFileSync(join(ROOT, 'src/viewer/index.html'), 'utf8');
  const first = html.indexOf(MAIN_MODULE_TAG);
  if (first === -1 || html.indexOf(MAIN_MODULE_TAG, first + 1) !== -1) {
    throw new Error(`build: expected exactly one ${MAIN_MODULE_TAG} in src/viewer/index.html as the injection anchor`);
  }
  // Module scripts run in document order, so layout.js sets the global before the viewer's initial load.
  writeFileSync(join(outDir, 'index.html'), html.slice(0, first) + LAYOUT_TAG + html.slice(first));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
  console.log('built docs/index.html and docs/layout.js');
}
