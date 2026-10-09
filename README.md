# house-proto

Proof-of-concept web tool: a homeowner enters square footage, bedrooms, floors
and a style, and gets a rough 3D house massing to look at and adjust.

```bash
npm install
npm start
```

That opens the viewer with a default house; change square footage, bedrooms,
floors and style in the page. Flags also work:

```bash
npm start -- --sqft 1800 --bedrooms 3 --floors 2 --style ranch
```

That writes `out/model.gltf`, starts a local server and opens a three.js
viewer in your browser (drag to orbit, scroll to zoom). Add `--no-open` to
only write the file. `npm test` runs the layout tests; `npm run typecheck`
runs the compiler.

A no-install version is published at https://bozocity.github.io/house-proto/ (built with `npm run build` into `docs/`).

Design and roadmap: [docs/PLAN.md](docs/PLAN.md).
