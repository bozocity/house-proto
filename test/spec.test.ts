import { describe, expect, it } from 'vitest';
import { parseSpec } from '../src/spec.ts';

describe('parseSpec', () => {
  it('parses numeric strings (CLI input)', () => {
    expect(parseSpec({ sqft: '1800', bedrooms: '3', floors: '2' })).toEqual({ sqft: 1800, bedrooms: 3, floors: 2 });
  });

  it('accepts numbers', () => {
    expect(parseSpec({ sqft: 1200, bedrooms: 2, floors: 1 })).toEqual({ sqft: 1200, bedrooms: 2, floors: 1 });
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
    expect(parseSpec({ sqft: 300, bedrooms: 0, floors: 1 })).toEqual({ sqft: 300, bedrooms: 0, floors: 1 });
    expect(parseSpec({ sqft: 20000, bedrooms: 12, floors: 4 })).toEqual({ sqft: 20000, bedrooms: 12, floors: 4 });
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
    expect(() => parseSpec({ bedrooms: 1 })).toThrow(/sqft is required/);
    expect(() => parseSpec({ sqft: 1000 })).toThrow(/bedrooms is required/);
  });
});
