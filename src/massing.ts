// Massing: HouseSpec -> labeled room boxes per floor. Pure geometry, units: feet.
import type { HouseSpec } from './spec.ts';

export type RoomKind = 'bedroom' | 'living';

/** x,z = plan position (origin at footprint corner), y = floor elevation, w along x, d along z, h height. */
export interface Box {
  label: string;
  kind: RoomKind;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface Floor {
  level: number;
  width: number;
  depth: number;
  elevation: number;
  rooms: Box[];
}

export interface Massing {
  spec: HouseSpec;
  floorHeight: number;
  floors: Floor[];
}

const FLOOR_HEIGHT = 9;
const ASPECT = 1.25;
const BEDROOM_SIZE = 12;
/** Bedrooms may shrink to this size before extras overflow to another floor. */
const MIN_BEDROOM_SIZE = 10;
/** Bedrooms never take more than this share of the floor depth, so a living box always remains. */
const MAX_BEDROOM_DEPTH_SHARE = 0.6;

/** Back-row slack narrower than this (ft) is not worth a box. */
const SLACK_EPS = 0.005;

/** Round down to 2 decimals so shrunken boxes never poke past the footprint. */
function floor2(v: number): number {
  return Math.floor(v * 100 + 1e-6) / 100;
}

/** Bedrooms per level (index = level), filling upper floors first, overflowing downward. */
function distributeBedrooms(total: number, floors: number, width: number): number[] {
  const perFloorCap = Math.max(1, Math.floor(width / MIN_BEDROOM_SIZE));
  const counts = new Array<number>(floors).fill(0);
  let remaining = total;
  for (let level = floors - 1; level >= 0 && remaining > 0; level--) {
    const n = Math.min(perFloorCap, remaining);
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

export function buildMassing(spec: HouseSpec): Massing {
  const area = spec.sqft / spec.floors;
  const depth = Math.max(1, Math.round(Math.sqrt(area / ASPECT)));
  const width = Math.max(1, Math.round(depth * ASPECT));

  const counts = distributeBedrooms(spec.bedrooms, spec.floors, width);

  let bedroomNumber = 0;
  const floors: Floor[] = [];
  for (let level = 0; level < spec.floors; level++) {
    const elevation = level * FLOOR_HEIGHT;
    const n = counts[level] ?? 0;
    const rooms: Box[] = [];

    let bedroomDepth = 0;
    let bedroomWidth = 0;
    if (n > 0) {
      const scale = Math.min(1, width / (n * BEDROOM_SIZE), (depth * MAX_BEDROOM_DEPTH_SHARE) / BEDROOM_SIZE);
      const bw = floor2(BEDROOM_SIZE * scale);
      bedroomWidth = bw;
      bedroomDepth = floor2(BEDROOM_SIZE * scale);
      for (let i = 0; i < n; i++) {
        bedroomNumber++;
        rooms.push({
          label: `Bedroom ${bedroomNumber}`,
          kind: 'bedroom',
          x: floor2(i * bw),
          y: elevation,
          z: depth - bedroomDepth,
          w: bw,
          d: bedroomDepth,
          h: FLOOR_HEIGHT,
        });
      }
    }

    const livingLabel = level === 0 ? 'Living' : `Living (L${level + 1})`;
    rooms.push({
      label: livingLabel,
      kind: 'living',
      x: 0,
      y: elevation,
      z: 0,
      w: width,
      d: depth - bedroomDepth,
      h: FLOOR_HEIGHT,
    });

    // Slack beside the bedroom row (width not a multiple of the bedroom width) is living space too.
    const rowEnd = n * bedroomWidth;
    if (n > 0 && width - rowEnd > SLACK_EPS) {
      rooms.push({
        label: `${livingLabel} (back)`,
        kind: 'living',
        x: rowEnd,
        y: elevation,
        z: depth - bedroomDepth,
        w: width - rowEnd,
        d: bedroomDepth,
        h: FLOOR_HEIGHT,
      });
    }

    floors.push({ level, width, depth, elevation, rooms });
  }

  return { spec, floorHeight: FLOOR_HEIGHT, floors };
}
