import { describe, expect, it } from 'vitest';
import { ExportError, type ExportErrorCode } from '../../src/core/export/errors.ts';
import { compareGrade } from '../../src/core/export/compare.ts';

// Card 1.10 Stage B2 detail v3: grade comparison for the probe pass rule (D-B2-3). Pure; Node only.

function codeOf(fn: () => unknown): ExportErrorCode | 'ok' {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (error instanceof ExportError) return error.code;
    throw error;
  }
}

function seededBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s & 0xff;
  }
  return out;
}

// Two pixels with opaque alpha, so alphaOk starts at the total.
function twoPixels(): { out: Uint8Array; ref: Uint8Array } {
  const ref = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  return { out: new Uint8Array(ref), ref };
}

describe('compareGrade (card 1.10, Stage B2 v3)', () => {
  it('identical inputs are exact', () => {
    const { out, ref } = twoPixels();
    expect(compareGrade(out, ref, 2, 1)).toEqual({ exact: 2, diff1: 0, diff2plus: 0, maxDiff: 0, alphaOk: 2 });
  });

  it('one channel off by 1 counts as diff1', () => {
    const { out, ref } = twoPixels();
    out[0] = 11;
    expect(compareGrade(out, ref, 2, 1)).toEqual({ exact: 1, diff1: 1, diff2plus: 0, maxDiff: 1, alphaOk: 2 });
  });

  it('one channel off by 2 counts as diff2plus', () => {
    const { out, ref } = twoPixels();
    out[5] = 52;
    expect(compareGrade(out, ref, 2, 1)).toEqual({ exact: 1, diff1: 0, diff2plus: 1, maxDiff: 2, alphaOk: 2 });
  });

  it('alpha 254 is not ok', () => {
    const { out, ref } = twoPixels();
    out[3] = 254;
    const result = compareGrade(out, ref, 2, 1);
    expect(result.alphaOk).toBe(1);
    expect(result.exact).toBe(1);
    expect(result.diff1).toBe(1);
    expect(result.maxDiff).toBe(1);
  });

  it('a length mismatch is refused with param', () => {
    const { out, ref } = twoPixels();
    expect(codeOf(() => compareGrade(out.subarray(0, 4), ref, 2, 1))).toBe('param');
    expect(codeOf(() => compareGrade(out, ref, 0, 1))).toBe('param');
  });

  it('a seeded pair whose differences are all at most 1 reports maxDiff <= 1', () => {
    const width = 16;
    const height = 8;
    const total = width * height;
    const ref = seededBytes(total * 4, 0x51f2);
    for (let i = 3; i < ref.length; i += 4) ref[i] = 255;
    const out = new Uint8Array(ref);
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const base = ref[i + c];
        const step = (i + c) % 3 - 1;
        const next = base + step;
        out[i + c] = next < 0 ? 0 : next > 255 ? 255 : next;
      }
    }
    const result = compareGrade(out, ref, width, height);
    expect(result.maxDiff).toBeLessThanOrEqual(1);
    expect(result.diff2plus).toBe(0);
    expect(result.exact + result.diff1).toBe(total);
    expect(result.alphaOk).toBe(total);
  });
});
