// Massing: HouseSpec -> labeled room boxes per floor. Pure geometry, units: feet.
import type { HouseSpec, Overrides, Style } from './spec.ts';

export type RoomKind = 'bedroom' | 'living';

/** x,z = plan position (origin at footprint corner), y = floor elevation, w along x, d along z, h height. */
export interface Box {
  /** Stable id: `bedroom-N` (N = bedroom number, independent of floor), `living-<level>`, `living-<level>-back`. */
  id: string;
  label: string;
  kind: RoomKind;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Plan area w*d rounded to 1 decimal. */
  sqft: number;
}

export interface Floor {
  level: number;
  width: number;
  depth: number;
  elevation: number;
  rooms: Box[];
}

/**
 * Roof description (no geometry here; the viewer builds the roof from it). Units: feet.
 * gable: pitch = rise/run (4/12 = 0.333); the ridge runs along `ridgeAxis` (the longer footprint axis);
 * `overhang` = feet beyond the footprint on all sides; `thickness` = roof slab thickness.
 * flat: pitch 0.
 */
export interface RoofSpec {
  kind: 'gable' | 'flat';
  pitch: number;
  overhang: number;
  ridgeAxis: 'x' | 'z';
  thickness: number;
}

export interface Massing {
  spec: HouseSpec;
  floorHeight: number;
  floors: Floor[];
  roof: RoofSpec;
  /** Footprint of floors[0]: width along x, depth along z (whole feet). */
  footprint: { width: number; depth: number };
  /**
   * Overrides as actually used after clamping: for every bedroom that had an override, only the keys
   * the incoming override named (`floor`: level it ended on, `sqft`: area it got). An override pins only
   * the fields it names, so a floor-only override is echoed as `{ floor }` and leaves sqft automatic.
   */
  applied: Overrides;
}

const FLOOR_HEIGHT = 9;

/**
 * Style table: footprint aspect (width / depth) and roof.
 *   style     aspect  roof    pitch (rise/run)  overhang (ft)  thickness (ft)
 *   ranch     2.0     gable   4/12              2              0.5
 *   colonial  1.25    gable   8/12              1              0.5   (the original behavior)
 *   modern    1.6     flat    0                 1.5            1
 */
const STYLE_TABLE: Record<Style, { aspect: number; kind: RoofSpec['kind']; pitch: number; overhang: number; thickness: number }> = {
  ranch: { aspect: 2.0, kind: 'gable', pitch: 4 / 12, overhang: 2, thickness: 0.5 },
  colonial: { aspect: 1.25, kind: 'gable', pitch: 8 / 12, overhang: 1, thickness: 0.5 },
  modern: { aspect: 1.6, kind: 'flat', pitch: 0, overhang: 1.5, thickness: 1 },
};
const BEDROOM_SIZE = 12;
/** Bedrooms may shrink to this size before extras overflow to another floor. */
const MIN_BEDROOM_SIZE = 10;
/** Bedrooms never take more than this share of the floor depth, so a living box always remains. */
const MAX_BEDROOM_DEPTH_SHARE = 0.6;

/** Back-row slack narrower than this (ft) is not worth a box. */
const SLACK_EPS = 0.005;
/** Overridden bedrooms squeezed for width never go narrower than this (ft) before everything scales uniformly. */
const MIN_OVERRIDDEN_WIDTH = 4;

