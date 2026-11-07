import { describe, expect, it } from 'vitest';
import { COAST_FX_MAX_RADIUS, CoastFxError, coastFxReference } from '../../src/core/coast/fx.ts';
import { JFA_MAX_SIDE, JFA_SENTINEL } from '../../src/core/sdf/jfa.ts';

// Card 1.5 step 1 (RED): hand-computed cases for the coast band.
// src/core/coast/fx.ts is not written yet, so this file must fail on the import.

const RGB = [10, 20, 30] as const;
const W2 = { radius: 2, rgb: RGB } as const;

// Every texel carries the seed (sx, sy). Seeds are two Uint16 per texel.
function seeded(width: number, height: number, sx: number, sy: number): Uint16Array {
  const seeds = new Uint16Array(2 * width * height);
  for (let p = 0; p < width * height; p++) {
    seeds[2 * p] = sx;
    seeds[2 * p + 1] = sy;
  }
  return seeds;
}

function alpha(out: Uint8Array, width: number, x: number, y: number): number {
  return out[(y * width + x) * 4 + 3];
}

function rgb(out: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [out[i], out[i + 1], out[i + 2]];
}

function codeOf(run: () => unknown): string {
  try {
    run();
    return 'no error';
  } catch (error) {
    return error instanceof CoastFxError ? error.code : 'other';
  }
}

describe('coast band: hand-computed 3x3 case (W = 2, seed (0,0) on all nine texels)', () => {
  // Squared distances d2: 0 at (0,0); 1 at (1,0) and (0,1); 2 at (1,1);
  // 4 at (2,0) and (0,2); 5 at (2,1) and (1,2); 8 at (2,2). W^2 = 4.
  const out = coastFxReference(seeded(3, 3, 0, 0), 3, 3, W2);

  it('alpha is 255, 191, 127 and 0 at the hand-computed texels', () => {
    expect(alpha(out, 3, 0, 0)).toBe(255); // d2 = 0
    expect(alpha(out, 3, 1, 0)).toBe(191); // d2 = 1: floor(255 * 3 / 4) = floor(191.25)
    expect(alpha(out, 3, 0, 1)).toBe(191); // d2 = 1
    expect(alpha(out, 3, 1, 1)).toBe(127); // d2 = 2: floor(255 * 2 / 4) = floor(127.5)
    expect(alpha(out, 3, 2, 0)).toBe(0); // d2 = 4 = W^2
    expect(alpha(out, 3, 0, 2)).toBe(0); // d2 = 4
    expect(alpha(out, 3, 2, 1)).toBe(0); // d2 = 5
    expect(alpha(out, 3, 1, 2)).toBe(0); // d2 = 5
    expect(alpha(out, 3, 2, 2)).toBe(0); // d2 = 8
  });

  it('RGB is the test colour at every texel, including alpha 0', () => {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) expect(rgb(out, 3, x, y)).toEqual([...RGB]);
    }
  });
});

describe('coast band: W = 0 and sentinel texels', () => {
  it('W = 0 gives alpha 0 everywhere', () => {
    const out = coastFxReference(seeded(3, 1, 0, 0), 3, 1, { radius: 0, rgb: RGB });
    for (let x = 0; x < 3; x++) expect(alpha(out, 3, x, 0)).toBe(0);
  });

  it('a sentinel texel gives alpha 0; the seeded texel keeps its band', () => {
    const seeds = new Uint16Array([0, 0, JFA_SENTINEL, JFA_SENTINEL]);
    const out = coastFxReference(seeds, 2, 1, W2);
    expect(alpha(out, 2, 0, 0)).toBe(255);
    expect(alpha(out, 2, 1, 0)).toBe(0);
  });
});

describe('coast band: refusals', () => {
  const seeds = seeded(2, 2, 0, 0);

  it.each([
    ['radius is not an integer', { radius: 1.5, rgb: RGB }],
    ['radius is below 0', { radius: -1, rgb: RGB }],
    ['radius is above COAST_FX_MAX_RADIUS', { radius: COAST_FX_MAX_RADIUS + 1, rgb: RGB }],
    ['a colour component is above 255', { radius: 2, rgb: [256, 0, 0] }],
    ['a colour component is below 0', { radius: 2, rgb: [0, -1, 0] }],
  ])('param: %s', (_name, params) => {
    expect(codeOf(() => coastFxReference(seeds, 2, 2, params as never))).toBe('param');
  });

  it('length: seeds of the wrong size', () => {
    expect(codeOf(() => coastFxReference(new Uint16Array(3), 2, 2, W2))).toBe('length');
  });

  it('limit: a side above JFA_MAX_SIDE is refused before the length check', () => {
    // Two entries are far too short for these sides, so only the limit check can answer 'limit'.
    expect(codeOf(() => coastFxReference(new Uint16Array(2), JFA_MAX_SIDE + 1, 1, W2))).toBe('limit');
    expect(codeOf(() => coastFxReference(new Uint16Array(2), 1, JFA_MAX_SIDE + 1, W2))).toBe('limit');
  });
});
