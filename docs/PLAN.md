# house-proto — plan

A proof-of-concept CLI that turns a few numbers (square footage, bedrooms,
floors) into a rough 3D house massing a prospective buyer can look at.
Small on purpose: every module below is swappable, none is "the product".

## Pipeline

```
CLI args  →  HouseSpec  →  Massing  →  glTF file  →  browser viewer (three.js)
            (validate)    (layout)    (export)       (look / later: interact)
```

- **HouseSpec** — the validated input: `{ sqft, bedrooms, floors }` (feet). The
  parameter list will grow. Adding a parameter touches spec.ts, massing.ts, and
  the flag table in cli.ts.
- **Massing** — pure geometry: a footprint per floor plus labeled room boxes
  (`{ label, x, y, z, w, d, h }`). No walls, doors or roof yet. All layout
  heuristics live here, so they are unit-testable without any 3D code.
- **Exporter** — Massing → glTF 2.0 JSON (embedded base64 buffer, one mesh
  per box, a color per room type). Nothing but geometry; any viewer can open it.
- **Viewer** — one static `index.html` loading three.js from a CDN, orbit
  controls, loads `model.gltf`. Served by a ~30-line Node http server the CLI
  starts; the CLI then opens the browser.

## First-cut heuristics (deliberately crude)

- Footprint per floor = `sqft / floors`; aspect 1.25:1, rounded to whole feet.
- Floor height 9 ft; floors stack.
- Bedrooms distributed across floors (upper floors first when `floors > 1`),
  each ~12×12 ft, laid in a row along one edge. Remaining area is
  living space, as one or two boxes per floor. Later: bathrooms, kitchen, garage, lot.
- Every box has a stable `id` (`bedroom-N`, `living-<level>`, `living-<level>-back`) and a `sqft`.
  `buildMassing(spec, overrides)` accepts per-bedroom `{ floor, sqft }` overrides (validated by
  `parseOverrides`); the house footprint and the per-floor tiling never change. A pinned bedroom always
  lands on its floor; the others fill the remaining capacity by the usual rule.
  An override pins only the fields it names (`applied` echoes only those keys).
- Sqft override: depth = min(sqrt(sqft), 0.6 x floor depth), width = sqft / row depth; all bedrooms on a floor
  share one row depth (the deepest request). If the row is too wide it shrinks auto bedrooms first (to 10 ft),
  then overridden ones, then everything uniformly. `Massing.applied` reports the floor/area each override
  really got, so a UI can snap its fields.

## Layout

```
src/
  cli.ts            parse args (node:util parseArgs), run pipeline, serve, open
  spec.ts           HouseSpec type, parse + validate
  massing.ts        HouseSpec → Massing (pure)
  export/gltf.ts    Massing → glTF JSON (pure)
  serve.ts          static server for viewer + out/, returns URL
  viewer/index.html three.js viewer (CDN importmap, no bundler)
test/               Vitest: massing + gltf
out/                generated model.gltf (gitignored)
```

Toolchain: Node 24 (nvm, `.nvmrc`), TypeScript, `tsx` to run, Vitest, npm.
No framework, no bundler.

## Tickets (foreman)

| # | Scope | Depends on |
|---|---|---|
| T1 | package.json, tsconfig, `spec.ts`, `massing.ts`, tests | — |
| T2 | `export/gltf.ts` + `cli.ts` wiring, gltf test | T1 |
| T3 | `viewer/index.html` + `serve.ts` | T1 |
| V  | Blind verification of the assembled CLI end-to-end | T2, T3 |

Run (once built): `npm start -- --sqft 1800 --bedrooms 3 --floors 2`
