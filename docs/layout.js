// src/export/gltf.ts
var FLOAT = 5126;
var UNSIGNED_SHORT = 5123;
var ARRAY_BUFFER = 34962;
var ELEMENT_ARRAY_BUFFER = 34963;
var TRIANGLES = 4;
var MATERIALS = [
  { kind: "bedroom", color: [0.45, 0.58, 0.75, 0.35] },
  { kind: "living", color: [0.87, 0.78, 0.62, 0.35] }
];
var FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
];
var POSITION_BYTES = 24 * 3 * 4;
var NORMAL_BYTES = 24 * 3 * 4;
var INDEX_BYTES = 36 * 2;
var BOX_BYTES = POSITION_BYTES + NORMAL_BYTES + INDEX_BYTES;
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = a << 16 | (b ?? 0) << 8 | (c ?? 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63];
    out += b === void 0 ? "=" : B64[n >> 6 & 63];
    out += c === void 0 ? "=" : B64[n & 63];
  }
  return out;
}
function toGltf(m) {
  const placed = m.floors.flatMap((f) => f.rooms.map((box) => ({ box, level: f.level })));
  const boxes = placed.map((p) => p.box);
  const bytes = new Uint8Array(boxes.length * BOX_BYTES);
  const view = new DataView(bytes.buffer);
  const accessors = [];
  const bufferViews = [];
  const meshes = [];
  const nodes = [];
  boxes.forEach((box, i) => {
    const base = i * BOX_BYTES;
    const dims = [box.w, box.h, box.d];
    let pOff = base;
    let nOff = base + POSITION_BYTES;
    let iOff = base + POSITION_BYTES + NORMAL_BYTES;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    FACES.forEach((face, fi) => {
      for (const corner of face.c) {
        for (let a = 0; a < 3; a++) {
          const v = Math.fround(corner[a] * dims[a]);
          view.setFloat32(pOff, v, true);
          pOff += 4;
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
        for (let a = 0; a < 3; a++) {
          view.setFloat32(nOff, face.n[a], true);
          nOff += 4;
        }
      }
      for (const k of [0, 1, 2, 0, 2, 3]) {
        view.setUint16(iOff, fi * 4 + k, true);
        iOff += 2;
      }
    });
    const viewBase = bufferViews.length;
    bufferViews.push(
      { buffer: 0, byteOffset: base, byteLength: POSITION_BYTES, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: base + POSITION_BYTES, byteLength: NORMAL_BYTES, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: base + POSITION_BYTES + NORMAL_BYTES, byteLength: INDEX_BYTES, target: ELEMENT_ARRAY_BUFFER }
    );
    const accBase = accessors.length;
    accessors.push(
      { bufferView: viewBase, componentType: FLOAT, count: 24, type: "VEC3", min, max },
      { bufferView: viewBase + 1, componentType: FLOAT, count: 24, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: viewBase + 2, componentType: UNSIGNED_SHORT, count: 36, type: "SCALAR", min: [0], max: [23] }
    );
    const material = MATERIALS.findIndex((mat) => mat.kind === box.kind);
    meshes.push({
      name: box.label,
      primitives: [{ attributes: { POSITION: accBase, NORMAL: accBase + 1 }, indices: accBase + 2, material, mode: TRIANGLES }]
    });
    nodes.push({
      name: box.label,
      mesh: i,
      translation: [box.x, box.y, box.z],
      extras: { id: box.id, kind: box.kind, level: placed[i].level, sqft: box.sqft, label: box.label }
    });
  });
  return {
    asset: { version: "2.0", generator: "house-proto" },
    extras: { spec: m.spec, floorHeight: m.floorHeight, applied: m.applied, roof: m.roof, footprint: m.footprint },
    scene: 0,
    scenes: [{ name: "House", nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials: MATERIALS.map(({ kind, color }) => ({
      name: kind,
      pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.9 },
      alphaMode: "BLEND",
      doubleSided: true
    })),
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: bytes.length,
        uri: `data:application/octet-stream;base64,${toBase64(bytes)}`
      }
    ]
  };
}

