import { describe, expect, it } from 'vitest';
import { buildMassing, type Box } from '../src/massing.ts';
import { parseSpec } from '../src/spec.ts';

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
