// CLI: args -> HouseSpec -> Massing -> out/model.gltf -> viewer server -> browser.
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { writeGltf } from './export/gltf.ts';
import { buildMassing } from './massing.ts';
import { parseSpec } from './spec.ts';

const USAGE = `Usage: tsx src/cli.ts [--sqft <n>] [--bedrooms <n>] [--floors <n>] [--style <s>] [--out <dir>] [--no-open]

  --sqft <n>       total square footage (default: 1800)
  --bedrooms <n>   number of bedrooms (default: 3)
  --floors <n>     number of floors (optional; defaults by size)
  --style <s>      ranch | colonial | modern (default: colonial)
  --out <dir>      output directory (default: out)
  --no-open        write the model only; skip server and browser
  --help           show this help
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sqft: { type: 'string' },
      bedrooms: { type: 'string' },
      floors: { type: 'string' },
      style: { type: 'string' },
      out: { type: 'string', default: 'out' },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  const spec = parseSpec({ sqft: values.sqft, bedrooms: values.bedrooms, floors: values.floors, style: values.style });
  const massing = buildMassing(spec);
  const outDir = resolve(values.out ?? 'out');
  const file = join(outDir, 'model.gltf');
  writeGltf(massing, file);

  const rooms = massing.floors.reduce((n, f) => n + f.rooms.length, 0);
  console.log(
    `Wrote ${file} (${spec.sqft} sqft, ${spec.bedrooms} bedrooms, ${spec.floors} floors, ${spec.style}, ${rooms} boxes)`,
  );

  if (values['no-open']) return;

  const { serve } = await import('./serve.ts');
  const { url } = await serve({ outDir });
  console.log(`Viewer: ${url} (Ctrl+C to stop)`);
  execFile('open', [url], (err) => {
    if (err) console.error(`Could not open browser: ${err.message}`);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