// src/massing.ts
var FLOOR_HEIGHT = 9;
var STYLE_TABLE = {
  ranch: { aspect: 2, kind: "gable", pitch: 4 / 12, overhang: 2, thickness: 0.5 },
  colonial: { aspect: 1.25, kind: "gable", pitch: 8 / 12, overhang: 1, thickness: 0.5 },
  modern: { aspect: 1.6, kind: "flat", pitch: 0, overhang: 1.5, thickness: 1 }
};
var BEDROOM_SIZE = 12;
var MIN_BEDROOM_SIZE = 10;
var MAX_BEDROOM_DEPTH_SHARE = 0.6;
var SLACK_EPS = 5e-3;
var MIN_OVERRIDDEN_WIDTH = 4;
function floor2(v) {
  return Math.floor(v * 100 + 1e-6) / 100;
}
function round2(v) {
  return Math.round(v * 100) / 100;
}
function area1(w, d) {
  return Math.round(w * d * 10) / 10;
}
function distributeBedrooms(total, floors, width, fixed) {
  const perFloorCap = Math.max(1, Math.floor(width / MIN_BEDROOM_SIZE));
  const counts = new Array(floors).fill(0);
  let remaining = total;
  for (let level = floors - 1; level >= 0 && remaining > 0; level--) {
    const n = Math.min(Math.max(0, perFloorCap - (fixed[level] ?? 0)), remaining);
    counts[level] = n;
    remaining -= n;
  }
  for (let level = floors - 1; remaining > 0; level = level === 0 ? floors - 1 : level - 1) {
    counts[level] = (counts[level] ?? 0) + 1;
    remaining--;
  }
  return counts;
}
function sizeRow(plans, floorWidth, floorDepth) {
  const cap = floorDepth * MAX_BEDROOM_DEPTH_SHARE;
  const n = plans.length;
  if (plans.every((p) => p.sqft === void 0)) {
    const scale = Math.min(1, floorWidth / (n * BEDROOM_SIZE), cap / BEDROOM_SIZE);
    const size = floor2(BEDROOM_SIZE * scale);
    return { rowDepth: size, widths: plans.map(() => size) };
  }
  const autoSize = Math.min(BEDROOM_SIZE, cap);
  const rowDepth = floor2(
    Math.max(...plans.map((p) => p.sqft === void 0 ? autoSize : Math.min(Math.sqrt(p.sqft), cap)))
  );
  const want = plans.map((p) => p.sqft === void 0 ? autoSize : p.sqft / rowDepth);
  const autoMin = Math.min(MIN_BEDROOM_SIZE, autoSize);
  const floors = plans.map(
    (p, i) => p.sqft === void 0 ? autoMin : Math.min(want[i], MIN_OVERRIDDEN_WIDTH)
  );
  const w = [...want];
  for (const wantAuto of [true, false]) {
    const deficit = w.reduce((a, v) => a + v, 0) - floorWidth;
    if (deficit <= 0) break;
    const idx = plans.map((p, i) => i).filter((i) => plans[i].sqft === void 0 === wantAuto);
    const room = idx.reduce((a, i) => a + (w[i] - floors[i]), 0);
    if (room <= 0) continue;
    const frac = Math.min(1, deficit / room);
    for (const i of idx) w[i] = w[i] - (w[i] - floors[i]) * frac;
  }
  const total = w.reduce((a, v) => a + v, 0);
  if (total > floorWidth) {
    const k = floorWidth / total;
    for (let i = 0; i < n; i++) w[i] = w[i] * k;
  }
  let widths = w.map(round2);
  if (widths.reduce((a, v) => a + v, 0) > floorWidth + 1e-9) widths = w.map(floor2);
  return { rowDepth, widths };
}
function buildMassing(spec, overrides = {}) {
  const area = spec.sqft / spec.floors;
  const style = STYLE_TABLE[spec.style];
  const depth = Math.max(1, Math.round(Math.sqrt(area / style.aspect)));
  const width = Math.max(1, Math.round(depth * style.aspect));
  const fixedLevel = /* @__PURE__ */ new Map();
  const requestedSqft = /* @__PURE__ */ new Map();
  const overridden = /* @__PURE__ */ new Map();
  for (let n = 1; n <= spec.bedrooms; n++) {
    const o = overrides[`bedroom-${n}`];
    if (!o) continue;
    overridden.set(n, { floor: "floor" in o, sqft: "sqft" in o });
    if (typeof o.floor === "number" && Number.isFinite(o.floor)) {
      fixedLevel.set(n, Math.min(spec.floors - 1, Math.max(0, Math.round(o.floor))));
    }
    if (typeof o.sqft === "number" && Number.isFinite(o.sqft) && o.sqft > 0) requestedSqft.set(n, o.sqft);
  }
  const fixedCounts = new Array(spec.floors).fill(0);
  for (const lvl of fixedLevel.values()) fixedCounts[lvl] = (fixedCounts[lvl] ?? 0) + 1;
  const freeNumbers = [];
  for (let n = 1; n <= spec.bedrooms; n++) if (!fixedLevel.has(n)) freeNumbers.push(n);
  const counts = distributeBedrooms(freeNumbers.length, spec.floors, width, fixedCounts);
  const byLevel = Array.from({ length: spec.floors }, () => []);
  for (const [n, lvl] of fixedLevel) byLevel[lvl].push(n);
  let next = 0;
  for (let level = 0; level < spec.floors; level++) {
    for (let i = 0; i < (counts[level] ?? 0); i++) byLevel[level].push(freeNumbers[next++]);
    byLevel[level].sort((a, b) => a - b);
  }
  const applied = {};
  const floors = [];
  for (let level = 0; level < spec.floors; level++) {
    const elevation = level * FLOOR_HEIGHT;
    const numbers = byLevel[level];
    const rooms = [];
    let bedroomDepth = 0;
    let rowEnd = 0;
    if (numbers.length > 0) {
      const plans = numbers.map((number) => ({ number, sqft: requestedSqft.get(number) }));
      const row = sizeRow(plans, width, depth);
      bedroomDepth = row.rowDepth;
      for (let i = 0; i < numbers.length; i++) {
        const number = numbers[i];
        const bw = row.widths[i];
        const box = {
          id: `bedroom-${number}`,
          label: `Bedroom ${number}`,
          kind: "bedroom",
          x: floor2(rowEnd),
          y: elevation,
          z: depth - bedroomDepth,
          w: bw,
          d: bedroomDepth,
          h: FLOOR_HEIGHT,
          sqft: area1(bw, bedroomDepth)
        };
        rooms.push(box);
        rowEnd += bw;
        const named = overridden.get(number);
        if (named) {
          const echo = {};
          if (named.floor) echo.floor = level;
          if (named.sqft) echo.sqft = box.sqft;
          applied[box.id] = echo;
        }
      }
    }
    const livingLabel = level === 0 ? "Living" : `Living (L${level + 1})`;
    const frontDepth = depth - bedroomDepth;
    rooms.push({
      id: `living-${level}`,
      label: livingLabel,
      kind: "living",
      x: 0,
      y: elevation,
      z: 0,
      w: width,
      d: frontDepth,
      h: FLOOR_HEIGHT,
      sqft: area1(width, frontDepth)
    });
    if (numbers.length > 0 && width - rowEnd > SLACK_EPS) {
      const slackW = width - rowEnd;
      rooms.push({
        id: `living-${level}-back`,
        label: livingLabel,
        kind: "living",
        x: rowEnd,
        y: elevation,
        z: depth - bedroomDepth,
        w: slackW,
        d: bedroomDepth,
        h: FLOOR_HEIGHT,
        sqft: area1(slackW, bedroomDepth)
      });
    }
    floors.push({ level, width, depth, elevation, rooms });
  }
  const roof = {
    kind: style.kind,
    pitch: style.pitch,
    overhang: style.overhang,
    ridgeAxis: width >= depth ? "x" : "z",
    thickness: style.thickness
  };
  return { spec, floorHeight: FLOOR_HEIGHT, floors, applied, roof, footprint: { width, depth } };
}

