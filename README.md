# house-proto

Proof-of-concept CLI: a few numbers in, a rough 3D house massing out.

```bash
npm install
npm start -- --sqft 1800 --bedrooms 3 --floors 2
```

That writes `out/model.gltf`, starts a local server and opens a three.js
viewer in your browser (drag to orbit, scroll to zoom). Add `--no-open` to
only write the file. `npm test` runs the layout tests; `npm run typecheck`
runs the compiler.

Design and roadmap: [docs/PLAN.md](docs/PLAN.md).
