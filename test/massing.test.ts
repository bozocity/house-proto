import { describe, expect, it } from 'vitest';
import { buildMassing, type Box } from '../src/massing.ts';
import { parseOverrides, parseSpec, type HouseSpec, type Overrides } from '../src/spec.ts';

const EPS = 1e-6;

const cases = [
  { sqft: 300, bedrooms: 0, floors: 1 },
  { sqft: 300, bedrooms: 12, floors: 4 },
  { sqft: 800, bedrooms: 1, floors: 1 },
  { sqft: 1200, bedrooms: 2, floors: 1 },
  { sqft: 1800, bedrooms: 3, floors: 2 },
  { sqft: 2500, bedrooms: 4, floors: 2 },
  { sqft: 3000, bedrooms: 5, floors: 3 },
  { sqft: 6000, bedrooms: 12, floors: 1 },
  { sqft: 20000, bedrooms: 12, floors: 4 },
  { sqft: 1000, bedrooms: 12, floors: 1 },
];

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS
  );
}

describe('buildMassing', () => {
  it('1800 sqft / 3 bed / 2 floors: 2 floors, 3 bedroom boxes, all on the upper floor', () => {
    const m = buildMassing(parseSpec({ sqft: '1800', bedrooms: '3', floors: '2' }));
    expect(m.floors).toHaveLength(2);
    const beds = m.floors.flatMap((f) => f.rooms.filter((r) => r.kind === 'bedroom'));
    expect(beds.map((b) => b.label)).toEqual(['Bedroom 1', 'Bedroom 2', 'Bedroom 3']);
    expect(m.floors[1]!.rooms.filter((r) => r.kind === 'bedroom')).toHaveLength(3);
    expect(m.floors[0]!.rooms.map((r) => r.label)).toEqual(['Living']); // no bedrooms, no slack
    expect(m.floors[1]!.rooms.find((r) => r.kind === 'living')!.label).toBe('Living (L2)');
  });

  it('footprint uses aspect 1.25 with whole-foot dimensions', () => {
    const m = buildMassing({ sqft: 1800, bedrooms: 3, floors: 2 });
    const f = m.floors[0]!;
    expect(f.depth).toBe(27);
    expect(f.width).toBe(34);
    expect(Number.isInteger(f.width) && Number.isInteger(f.depth)).toBe(true);
  });

  it('bedrooms are 12x12 when they fit, and shrink slightly (>= 10 ft) before overflowing', () => {
    const roomy = buildMassing({ sqft: 3000, bedrooms: 3, floors: 2 }); // 39 ft wide
    for (const b of roomy.floors[1]!.rooms.filter((r) => r.kind === 'bedroom')) {
      expect(b.w).toBe(12);
      expect(b.d).toBe(12);
    }
    const tight = buildMassing({ sqft: 1800, bedrooms: 3, floors: 2 }); // 34 ft wide, 3 x 12 = 36
    for (const b of tight.floors[1]!.rooms.filter((r) => r.kind === 'bedroom')) {
      expect(b.w).toBeGreaterThanOrEqual(10);
      expect(b.w).toBeLessThan(12);
      expect(b.w).toBe(b.d);
    }
  });

  it('overflows bedrooms down when the upper floor is full', () => {
    // 1000 sqft / 2 floors -> 25 x 20 ft per floor -> room for 2 bedrooms per floor
    const m = buildMassing({ sqft: 1000, bedrooms: 3, floors: 2 });
    const count = (lvl: number) => m.floors[lvl]!.rooms.filter((r) => r.kind === 'bedroom').length;
    expect(m.floors[0]!.width).toBe(25);
    expect(count(1)).toBe(2);
    expect(count(0)).toBe(1);
  });

  it.each(cases)('invariants hold for %o', (spec) => {
    const m = buildMassing(spec);
    expect(m.floorHeight).toBe(9);
    expect(m.floors).toHaveLength(spec.floors);

    // footprint area per floor ~ sqft/floors (rounded dims: allow 15% + 1 row/col of slack)
    const f0 = m.floors[0]!;
    const target = spec.sqft / spec.floors;
    expect(Math.abs(f0.width * f0.depth - target) / target).toBeLessThan(0.15);

    // bedroom count equals spec
    const beds = m.floors.flatMap((f) => f.rooms).filter((r) => r.kind === 'bedroom');
    expect(beds).toHaveLength(spec.bedrooms);

    m.floors.forEach((f, i) => {
      // stacking
      expect(f.level).toBe(i);
      expect(f.elevation).toBe(i * 9);
      expect(f.width).toBe(f0.width);
      expect(f.depth).toBe(f0.depth);
      // one living box per floor, plus one for the back-row slack when bedrooms leave any
      expect(f.rooms.filter((r) => r.kind === 'living').length).toBeGreaterThanOrEqual(1);
      expect(f.rooms.filter((r) => r.kind === 'living').length).toBeLessThanOrEqual(2);

      for (const r of f.rooms) {
        // inside footprint, positive size, correct elevation/height
        expect(r.x).toBeGreaterThanOrEqual(-EPS);
        expect(r.z).toBeGreaterThanOrEqual(-EPS);
        expect(r.x + r.w).toBeLessThanOrEqual(f.width + EPS);
        expect(r.z + r.d).toBeLessThanOrEqual(f.depth + EPS);
        expect(r.w).toBeGreaterThan(0);
        expect(r.d).toBeGreaterThan(0);
        expect(r.y).toBe(f.elevation);
        expect(r.h).toBe(9);
      }
      // no overlaps
      for (let a = 0; a < f.rooms.length; a++) {
        for (let b = a + 1; b < f.rooms.length; b++) {
          expect(overlaps(f.rooms[a]!, f.rooms[b]!), `${f.rooms[a]!.label} vs ${f.rooms[b]!.label}`).toBe(false);
        }
      }
    });
  });

  it('shrinks bedrooms proportionally when they do not fit along the edge', () => {
    const m = buildMassing({ sqft: 1000, bedrooms: 12, floors: 1 });
    const beds = m.floors[0]!.rooms.filter((r) => r.kind === 'bedroom');
    expect(beds).toHaveLength(12);
    for (const b of beds) {
      expect(b.w).toBeLessThan(12);
      expect(b.w).toBe(b.d);
      expect(b.z + b.d).toBeCloseTo(m.floors[0]!.depth, 6); // flush with the back edge
    }
  });

  it('zero bedrooms gives one full-footprint living box per floor', () => {
    const m = buildMassing({ sqft: 600, bedrooms: 0, floors: 1 });
    const [living] = m.floors[0]!.rooms;
    expect(m.floors[0]!.rooms).toHaveLength(1);
    expect(living!.w).toBe(m.floors[0]!.width);
    expect(living!.d).toBe(m.floors[0]!.depth);
  });

  it.each([
    { sqft: 900, bedrooms: 1, floors: 1 },
    { sqft: 1000, bedrooms: 3, floors: 2 },
    { sqft: 5000, bedrooms: 6, floors: 3 },
    { sqft: 400, bedrooms: 0, floors: 1 },
    { sqft: 1800, bedrooms: 3, floors: 2 },
    { sqft: 1200, bedrooms: 2, floors: 1 },
    { sqft: 1000, bedrooms: 12, floors: 1 },
    { sqft: 3000, bedrooms: 5, floors: 3 },
  ])('room boxes exactly tile the footprint for %o', (spec) => {
    const m = buildMassing(spec);
    for (const f of m.floors) {
      const total = f.rooms.reduce((a, r) => a + r.w * r.d, 0);
      expect(Math.abs(total - f.width * f.depth), `L${f.level + 1} area ${total} vs ${f.width * f.depth}`).toBeLessThan(0.05);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Overrides + ids
// ---------------------------------------------------------------------------------------------

const bedsOf = (m: ReturnType<typeof buildMassing>, level: number) =>
  m.floors[level]!.rooms.filter((r) => r.kind === 'bedroom');

/** Tiling, no-overlap, inside-footprint, ids unique, sqft field consistent. */
function expectValidMassing(m: ReturnType<typeof buildMassing>): void {
  const ids = m.floors.flatMap((f) => f.rooms.map((r) => r.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const f of m.floors) {
    const total = f.rooms.reduce((a, r) => a + r.w * r.d, 0);
    expect(Math.abs(total - f.width * f.depth), `L${f.level} tiling`).toBeLessThan(0.05);
    for (const r of f.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(-EPS);
      expect(r.z).toBeGreaterThanOrEqual(-EPS);
      expect(r.x + r.w).toBeLessThanOrEqual(f.width + EPS);
      expect(r.z + r.d).toBeLessThanOrEqual(f.depth + EPS);
      expect(r.w).toBeGreaterThan(0);
      expect(r.d).toBeGreaterThan(0);
      expect(Math.abs(r.sqft - r.w * r.d)).toBeLessThanOrEqual(0.051);
    }
    for (let a = 0; a < f.rooms.length; a++) {
      for (let b = a + 1; b < f.rooms.length; b++) {
        expect(overlaps(f.rooms[a]!, f.rooms[b]!), `${f.rooms[a]!.id} vs ${f.rooms[b]!.id}`).toBe(false);
      }
    }
  }
  // applied agrees with the boxes
  for (const [id, o] of Object.entries(m.applied)) {
    const box = m.floors.flatMap((f) => f.rooms).find((r) => r.id === id)!;
    expect(box).toBeDefined();
    if (o.sqft !== undefined) expect(o.sqft).toBe(box.sqft);
    if (o.floor !== undefined) expect(m.floors[o.floor]!.rooms).toContain(box);
  }
}

describe('box ids', () => {
  it('bedrooms are bedroom-N, living is living-<level>[-back], unique per massing', () => {
    const m = buildMassing({ sqft: 1800, bedrooms: 3, floors: 2 });
    expect(m.floors[0]!.rooms.map((r) => r.id)).toEqual(['living-0']);
    expect(m.floors[1]!.rooms.map((r) => r.id)).toEqual(['bedroom-1', 'bedroom-2', 'bedroom-3', 'living-1', 'living-1-back']);
    for (const spec of cases) expectValidMassing(buildMassing(spec));
  });

  it('bedroom numbering is stable regardless of floor', () => {
    const m = buildMassing({ sqft: 1000, bedrooms: 3, floors: 2 }); // 1 bedroom overflows down
    expect(bedsOf(m, 0).map((b) => b.id)).toEqual(['bedroom-1']);
    expect(bedsOf(m, 1).map((b) => b.id)).toEqual(['bedroom-2', 'bedroom-3']);
  });
});

describe('no overrides', () => {
  it('1800/3/2 output is unchanged apart from id/sqft/applied', () => {
    const m = buildMassing({ sqft: 1800, bedrooms: 3, floors: 2 });
    expect(m.applied).toEqual({});
    expect(m.floors[0]!.rooms).toEqual([
      { id: 'living-0', label: 'Living', kind: 'living', x: 0, y: 0, z: 0, w: 34, d: 27, h: 9, sqft: 918 },
    ]);
    const l2 = m.floors[1]!.rooms;
    const bed = (n: number, x: number) => ({
      id: `bedroom-${n}`, label: `Bedroom ${n}`, kind: 'bedroom', x, y: 9, z: 15.67, w: 11.33, d: 11.33, h: 9, sqft: 128.4,
    });
    expect(l2.slice(0, 3)).toEqual([bed(1, 0), bed(2, 11.33), bed(3, 22.66)]);
    expect(l2[3]).toEqual({ id: 'living-1', label: 'Living (L2)', kind: 'living', x: 0, y: 9, z: 0, w: 34, d: 15.67, h: 9, sqft: 532.8 });
    expect(l2[4]).toMatchObject({ id: 'living-1-back', label: 'Living (L2)', x: 33.99, y: 9, z: 15.67, d: 11.33 });
    expect(l2[4]!.w).toBeCloseTo(0.01, 6);
    expect(l2).toHaveLength(5);
  });

  it('empty overrides equal undefined overrides', () => {
    for (const spec of cases) expect(buildMassing(spec, {})).toEqual(buildMassing(spec));
  });
});

describe('overrides', () => {
  const spec = parseSpec({ sqft: 1800, bedrooms: 3, floors: 2 });

  it('spec example: bedroom-1 on level 0 at 200 sqft, others stay upstairs', () => {
    const m = buildMassing(spec, { 'bedroom-1': { floor: 0, sqft: 200 } });
    const b1 = bedsOf(m, 0);
    expect(b1.map((b) => b.id)).toEqual(['bedroom-1']);
    expect(Math.abs(b1[0]!.w * b1[0]!.d - 200)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(b1[0]!.sqft - 200)).toBeLessThanOrEqual(0.5);
    expect(bedsOf(m, 1).map((b) => b.id)).toEqual(['bedroom-2', 'bedroom-3']);
    expect(m.applied).toEqual({ 'bedroom-1': { floor: 0, sqft: b1[0]!.sqft } });
    expectValidMassing(m);
  });

  it('floor-only override moves the bedroom and redistributes the rest', () => {
    const m = buildMassing(spec, { 'bedroom-2': { floor: 0 } });
    expect(bedsOf(m, 0).map((b) => b.id)).toEqual(['bedroom-2']);
    expect(bedsOf(m, 1).map((b) => b.id)).toEqual(['bedroom-1', 'bedroom-3']);
    expect(m.applied).toEqual({ 'bedroom-2': { floor: 0 } });
    expectValidMassing(m);
  });

  it('applied echoes only the keys the override named', () => {
    const f = buildMassing(spec, { 'bedroom-1': { floor: 0 } }).applied;
    expect(f).toEqual({ 'bedroom-1': { floor: 0 } });
    expect(Object.keys(f['bedroom-1']!)).toEqual(['floor']);
    const s = buildMassing(spec, { 'bedroom-1': { sqft: 100 } }).applied;
    expect(Object.keys(s['bedroom-1']!)).toEqual(['sqft']);
    const both = buildMassing(spec, { 'bedroom-1': { floor: 0, sqft: 100 } }).applied;
    expect(Object.keys(both['bedroom-1']!).sort()).toEqual(['floor', 'sqft']);
  });

  it('slack living box shares the floor living label and no label says (back)', () => {
    const m = buildMassing(spec);
    const l2 = m.floors[1]!.rooms;
    expect(l2.find((r) => r.id === 'living-1-back')!.label).toBe(l2.find((r) => r.id === 'living-1')!.label);
    for (const c of cases) {
      for (const r of buildMassing(c).floors.flatMap((f) => f.rooms)) expect(r.label).not.toContain('(back)');
    }
  });

  it('floor-only override of an auto bedroom under 40 sqft passes parseOverrides + buildMassing', () => {
    const tight = parseSpec({ sqft: 900, bedrooms: 12, floors: 2 });
    const auto = buildMassing(tight).floors.flatMap((f) => f.rooms).find((r) => r.id === 'bedroom-1')!;
    expect(auto.sqft).toBeLessThan(40);
    const o = parseOverrides({ 'bedroom-1': { floor: 0 } }, tight);
    expect(o).toEqual({ 'bedroom-1': { floor: 0 } });
    const m = buildMassing(tight, o);
    expect(m.applied).toEqual({ 'bedroom-1': { floor: 0 } });
    expect(m.floors[0]!.rooms.map((r) => r.id)).toContain('bedroom-1');
    expectValidMassing(m);
  });

  it('floor-only override keeps the default (square, original-size) bedrooms', () => {
    const m = buildMassing(spec, { 'bedroom-3': { floor: 0 } });
    const b = bedsOf(m, 0)[0]!;
    expect(b.w).toBe(12);
    expect(b.d).toBe(12);
  });

  it('sqft override hits the requested area when it fits, for a range of sizes', () => {
    for (const sqft of [60, 100, 144, 180]) {
      const m = buildMassing(spec, { 'bedroom-2': { sqft } });
      const b = m.floors[1]!.rooms.find((r) => r.id === 'bedroom-2')!;
      expect(Math.abs(b.w * b.d - sqft), `sqft ${sqft}`).toBeLessThanOrEqual(0.5);
      expect(m.applied['bedroom-2']!.sqft).toBe(b.sqft);
      expectValidMassing(m);
    }
  });

  it('sqft override alone does not move the bedroom between floors', () => {
    const m = buildMassing(spec, { 'bedroom-1': { sqft: 150 } });
    expect(bedsOf(m, 1)).toHaveLength(3);
    expect(m.applied['bedroom-1']).toEqual({ sqft: bedsOf(m, 1)[0]!.sqft }); // sqft-only: floor stays unpinned
  });

  it('bedrooms on a floor share one row depth, flush with the back edge', () => {
    const m = buildMassing({ sqft: 3000, bedrooms: 3, floors: 2 }, { 'bedroom-1': { sqft: 225 } });
    const beds = bedsOf(m, 1);
    expect(new Set(beds.map((b) => b.d)).size).toBe(1);
    for (const b of beds) expect(b.z + b.d).toBeCloseTo(m.floors[1]!.depth, 6);
    expectValidMassing(m);
  });

  it('clamps an oversized request to fit the floor and records the real area', () => {
    const m = buildMassing({ sqft: 900, bedrooms: 1, floors: 1 }, { 'bedroom-1': { sqft: 5000 } });
    const f = m.floors[0]!;
    const b = f.rooms.find((r) => r.id === 'bedroom-1')!;
    expect(m.applied['bedroom-1']!.sqft).toBeLessThan(5000);
    expect(m.applied['bedroom-1']!.sqft).toBe(b.sqft);
    expect(b.w).toBeLessThanOrEqual(f.width + EPS);
    expect(b.d).toBeLessThanOrEqual(f.depth * 0.6 + EPS);
    expectValidMassing(m);
  });

  it('clamping shrinks auto bedrooms before overridden ones', () => {
    // 34 ft wide: 180 sqft override (13.42 x 13.42) + two autos (24 ft) = 37.4 ft -> autos give way first
    const m = buildMassing(spec, { 'bedroom-1': { sqft: 180 } });
    const [b1, b2, b3] = bedsOf(m, 1) as [Box, Box, Box];
    expect(Math.abs(b1.sqft - 180)).toBeLessThanOrEqual(0.5);
    expect(b2.w).toBeGreaterThanOrEqual(10 - EPS);
    expect(b2.w).toBeLessThan(12);
    expect(b3.w).toBeCloseTo(b2.w, 6);
    expectValidMassing(m);
  });

  it('when autos are at their 10 ft floor, overridden bedrooms shrink and applied reports it', () => {
    const m = buildMassing(spec, { 'bedroom-1': { sqft: 200 } }); // 14.14 + 2 x 10 > 34 ft
    const [b1, b2, b3] = bedsOf(m, 1) as [Box, Box, Box];
    expect(b2.w).toBeCloseTo(10, 6);
    expect(b3.w).toBeCloseTo(10, 6);
    expect(b1.sqft).toBeLessThan(200);
    expect(m.applied['bedroom-1']!.sqft).toBe(b1.sqft);
    expectValidMassing(m);
  });

  it('an explicitly placed bedroom never overflows to another floor', () => {
    // 1000 sqft / 2 floors -> 25 ft wide, cap 2 per floor; pin all 3 bedrooms on level 1
    const pin: Overrides = { 'bedroom-1': { floor: 1 }, 'bedroom-2': { floor: 1 }, 'bedroom-3': { floor: 1 } };
    const m = buildMassing({ sqft: 1000, bedrooms: 3, floors: 2 }, pin);
    expect(bedsOf(m, 1)).toHaveLength(3);
    expect(bedsOf(m, 0)).toHaveLength(0);
    expect(Object.values(m.applied).every((o) => o.floor === 1)).toBe(true);
    expectValidMassing(m);
  });

  it('crowded row with sqft overrides still lands everything and tiles', () => {
    const m = buildMassing(
      { sqft: 1000, bedrooms: 6, floors: 1 },
      Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`bedroom-${n}`, { sqft: 400 }])),
    );
    expect(bedsOf(m, 0)).toHaveLength(6);
    expectValidMassing(m);
  });

  it('out-of-range / unknown overrides passed straight to buildMassing never throw', () => {
    const m = buildMassing(spec, { 'bedroom-1': { floor: 9, sqft: -5 }, 'bedroom-7': { floor: 0 }, 'bedroom-2': { sqft: NaN } });
    expect(m.applied['bedroom-1']!.floor).toBe(1);
    expect(m.applied['bedroom-7']).toBeUndefined();
    expectValidMassing(m);
  });

  const combos: Overrides[] = [
    { 'bedroom-1': { floor: 0 } },
    { 'bedroom-1': { sqft: 180 } },
    { 'bedroom-1': { floor: 0, sqft: 200 }, 'bedroom-2': { sqft: 90 } },
    { 'bedroom-1': { sqft: 5000 } },
    { 'bedroom-1': { floor: 0, sqft: 400 }, 'bedroom-2': { floor: 0, sqft: 400 }, 'bedroom-3': { floor: 0, sqft: 400 } },
  ];
  const comboCases = cases.flatMap((c) => combos.map((o) => [c, o] as const));
  it.each(comboCases)('invariants hold for %o with overrides %o', (c: HouseSpec, o: Overrides) => {
    const m = buildMassing(c, o);
    const base = buildMassing(c);
    expect(m.floors.map((f) => [f.width, f.depth])).toEqual(base.floors.map((f) => [f.width, f.depth]));
    expect(m.floors.flatMap((f) => f.rooms).filter((r) => r.kind === 'bedroom')).toHaveLength(c.bedrooms);
    expectValidMassing(m);
  });

  it('parseOverrides output feeds buildMassing', () => {
    const o = parseOverrides({ 'bedroom-1': { floor: 0, sqft: 200 } }, spec);
    expect(buildMassing(spec, o).applied['bedroom-1']!.floor).toBe(0);
  });
});