// src/spec.ts
var STYLES = ["ranch", "colonial", "modern"];
var DEFAULT_SQFT = 1800;
var DEFAULT_BEDROOMS = 3;
var DEFAULT_STYLE = "colonial";
var SQFT_MIN = 300;
var SQFT_MAX = 2e4;
var BEDROOMS_MIN = 0;
var BEDROOMS_MAX = 12;
var FLOORS_MIN = 1;
var FLOORS_MAX = 4;
var MULTI_FLOOR_SQFT = 2500;
function isMissing(v) {
  return v === void 0 || v === null || typeof v === "string" && v.trim() === "";
}
function toNumber(name, v) {
  const n = typeof v === "number" ? v : Number(v.trim());
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number (got ${JSON.stringify(v)})`);
  }
  return n;
}
function requireInRange(name, n, min, max, integer) {
  if (integer && !Number.isInteger(n)) {
    throw new Error(`${name} must be a whole number (got ${n})`);
  }
  if (n < min || n > max) {
    throw new Error(`${name} must be between ${min} and ${max} (got ${n})`);
  }
}
function parseSpec(raw) {
  const sqft = isMissing(raw.sqft) ? DEFAULT_SQFT : toNumber("sqft", raw.sqft);
  requireInRange("sqft", sqft, SQFT_MIN, SQFT_MAX, false);
  const bedrooms = isMissing(raw.bedrooms) ? DEFAULT_BEDROOMS : toNumber("bedrooms", raw.bedrooms);
  requireInRange("bedrooms", bedrooms, BEDROOMS_MIN, BEDROOMS_MAX, true);
  let floors;
  if (isMissing(raw.floors)) {
    floors = sqft >= MULTI_FLOOR_SQFT ? 2 : 1;
  } else {
    floors = toNumber("floors", raw.floors);
    requireInRange("floors", floors, FLOORS_MIN, FLOORS_MAX, true);
  }
  let style = DEFAULT_STYLE;
  if (!isMissing(raw.style)) {
    const found = STYLES.find((st) => st === raw.style);
    if (found === void 0) {
      throw new Error(`style must be one of ${STYLES.join(", ")} (got ${JSON.stringify(raw.style)})`);
    }
    style = found;
  }
  return { sqft, bedrooms, floors, style };
}
var OVERRIDE_SQFT_MIN = 40;
var OVERRIDE_FIELDS = ["sqft", "floor"];
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseOverrides(raw, spec) {
  if (raw === void 0 || raw === null) return {};
  if (!isPlainObject(raw)) throw new Error("overrides must be an object keyed by room id");
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    const m = /^bedroom-(\d+)$/.exec(id);
    if (!m) throw new Error(`unknown room id ${JSON.stringify(id)} in overrides (expected bedroom-1..bedroom-${spec.bedrooms})`);
    const num = Number(m[1]);
    if (num < 1 || num > spec.bedrooms) {
      throw new Error(`unknown room id ${JSON.stringify(id)}: this house has ${spec.bedrooms} bedroom(s)`);
    }
    if (!isPlainObject(value)) throw new Error(`override for ${id} must be an object`);
    for (const key of Object.keys(value)) {
      if (!OVERRIDE_FIELDS.includes(key)) throw new Error(`unknown field ${JSON.stringify(key)} in override for ${id} (allowed: sqft, floor)`);
    }
    const o = {};
    if (value.sqft !== void 0) {
      const s = value.sqft;
      if (typeof s !== "number" || !Number.isFinite(s)) throw new Error(`${id}.sqft must be a number (got ${JSON.stringify(s)})`);
      requireInRange(`${id}.sqft`, s, OVERRIDE_SQFT_MIN, spec.sqft, false);
      o.sqft = s;
    }
    if (value.floor !== void 0) {
      const f = value.floor;
      if (typeof f !== "number" || !Number.isFinite(f)) throw new Error(`${id}.floor must be a number (got ${JSON.stringify(f)})`);
      requireInRange(`${id}.floor`, f, 0, spec.floors - 1, true);
      o.floor = f;
    }
    out[id] = o;
  }
  return out;
}

// src/layout.ts
var BadRequestError = class extends Error {
};
var SPEC_FIELDS = ["sqft", "bedrooms", "floors"];
var STRING_FIELDS = ["style"];
function layoutToGltf(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError('body must be a JSON object with "spec" and optional "overrides"');
  }
  const { spec: rawSpec, overrides: rawOverrides } = body;
  if (typeof rawSpec !== "object" || rawSpec === null || Array.isArray(rawSpec)) {
    throw new BadRequestError("spec must be an object with optional sqft, bedrooms, floors and style");
  }
  for (const key of SPEC_FIELDS) {
    const v = rawSpec[key];
    if (v !== void 0 && v !== null && typeof v !== "string" && typeof v !== "number") {
      throw new BadRequestError(`spec.${key} must be a number (got ${JSON.stringify(v)})`);
    }
  }
  for (const key of STRING_FIELDS) {
    const v = rawSpec[key];
    if (v !== void 0 && v !== null && typeof v !== "string") {
      throw new BadRequestError(`spec.${key} must be a string (got ${JSON.stringify(v)})`);
    }
  }
  let massing;
  try {
    const spec = parseSpec(rawSpec);
    massing = buildMassing(spec, parseOverrides(rawOverrides, spec));
  } catch (err) {
    throw new BadRequestError(err instanceof Error ? err.message : String(err));
  }
  return toGltf(massing);
}

// src/browser-entry.ts
globalThis.layoutToGltf = layoutToGltf;
