import { describe, expect, it } from 'vitest';
import {
  GRADE_MAX_PIXELS,
  GRADE_VIGNETTE_INNER,
  GRADE_VIGNETTE_OUTER,
  GradeError,
  gradeRgba8,
} from '../../src/core/color/grade.ts';

const IDENTITY = { hueDeg: 0, sat: 1, val: 1, vignette: 0 };

function codeOrNone(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof GradeError ? error.code : 'other';
  }
}

describe('core colour grade', () => {
  it('exposes the fixed constants', () => {
    expect(GRADE_MAX_PIXELS).toBe(67108864);
    expect(GRADE_VIGNETTE_INNER).toBe(0.5);
    expect(GRADE_VIGNETTE_OUTER).toBe(1);
  });

  it('identity returns the input bytes exactly', () => {
    const input = new Uint8Array([
      0, 0, 0, 255,
      255, 255, 255, 255,
      128, 128, 128, 0,
      255, 0, 0, 128,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
    const out = gradeRgba8(input, 3, 2, IDENTITY);
    expect(Array.from(out)).toEqual(Array.from(input));
  });

  it('hue +60 turns red to yellow', () => {
    const out = gradeRgba8(new Uint8Array([255, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: 60 });
    expect(Array.from(out)).toEqual([255, 255, 0, 255]);
  });

  it('hue +120 turns red to green', () => {
    const out = gradeRgba8(new Uint8Array([255, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: 120 });
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
  });

  it('hue +240 and hue -120 turn red to blue', () => {
    const plus = gradeRgba8(new Uint8Array([255, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: 240 });
    const minus = gradeRgba8(new Uint8Array([255, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: -120 });
    expect(Array.from(plus)).toEqual([0, 0, 255, 255]);
    expect(Array.from(minus)).toEqual([0, 0, 255, 255]);
  });

  it('saturation 0 maps (200,100,50) to grey (200,200,200)', () => {
    const out = gradeRgba8(new Uint8Array([200, 100, 50, 255]), 1, 1, { ...IDENTITY, sat: 0 });
    expect(Array.from(out)).toEqual([200, 200, 200, 255]);
  });

  it('value 0 maps any colour to black and keeps alpha', () => {
    const out = gradeRgba8(new Uint8Array([200, 100, 50, 128]), 1, 1, { ...IDENTITY, val: 0 });
    expect(Array.from(out)).toEqual([0, 0, 0, 128]);
  });

  it('keeps alpha for every pixel of a fixed pattern', () => {
    const input = new Uint8Array([
      255, 0, 0, 0,
      0, 255, 0, 128,
      0, 0, 255, 255,
      200, 100, 50, 77,
    ]);
    const out = gradeRgba8(input, 2, 2, { ...IDENTITY, hueDeg: 120 });
    for (let p = 0; p < 4; p++) {
      expect(out[p * 4 + 3]).toBe(input[p * 4 + 3]);
    }
  });

  it('vignette 0.5 on a 3x3 grey image: centre 200, corner 100, edge 163', () => {
    const input = new Uint8Array(9 * 4).fill(200);
    for (let p = 0; p < 9; p++) input[p * 4 + 3] = 255;
    const out = gradeRgba8(input, 3, 3, { ...IDENTITY, vignette: 0.5 });
    const at = (x: number, y: number): number[] => {
      const o = (y * 3 + x) * 4;
      return [out[o], out[o + 1], out[o + 2], out[o + 3]];
    };
    expect(at(1, 1)).toEqual([200, 200, 200, 255]);
    expect(at(0, 0)).toEqual([100, 100, 100, 255]);
    expect(at(1, 0)).toEqual([163, 163, 163, 255]);
  });

  it('a 1x1 image with vignette is unchanged', () => {
    const input = new Uint8Array([200, 100, 50, 128]);
    const out = gradeRgba8(input, 1, 1, { ...IDENTITY, vignette: 1 });
    expect(Array.from(out)).toEqual([200, 100, 50, 128]);
  });

  it('NaN hue gives param', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array([0, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: NaN }))).toBe(
      'param',
    );
  });

  it('sat -1 gives param', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array([0, 0, 0, 255]), 1, 1, { ...IDENTITY, sat: -1 }))).toBe(
      'param',
    );
  });

  it('vignette 1.5 gives param', () => {
    expect(
      codeOrNone(() => gradeRgba8(new Uint8Array([0, 0, 0, 255]), 1, 1, { ...IDENTITY, vignette: 1.5 })),
    ).toBe('param');
  });

  it('wrong input length gives length', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array([0, 0, 0]), 1, 1, IDENTITY))).toBe('length');
  });

  it('oversize dimensions give limit before any allocation', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array(4), 65537, 1024, IDENTITY))).toBe('limit');
  });

  it('non-positive dimensions give param', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array(4), 0, 1, IDENTITY))).toBe('param');
    expect(codeOrNone(() => gradeRgba8(new Uint8Array(4), 1, 1.5, IDENTITY))).toBe('param');
  });

  it('same input gives the same bytes and never the input buffer', () => {
    const input = new Uint8Array([200, 100, 50, 128, 10, 20, 30, 40]);
    const a = gradeRgba8(input, 2, 1, { hueDeg: 30, sat: 1.5, val: 0.8, vignette: 0.25 });
    const b = gradeRgba8(input, 2, 1, { hueDeg: 30, sat: 1.5, val: 0.8, vignette: 0.25 });
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a).not.toBe(input);
    expect(a.buffer).not.toBe(input.buffer);
  });
  it('pins the red channel rounding: pure red at val 0.5 gives 128', () => {
    const out = gradeRgba8(new Uint8Array([255, 0, 0, 255]), 1, 1, { ...IDENTITY, val: 0.5 });
    expect(Array.from(out)).toEqual([128, 0, 0, 255]);
  });

  it('a pixel count equal to the cap passes the limit check', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array(4), 1, GRADE_MAX_PIXELS, IDENTITY))).toBe('length');
  });

  it('one pixel over the cap gives limit', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array(4), 1, GRADE_MAX_PIXELS + 1, IDENTITY))).toBe('limit');
  });

  it('zero height gives param', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array(4), 1, 0, IDENTITY))).toBe('param');
  });

  it('hue just outside plus or minus 360 gives param, and hue 360 equals hue 0', () => {
    expect(codeOrNone(() => gradeRgba8(new Uint8Array([0, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: 360.5 }))).toBe('param');
    expect(codeOrNone(() => gradeRgba8(new Uint8Array([0, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: -360.5 }))).toBe('param');
    const at360 = gradeRgba8(new Uint8Array([255, 0, 0, 255]), 1, 1, { ...IDENTITY, hueDeg: 360 });
    expect(Array.from(at360)).toEqual([255, 0, 0, 255]);
  });
  it('an input that cannot be converted to a string gives length, not a raw TypeError', () => {
    const hostile = Object.create(null) as unknown as Uint8Array;
    expect(codeOrNone(() => gradeRgba8(hostile, 1, 1, IDENTITY))).toBe('length');
  });

  it('sat and val accept 4 and reject anything above 4', () => {
    const px = new Uint8Array([200, 100, 50, 255]);
    expect(() => gradeRgba8(px, 1, 1, { ...IDENTITY, sat: 4, val: 4 })).not.toThrow();
    expect(codeOrNone(() => gradeRgba8(px, 1, 1, { ...IDENTITY, sat: 4.5 }))).toBe('param');
    expect(codeOrNone(() => gradeRgba8(px, 1, 1, { ...IDENTITY, val: 4.5 }))).toBe('param');
  });
});