/** Round down to 2 decimals so shrunken boxes never poke past the footprint. */
function floor2(v: number): number {
  return Math.floor(v * 100 + 1e-6) / 100;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function area1(w: number, d: number): number {
  return Math.round(w * d * 10) / 10;
}

/**
 * Bedrooms per level (index = level), filling upper floors first, overflowing downward.
 * `fixed[level]` bedrooms are already placed explicitly and use up capacity first.
 */
function distributeBedrooms(total: number, floors: number, width: number, fixed: number[]): number[] {
  const perFloorCap = Math.max(1, Math.floor(width / MIN_BEDROOM_SIZE));
  const counts = new Array<number>(floors).fill(0);
  let remaining = total;
  for (let level = floors - 1; level >= 0 && remaining > 0; level--) {
    const n = Math.min(Math.max(0, perFloorCap - (fixed[level] ?? 0)), remaining);
    counts[level] = n;
    remaining -= n;
  }
  // Everything is at capacity: squeeze extras in round-robin, top floor first (rooms shrink).
  for (let level = floors - 1; remaining > 0; level = level === 0 ? floors - 1 : level - 1) {
    counts[level] = (counts[level] ?? 0) + 1;
    remaining--;
  }
  return counts;
}

interface BedroomPlan {
  number: number;
  /** Requested area when sqft-overridden; undefined = default (auto) size. */
  sqft: number | undefined;
}

/**
 * Sizes one floor's bedroom row. Returns the shared row depth and each bedroom's width.
 *
 * Without sqft overrides this is the original behavior: square rooms, uniformly scaled to fit.
 *
 * With sqft overrides, ROW-DEPTH VARIANT (simple): every bedroom on the floor uses one shared row
 * depth = the deepest requested depth (auto rooms ask for 12 ft, overridden rooms for sqrt(sqft)),
 * capped at 60% of the floor depth. Widths follow: overridden = sqft / rowDepth, auto = 12 ft.
 * If the row is wider than the floor, auto rooms shrink first (down to 10 ft), then overridden
 * rooms (down to 4 ft), and finally everything scales uniformly. Depth never changes while
 * squeezing, so an overridden room's real area can end up below its request (reported in `applied`).
 */
function sizeRow(plans: BedroomPlan[], floorWidth: number, floorDepth: number): { rowDepth: number; widths: number[] } {
  const cap = floorDepth * MAX_BEDROOM_DEPTH_SHARE;
  const n = plans.length;

  if (plans.every((p) => p.sqft === undefined)) {
    const scale = Math.min(1, floorWidth / (n * BEDROOM_SIZE), cap / BEDROOM_SIZE);
    const size = floor2(BEDROOM_SIZE * scale);
    return { rowDepth: size, widths: plans.map(() => size) };
  }

  const autoSize = Math.min(BEDROOM_SIZE, cap);
  const rowDepth = floor2(
    Math.max(...plans.map((p) => (p.sqft === undefined ? autoSize : Math.min(Math.sqrt(p.sqft), cap)))),
  );
  const want = plans.map((p) => (p.sqft === undefined ? autoSize : p.sqft / rowDepth));
  const autoMin = Math.min(MIN_BEDROOM_SIZE, autoSize);
  const floors = plans.map((p, i) =>
    p.sqft === undefined ? autoMin : Math.min(want[i]!, MIN_OVERRIDDEN_WIDTH),
  );

  const w = [...want];
  // Phases: shrink auto rooms toward their floor, then overridden rooms toward theirs.
  for (const wantAuto of [true, false]) {
    const deficit = w.reduce((a, v) => a + v, 0) - floorWidth;
    if (deficit <= 0) break;
    const idx = plans.map((p, i) => i).filter((i) => (plans[i]!.sqft === undefined) === wantAuto);
    const room = idx.reduce((a, i) => a + (w[i]! - floors[i]!), 0);
    if (room <= 0) continue;
    const frac = Math.min(1, deficit / room);
    for (const i of idx) w[i] = w[i]! - (w[i]! - floors[i]!) * frac;
  }
  const total = w.reduce((a, v) => a + v, 0);
  if (total > floorWidth) {
    const k = floorWidth / total;
    for (let i = 0; i < n; i++) w[i] = w[i]! * k;
  }

  // Round to 2 decimals (area error < 0.4 sqft); fall back to floor if rounding pushes past the edge.
  let widths = w.map(round2);
  if (widths.reduce((a, v) => a + v, 0) > floorWidth + 1e-9) widths = w.map(floor2);
  return { rowDepth, widths };
}

export function buildMassing(spec: HouseSpec, overrides: Overrides = {}): Massing {
  const area = spec.sqft / spec.floors;
  const style = STYLE_TABLE[spec.style];
  const depth = Math.max(1, Math.round(Math.sqrt(area / style.aspect)));
  const width = Math.max(1, Math.round(depth * style.aspect));

  // Resolve overrides per bedroom number (unknown ids ignored; values clamped, never thrown on).
  const fixedLevel = new Map<number, number>();
  const requestedSqft = new Map<number, number>();
  const overridden = new Map<number, { floor: boolean; sqft: boolean }>();
  for (let n = 1; n <= spec.bedrooms; n++) {
    const o = overrides[`bedroom-${n}`];
    if (!o) continue;
    overridden.set(n, { floor: 'floor' in o, sqft: 'sqft' in o });
    if (typeof o.floor === 'number' && Number.isFinite(o.floor)) {
      fixedLevel.set(n, Math.min(spec.floors - 1, Math.max(0, Math.round(o.floor))));
    }
    if (typeof o.sqft === 'number' && Number.isFinite(o.sqft) && o.sqft > 0) requestedSqft.set(n, o.sqft);
  }

  // Free bedrooms (no floor override) fill the remaining capacity; lowest numbers go to the lowest levels.
  const fixedCounts = new Array<number>(spec.floors).fill(0);
  for (const lvl of fixedLevel.values()) fixedCounts[lvl] = (fixedCounts[lvl] ?? 0) + 1;
  const freeNumbers: number[] = [];
  for (let n = 1; n <= spec.bedrooms; n++) if (!fixedLevel.has(n)) freeNumbers.push(n);
  const counts = distributeBedrooms(freeNumbers.length, spec.floors, width, fixedCounts);
  const byLevel: number[][] = Array.from({ length: spec.floors }, () => []);
  for (const [n, lvl] of fixedLevel) byLevel[lvl]!.push(n);
  let next = 0;
  for (let level = 0; level < spec.floors; level++) {
    for (let i = 0; i < (counts[level] ?? 0); i++) byLevel[level]!.push(freeNumbers[next++]!);
    byLevel[level]!.sort((a, b) => a - b);
  }

  const applied: Overrides = {};
  const floors: Floor[] = [];
  for (let level = 0; level < spec.floors; level++) {
    const elevation = level * FLOOR_HEIGHT;
    const numbers = byLevel[level]!;
    const rooms: Box[] = [];

    let bedroomDepth = 0;
    let rowEnd = 0;
    if (numbers.length > 0) {
      const plans = numbers.map((number) => ({ number, sqft: requestedSqft.get(number) }));
      const row = sizeRow(plans, width, depth);
      bedroomDepth = row.rowDepth;
      for (let i = 0; i < numbers.length; i++) {
        const number = numbers[i]!;
        const bw = row.widths[i]!;
        const box: Box = {
          id: `bedroom-${number}`,
          label: `Bedroom ${number}`,
          kind: 'bedroom',
          x: floor2(rowEnd),
          y: elevation,
          z: depth - bedroomDepth,
          w: bw,
          d: bedroomDepth,
          h: FLOOR_HEIGHT,
          sqft: area1(bw, bedroomDepth),
        };
        rooms.push(box);
        rowEnd += bw;
        const named = overridden.get(number);
        if (named) {
          const echo: { floor?: number; sqft?: number } = {};
          if (named.floor) echo.floor = level;
          if (named.sqft) echo.sqft = box.sqft;
          applied[box.id] = echo;
        }
      }
    }

    const livingLabel = level === 0 ? 'Living' : `Living (L${level + 1})`;
    const frontDepth = depth - bedroomDepth;
    rooms.push({
      id: `living-${level}`,
      label: livingLabel,
      kind: 'living',
      x: 0,
      y: elevation,
      z: 0,
      w: width,
      d: frontDepth,
      h: FLOOR_HEIGHT,
      sqft: area1(width, frontDepth),
    });

    // Slack beside the bedroom row (width not a multiple of the bedroom width) is living space too.
    if (numbers.length > 0 && width - rowEnd > SLACK_EPS) {
      const slackW = width - rowEnd;
      rooms.push({
        id: `living-${level}-back`,
        label: livingLabel,
        kind: 'living',
        x: rowEnd,
        y: elevation,
        z: depth - bedroomDepth,
        w: slackW,
        d: bedroomDepth,
        h: FLOOR_HEIGHT,
        sqft: area1(slackW, bedroomDepth),
      });
    }

    floors.push({ level, width, depth, elevation, rooms });
  }

  const roof: RoofSpec = {
    kind: style.kind,
    pitch: style.pitch,
    overhang: style.overhang,
    ridgeAxis: width >= depth ? 'x' : 'z',
    thickness: style.thickness,
  };

  return { spec, floorHeight: FLOOR_HEIGHT, floors, applied, roof, footprint: { width, depth } };
}
