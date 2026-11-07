// Card 1.5 step 2 (GREEN): CPU reference for the coast band.
// Seeds come from jumpFloodReference (card 0.10): two Uint16 per texel, the nearest
// coast texel, or JFA_SENTINEL where the grid has no coast. The band formula is ours,
// not Wonderdraft's, and it chooses no product value. Integer arithmetic only.
import { JFA_MAX_SIDE, JFA_SENTINEL } from '../sdf/jfa.ts';

/** Largest band radius W accepted. Keeps 255 * W^2 below 2^31. */
export const COAST_FX_MAX_RADIUS = 2048;

export type CoastFxErrorCode = 'param' | 'length' | 'limit';

export class CoastFxError extends Error {
  readonly code: CoastFxErrorCode;

  constructor(code: CoastFxErrorCode, message: string) {
    super(message);
    this.name = 'CoastFxError';
    this.code = code;
  }
}

export interface CoastFxParams {
  /** Integer band radius W, from 0 to COAST_FX_MAX_RADIUS. A labelled test parameter. */
  readonly radius: number;
  /** Test colour: three integers from 0 to 255. */
  readonly rgb: readonly [number, number, number];
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

// Alpha for squared distance d2: 0 when W = 0 or d2 >= W^2, else floor(255 * (W^2 - d2) / W^2).
function bandAlpha(d2: number, radius: number): number {
  const w2 = radius * radius;
  if (radius === 0 || d2 >= w2) return 0;
  return Math.floor((255 * (w2 - d2)) / w2);
}

/**
 * CPU reference for the coast band. Returns straight RGBA8, row-major, row 0 first.
 * Throws CoastFxError: 'param' (radius, colour or size), 'limit' (a side above JFA_MAX_SIDE,
 * checked before the length), 'length' (seeds are not 2 * width * height).
 */
export function coastFxReference(
  seeds: Uint16Array,
  width: number,
  height: number,
  params: CoastFxParams,
): Uint8Array {
  const { radius, rgb } = params;
  if (!Number.isInteger(radius) || radius < 0 || radius > COAST_FX_MAX_RADIUS) {
    throw new CoastFxError('param', `radius ${radius} must be an integer from 0 to ${COAST_FX_MAX_RADIUS}`);
  }
  if (!rgb.every(isByte)) {
    throw new CoastFxError('param', 'each colour component must be an integer from 0 to 255');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new CoastFxError('param', 'width and height must be positive integers');
  }
  if (width > JFA_MAX_SIDE || height > JFA_MAX_SIDE) {
    throw new CoastFxError('limit', `a side exceeds ${JFA_MAX_SIDE}`);
  }
  const texels = width * height;
  if (seeds.length !== 2 * texels) {
    throw new CoastFxError('length', `seeds must hold ${2 * texels} values`);
  }
  const out = new Uint8Array(texels * 4);
  for (let p = 0; p < texels; p++) {
    const sx = seeds[2 * p];
    const sy = seeds[2 * p + 1];
    let alphaValue = 0;
    if (sx !== JFA_SENTINEL) {
      const dx = (p % width) - sx;
      const dy = Math.floor(p / width) - sy;
      alphaValue = bandAlpha(dx * dx + dy * dy, radius);
    }
    const i = 4 * p;
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = alphaValue;
  }
  return out;
}
