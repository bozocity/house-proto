// Browser bundle entry (see scripts/build.ts). Exposes the pure layout pipeline as a global so the static
// viewer (docs/index.html on GitHub Pages) can compute models in-page instead of calling /layout.
import { layoutToGltf } from './layout.ts';

(globalThis as any).layoutToGltf = layoutToGltf;
