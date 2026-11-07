import { describe, expect, it } from 'vitest';
import { ExportError, type ExportErrorCode } from '../../src/core/export/errors.ts';
import { assembleSlices, checkCoverage, decodeBase64 } from '../../src/core/export/slices.ts';
import { planChunks, type ChunkRange } from '../../src/core/export/transfer.ts';

// Card 1.10 Stage B2 (detail v2): base64 slices, coverage and assembly for the transfer. Pure; Node only.

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

describe('decodeBase64 (card 1.10, Stage B2)', () => {
  it('matches Node Buffer on every length from 0 to 40', () => {
    for (let n = 0; n <= 40; n++) {
      const bytes = seededBytes(n, 0x1234 + n);
      const text = Buffer.from(bytes).toString('base64');
      expect(decodeBase64(text)).toEqual(bytes);
    }
  });

  it("refuses bad text with 'param'", () => {
    expect(codeOf(() => decodeBase64('QUJ'))).toBe('param'); // length not a multiple of 4
    expect(codeOf(() => decodeBase64('@@@@'))).toBe('param'); // characters outside the alphabet
    expect(codeOf(() => decodeBase64('QQ==QQ=='))).toBe('param'); // padding before the end
  });
});

describe('checkCoverage (card 1.10, Stage B2)', () => {
  it("accepts a canonical plan and refuses a gap, an overlap, a shifted range, a wrong end, an empty range and a wrong start with 'length'", () => {
    const canonical: ChunkRange[] = [
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
    ];
    expect(codeOf(() => checkCoverage(12, canonical))).toBe('ok');
    expect(codeOf(() => checkCoverage(12, [{ start: 0, end: 4 }, { start: 5, end: 8 }, { start: 8, end: 12 }]))).toBe('length'); // gap
    expect(codeOf(() => checkCoverage(12, [{ start: 0, end: 5 }, { start: 4, end: 8 }, { start: 8, end: 12 }]))).toBe('length'); // overlap
    expect(codeOf(() => checkCoverage(12, [{ start: 0, end: 4 }, { start: 4, end: 8 }, { start: 9, end: 12 }]))).toBe('length'); // shifted range
    expect(codeOf(() => checkCoverage(12, [{ start: 0, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 11 }]))).toBe('length'); // wrong end
    expect(codeOf(() => checkCoverage(12, [{ start: 0, end: 4 }, { start: 4, end: 4 }, { start: 4, end: 12 }]))).toBe('length'); // empty range
    expect(codeOf(() => checkCoverage(12, [{ start: 1, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 12 }]))).toBe('length'); // wrong start
  });
});

describe('assembleSlices (card 1.10, Stage B2)', () => {
  it('rebuilds the bytes from planChunks slices', () => {
    const bytes = seededBytes(1000, 0x5eed);
    const ranges = planChunks(bytes.length, 111);
    const texts = ranges.map((r) => Buffer.from(bytes.subarray(r.start, r.end)).toString('base64'));
    expect(assembleSlices(bytes.length, ranges, texts)).toEqual(bytes);
  });

  it("refuses a count mismatch with 'param' and a decoded size mismatch with 'length'", () => {
    const bytes = seededBytes(1000, 0x5eed);
    const ranges = planChunks(bytes.length, 111);
    const texts = ranges.map((r) => Buffer.from(bytes.subarray(r.start, r.end)).toString('base64'));
    expect(codeOf(() => assembleSlices(bytes.length, ranges, texts.slice(1)))).toBe('param');
    const short = [...texts];
    short[2] = Buffer.from(bytes.subarray(ranges[2].start, ranges[2].end - 1)).toString('base64');
    expect(codeOf(() => assembleSlices(bytes.length, ranges, short))).toBe('length');
  });
});
