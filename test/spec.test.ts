import { describe, expect, it } from 'vitest';
import { parseOverrides, parseSpec, STYLES } from '../src/spec.ts';

describe('parseSpec', () => {
  it('parses numeric strings (CLI input)', () => {
    expect(parseSpec({ sqft: '1800', bedrooms: '3', floors: '2' })).toEqual({ sqft: 1800, bedrooms: 3, floors: 2, style: 'colonial' });
  });

  it('accepts numbers', () => {
    expect(parseSpec({ sqft: 1200, bedrooms: 2, floors: 1 })).toEqual({ sqft: 1200, bedrooms: 2, floors: 1, style: 'colonial' });
  });

  it('defaults floors to 1 below 2500 sqft', () => {
    expect(parseSpec({ sqft: 2499, bedrooms: 3 }).floors).toBe(1);
  });

  it('defaults floors to 2 at 2500 sqft and above', () => {
    expect(parseSpec({ sqft: 2500, bedrooms: 3 }).floors).toBe(2);
    expect(parseSpec({ sqft: 6000, bedrooms: 3, floors: '' }).floors).toBe(2);
  });

  it('an explicit floors value overrides the default', () => {
    expect(parseSpec({ sqft: 4000, bedrooms: 3, floors: 1 }).floors).toBe(1);
  });

  it('accepts boundary values', () => {
    expect(parseSpec({ sqft: 300, bedrooms: 0, floors: 1 })).toEqual({ sqft: 300, bedrooms: 0, floors: 1, style: 'colonial' });
    expect(parseSpec({ sqft: 20000, bedrooms: 12, floors: 4 })).toEqual({ sqft: 20000, bedrooms: 12, floors: 4, style: 'colonial' });
  });

  it('rejects sqft out of range', () => {
    expect(() => parseSpec({ sqft: 299, bedrooms: 1 })).toThrow(/sqft must be between 300 and 20000/);
    expect(() => parseSpec({ sqft: 20001, bedrooms: 1 })).toThrow(/sqft/);
  });

  it('rejects bedrooms out of range or non-integer', () => {
    expect(() => parseSpec({ sqft: 1000, bedrooms: -1 })).toThrow(/bedrooms must be between 0 and 12/);
    expect(() => parseSpec({ sqft: 1000, bedrooms: 13 })).toThrow(/bedrooms/);
    expect(() => parseSpec({ sqft: 1000, bedrooms: '2.5' })).toThrow(/bedrooms must be a whole number/);
  });

  it('rejects floors out of range or non-integer', () => {
    expect(() => parseSpec({ sqft: 1000, bedrooms: 1, floors: 0 })).toThrow(/floors must be between 1 and 4/);
    expect(() => parseSpec({ sqft: 1000, bedrooms: 1, floors: 5 })).toThrow(/floors/);
    expect(() => parseSpec({ sqft: 1000, bedrooms: 1, floors: 1.5 })).toThrow(/floors must be a whole number/);
  });

  it('rejects non-numeric and missing input with readable messages', () => {
    expect(() => parseSpec({ sqft: 'big', bedrooms: 1 })).toThrow(/sqft must be a number/);
    expect(() => parseSpec({ sqft: Infinity, bedrooms: 1 })).toThrow(/sqft must be a number/);
  });

  it('defaults sqft to 1800, bedrooms to 3 and style to colonial (empty input)', () => {
    expect(parseSpec({})).toEqual({ sqft: 1800, bedrooms: 3, floors: 1, style: 'colonial' });
    expect(parseSpec({ sqft: '', bedrooms: '  ' })).toEqual({ sqft: 1800, bedrooms: 3, floors: 1, style: 'colonial' });
    expect(parseSpec({ bedrooms: 1 }).sqft).toBe(1800);
    expect(parseSpec({ sqft: 1000 }).bedrooms).toBe(3);
  });

  it('still range-checks sqft and bedrooms when provided', () => {
    expect(() => parseSpec({ sqft: 10 })).toThrow(/sqft must be between/);
    expect(() => parseSpec({ bedrooms: 99 })).toThrow(/bedrooms must be between/);
  });

  it('accepts each style', () => {
    for (const style of STYLES) expect(parseSpec({ style }).style).toBe(style);
    expect(STYLES).toEqual(['ranch', 'colonial', 'modern']);
  });

  it('rejects an unknown style with the list of valid ones', () => {
    expect(() => parseSpec({ style: 'gothic' })).toThrow('style must be one of ranch, colonial, modern (got "gothic")');
    expect(() => parseSpec({ style: 'Ranch' })).toThrow(/style must be one of/);
  });
});

describe('parseOverrides', () => {
  const spec = parseSpec({ sqft: 1800, bedrooms: 3, floors: 2 });

  it('returns {} for undefined / null', () => {
    expect(parseOverrides(undefined, spec)).toEqual({});
    expect(parseOverrides(null, spec)).toEqual({});
    expect(parseOverrides({}, spec)).toEqual({});
  });

  it('accepts valid overrides (including boundaries)', () => {
    const raw = { 'bedroom-1': { floor: 0, sqft: 200 }, 'bedroom-3': { sqft: 40 }, 'bedroom-2': { floor: 1, sqft: 1800 }, };
    expect(parseOverrides(raw, spec)).toEqual(raw);
    expect(parseOverrides({ 'bedroom-2': {} }, spec)).toEqual({ 'bedroom-2': {} });
  });

  it('rejects non-object input', () => {
    expect(() => parseOverrides('x', spec)).toThrow(/overrides must be an object/);
    expect(() => parseOverrides([], spec)).toThrow(/overrides must be an object/);
    expect(() => parseOverrides({ 'bedroom-1': 5 }, spec)).toThrow(/must be an object/);
  });

  it('rejects unknown or out-of-range room ids', () => {
    expect(() => parseOverrides({ 'living-0': { sqft: 100 } }, spec)).toThrow(/unknown room id/);
    expect(() => parseOverrides({ 'bedroom-0': { sqft: 100 } }, spec)).toThrow(/unknown room id/);
    expect(() => parseOverrides({ 'bedroom-4': { sqft: 100 } }, spec)).toThrow(/3 bedroom/);
    expect(() => parseOverrides({ 'bedroom-x': {} }, spec)).toThrow(/unknown room id/);
  });

  it('rejects unknown fields', () => {
    expect(() => parseOverrides({ 'bedroom-1': { color: 'red' } }, spec)).toThrow(/unknown field "color"/);
  });

  it('rejects bad floor values', () => {
    expect(() => parseOverrides({ 'bedroom-1': { floor: 2 } }, spec)).toThrow(/bedroom-1\.floor must be between 0 and 1/);
    expect(() => parseOverrides({ 'bedroom-1': { floor: -1 } }, spec)).toThrow(/floor/);
    expect(() => parseOverrides({ 'bedroom-1': { floor: 0.5 } }, spec)).toThrow(/whole number/);
    expect(() => parseOverrides({ 'bedroom-1': { floor: '1' } }, spec)).toThrow(/floor must be a number/);
  });

  it('rejects bad sqft values', () => {
    expect(() => parseOverrides({ 'bedroom-1': { sqft: 39 } }, spec)).toThrow(/bedroom-1\.sqft must be between 40 and 1800/);
    expect(() => parseOverrides({ 'bedroom-1': { sqft: 1801 } }, spec)).toThrow(/sqft/);
    expect(() => parseOverrides({ 'bedroom-1': { sqft: '200' } }, spec)).toThrow(/sqft must be a number/);
    expect(() => parseOverrides({ 'bedroom-1': { sqft: NaN } }, spec)).toThrow(/sqft must be a number/);
  });
});
