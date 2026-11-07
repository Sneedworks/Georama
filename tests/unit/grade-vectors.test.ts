import { describe, expect, it } from 'vitest';
import { gradeRgba8 } from '../../src/core/color/grade.ts';
import {
  GRADE_IMAGE_HEIGHT,
  GRADE_IMAGE_WIDTH,
  GRADE_MARGIN,
  GRADE_PARAM_SETS,
  copyGradeRgba8,
  countAtRisk,
  makeGradeImage,
} from '../gpu/grade-vectors.ts';

const W = GRADE_IMAGE_WIDTH;
const H = GRADE_IMAGE_HEIGHT;

function samePixel(bytes: Uint8Array, a: number, b: number): boolean {
  for (let k = 0; k < 4; k++) {
    if (bytes[a + k] !== bytes[b + k]) return false;
  }
  return true;
}

describe('card 1.2 fixed vectors', () => {
  const image = makeGradeImage();

  it('fixes the size and six parameter sets, the first being the identity', () => {
    expect(W).toBe(96);
    expect(H).toBe(64);
    expect(GRADE_PARAM_SETS).toHaveLength(6);
    expect(GRADE_PARAM_SETS[0]).toEqual({ hueDeg: 0, sat: 1, val: 1, vignette: 0 });
  });

  it('keeps every parameter set inside the card 1.1 ranges', () => {
    for (const p of GRADE_PARAM_SETS) {
      expect(p.hueDeg).toBeGreaterThanOrEqual(-360);
      expect(p.hueDeg).toBeLessThanOrEqual(360);
      expect(p.sat).toBeGreaterThanOrEqual(0);
      expect(p.sat).toBeLessThanOrEqual(4);
      expect(p.val).toBeGreaterThanOrEqual(0);
      expect(p.val).toBeLessThanOrEqual(4);
      expect(p.vignette).toBeGreaterThanOrEqual(0);
      expect(p.vignette).toBeLessThanOrEqual(1);
    }
  });

  it('generates the same bytes on every call (fixed seed)', () => {
    expect(makeGradeImage()).toEqual(image);
  });

  it('is asymmetric: it differs from its own row flip and from its own transpose', () => {
    const px = (x: number, y: number) => (y * W + x) * 4;
    let flipDiffers = false;
    for (let y = 0; y < H && !flipDiffers; y++) {
      for (let x = 0; x < W && !flipDiffers; x++) {
        if (!samePixel(image, px(x, y), px(x, H - 1 - y))) flipDiffers = true;
      }
    }
    let transposeDiffers = false;
    for (let y = 0; y < 64 && !transposeDiffers; y++) {
      for (let x = 0; x < 64 && !transposeDiffers; x++) {
        if (!samePixel(image, px(x, y), px(y, x))) transposeDiffers = true;
      }
    }
    expect(flipDiffers).toBe(true);
    expect(transposeDiffers).toBe(true);
  });

  it('fixes the rounding margin at 0.01 byte units', () => {
    expect(GRADE_MARGIN).toBe(0.01);
  });

  it('copies the card 1.1 steps: the copy equals gradeRgba8 bytes for every set', () => {
    for (const params of GRADE_PARAM_SETS) {
      expect(copyGradeRgba8(image, W, H, params)).toEqual(gradeRgba8(image, W, H, params));
    }
  });

  it('has no at-risk rounding value in any set, at either stage', () => {
    for (const params of GRADE_PARAM_SETS) {
      expect(countAtRisk(image, W, H, params, GRADE_MARGIN)).toBe(0);
    }
  });

  it('returns the input bytes exactly for the identity set', () => {
    expect(gradeRgba8(image, W, H, GRADE_PARAM_SETS[0])).toEqual(image);
  });

  it('detects an at-risk value at stage 1 (channel 3 at val 0.5 gives 1.5)', () => {
    const one = new Uint8Array([3, 3, 3, 255]);
    expect(countAtRisk(one, 1, 1, { hueDeg: 0, sat: 1, val: 0.5, vignette: 0 }, GRADE_MARGIN)).toBeGreaterThan(0);
  });

  it('detects an at-risk value at stage 2 (corner factor 0.5 on a 1 times 1 value gives 0.5)', () => {
    const grid = new Uint8Array(3 * 3 * 4);
    for (let i = 0; i < 9; i++) grid.set([1, 1, 1, 255], i * 4);
    expect(countAtRisk(grid, 3, 3, { hueDeg: 0, sat: 1, val: 1, vignette: 0.5 }, GRADE_MARGIN)).toBeGreaterThan(0);
  });
});
