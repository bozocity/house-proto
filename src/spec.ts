// HouseSpec: the validated input to the pipeline. Units: feet / square feet.

export interface HouseSpec {
  sqft: number;
  bedrooms: number;
  floors: number;
}

export interface RawSpec {
  sqft?: string | number;
  bedrooms?: string | number;
  floors?: string | number;
}

const SQFT_MIN = 300;
const SQFT_MAX = 20000;
const BEDROOMS_MIN = 0;
const BEDROOMS_MAX = 12;
const FLOORS_MIN = 1;
const FLOORS_MAX = 4;
const MULTI_FLOOR_SQFT = 2500;

function isMissing(v: string | number | undefined | null): v is undefined | null | '' {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function toNumber(name: string, v: string | number): number {
  const n = typeof v === 'number' ? v : Number(v.trim());
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a number (got ${JSON.stringify(v)})`);
  }
  return n;
}

function requireInRange(name: string, n: number, min: number, max: number, integer: boolean): void {
  if (integer && !Number.isInteger(n)) {
    throw new Error(`${name} must be a whole number (got ${n})`);
  }
  if (n < min || n > max) {
    throw new Error(`${name} must be between ${min} and ${max} (got ${n})`);
  }
}

export function parseSpec(raw: RawSpec): HouseSpec {
  if (isMissing(raw.sqft)) throw new Error('sqft is required');
  if (isMissing(raw.bedrooms)) throw new Error('bedrooms is required');

  const sqft = toNumber('sqft', raw.sqft);
  requireInRange('sqft', sqft, SQFT_MIN, SQFT_MAX, false);

  const bedrooms = toNumber('bedrooms', raw.bedrooms);
  requireInRange('bedrooms', bedrooms, BEDROOMS_MIN, BEDROOMS_MAX, true);

  let floors: number;
  if (isMissing(raw.floors)) {
    floors = sqft >= MULTI_FLOOR_SQFT ? 2 : 1;
  } else {
    floors = toNumber('floors', raw.floors);
    requireInRange('floors', floors, FLOORS_MIN, FLOORS_MAX, true);
  }

  return { sqft, bedrooms, floors };
}

export interface RoomOverride {
  sqft?: number;
  /** 0-based level. */
  floor?: number;
}

/** Keyed by Box.id (currently only `bedroom-N`). */
export type Overrides = Record<string, RoomOverride>;

const OVERRIDE_SQFT_MIN = 40;
const OVERRIDE_FIELDS = ['sqft', 'floor'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates user-supplied room overrides against a spec. Returns a cleaned copy; throws readable errors. */
export function parseOverrides(raw: unknown, spec: HouseSpec): Overrides {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new Error('overrides must be an object keyed by room id');

  const out: Overrides = {};
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

    const o: RoomOverride = {};
    if (value.sqft !== undefined) {
      const s = value.sqft;
      if (typeof s !== 'number' || !Number.isFinite(s)) throw new Error(`${id}.sqft must be a number (got ${JSON.stringify(s)})`);
      requireInRange(`${id}.sqft`, s, OVERRIDE_SQFT_MIN, spec.sqft, false);
      o.sqft = s;
    }
    if (value.floor !== undefined) {
      const f = value.floor;
      if (typeof f !== 'number' || !Number.isFinite(f)) throw new Error(`${id}.floor must be a number (got ${JSON.stringify(f)})`);
      requireInRange(`${id}.floor`, f, 0, spec.floors - 1, true);
      o.floor = f;
    }
    out[id] = o;
  }
  return out;
}
