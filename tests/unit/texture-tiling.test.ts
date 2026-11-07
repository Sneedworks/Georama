import { describe, expect, it } from 'vitest';
import { TileError, tileRgba8 } from '../../src/core/texture/tiling.ts';

// A 2 by 2 texture. The red byte holds 1, 2, 3 and 4, so every texel is identifiable.
const TEX = new Uint8Array([
  1, 0, 0, 255, 2, 0, 0, 255,
  3, 0, 0, 255, 4, 0, 0, 255,
]);

function red(out: Uint8Array, width: number, x: number, y: number): number {
  return out[(y * width + x) * 4];
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof TileError ? error.code : 'other';
  }
}

describe('tileRgba8: the integer tile rule, hand-computed', () => {
  it('k 1 and no offset: row 0 reads 1 2 1 2, row 1 reads 3 4 3 4', () => {
    const out = tileRgba8(TEX, 2, 2, 4, 2, { k: 1, ox: 0, oy: 0 });
    expect([0, 1, 2, 3].map((x) => red(out, 4, x, 0))).toEqual([1, 2, 1, 2]);
    expect([0, 1, 2, 3].map((x) => red(out, 4, x, 1))).toEqual([3, 4, 3, 4]);
  });

  it('k 2: each texel covers two pixels, so both rows read 1 1 2 2', () => {
    const out = tileRgba8(TEX, 2, 2, 4, 2, { k: 2, ox: 0, oy: 0 });
    expect([0, 1, 2, 3].map((x) => red(out, 4, x, 0))).toEqual([1, 1, 2, 2]);
    expect([0, 1, 2, 3].map((x) => red(out, 4, x, 1))).toEqual([1, 1, 2, 2]);
  });

  it('an x offset of 1 shifts row 0 to 2 1 2 1', () => {
    const out = tileRgba8(TEX, 2, 2, 4, 1, { k: 1, ox: 1, oy: 0 });
    expect([0, 1, 2, 3].map((x) => red(out, 4, x, 0))).toEqual([2, 1, 2, 1]);
  });

  it('a y offset of 1 starts at texel row 1', () => {
    const out = tileRgba8(TEX, 2, 2, 2, 1, { k: 1, ox: 0, oy: 1 });
    expect([0, 1].map((x) => red(out, 2, x, 0))).toEqual([3, 4]);
  });

  it('refuses k outside 1 to 64 and negative offsets with code param', () => {
    expect(codeOf(() => tileRgba8(TEX, 2, 2, 4, 2, { k: 0, ox: 0, oy: 0 }))).toBe('param');
    expect(codeOf(() => tileRgba8(TEX, 2, 2, 4, 2, { k: 65, ox: 0, oy: 0 }))).toBe('param');
    expect(codeOf(() => tileRgba8(TEX, 2, 2, 4, 2, { k: 1, ox: -1, oy: 0 }))).toBe('param');
  });

  it('refuses a texture side of zero with code param', () => {
    expect(codeOf(() => tileRgba8(new Uint8Array(0), 0, 2, 4, 2, { k: 1, ox: 0, oy: 0 }))).toBe('param');
  });

  it('refuses an input whose length is not tw times th times 4 with code length', () => {
    expect(codeOf(() => tileRgba8(TEX.subarray(0, 15), 2, 2, 4, 2, { k: 1, ox: 0, oy: 0 }))).toBe('length');
  });

  it('refuses an output above the pixel limit with code limit, before any allocation', () => {
    expect(codeOf(() => tileRgba8(new Uint8Array(4), 1, 1, 65537, 1024, { k: 1, ox: 0, oy: 0 }))).toBe('limit');
  });

  it('gives the same bytes for the same input and never returns the input buffer', () => {
    const a = tileRgba8(TEX, 2, 2, 4, 2, { k: 1, ox: 1, oy: 1 });
    const b = tileRgba8(TEX, 2, 2, 4, 2, { k: 1, ox: 1, oy: 1 });
    expect(a).toEqual(b);
    expect(a).not.toBe(TEX);
    expect(a.length).toBe(4 * 2 * 4);
  });
});

describe('tileRgba8: float32 exactness precondition', () => {
  it('refuses an x index plus offset that reaches 2^24, code limit', () => {
    expect(codeOf(() => tileRgba8(TEX, 2, 2, 16777216, 1, { k: 1, ox: 1, oy: 0 }))).toBe('limit');
  });

  it('refuses a y index plus offset that reaches 2^24, code limit', () => {
    expect(codeOf(() => tileRgba8(TEX, 2, 2, 1, 16777216, { k: 1, ox: 0, oy: 1 }))).toBe('limit');
  });

  it('accepts the largest allowed offsets on a one-pixel output', () => {
    expect(codeOf(() => tileRgba8(TEX, 2, 2, 1, 1, { k: 1, ox: 65535, oy: 65535 }))).toBeUndefined();
  });
});
