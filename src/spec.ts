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
