// Request-shaped layout call: { spec, overrides } -> glTF JSON. Pure; throws BadRequestError on invalid input.
import { toGltf } from './export/gltf.ts';
import { buildMassing } from './massing.ts';
import { parseOverrides, parseSpec, type RawSpec } from './spec.ts';

export class BadRequestError extends Error {}

const SPEC_FIELDS = ['sqft', 'bedrooms', 'floors'] as const;

export function layoutToGltf(body: unknown): object {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('body must be a JSON object with "spec" and optional "overrides"');
  }
  const { spec: rawSpec, overrides: rawOverrides } = body as Record<string, unknown>;
  if (typeof rawSpec !== 'object' || rawSpec === null || Array.isArray(rawSpec)) {
    throw new BadRequestError('spec must be an object with sqft, bedrooms and optional floors');
  }
  for (const key of SPEC_FIELDS) {
    const v = (rawSpec as Record<string, unknown>)[key];
    if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') {
      throw new BadRequestError(`spec.${key} must be a number (got ${JSON.stringify(v)})`);
    }
  }

  let massing;
  try {
    const spec = parseSpec(rawSpec as RawSpec);
    massing = buildMassing(spec, parseOverrides(rawOverrides, spec));
  } catch (err) {
    throw new BadRequestError(err instanceof Error ? err.message : String(err));
  }
  return toGltf(massing);
}
