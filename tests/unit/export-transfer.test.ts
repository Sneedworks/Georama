import { describe, expect, it } from 'vitest';
import { ExportError, type ExportErrorCode } from '../../src/core/export/errors.ts';
import { TRANSFER_MAX_CHUNK_BYTES, planChunks } from '../../src/core/export/transfer.ts';

// Card 1.10 Stage B1 (detail v2): chunk planner for the page transfer. Pure; Node only.

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
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

describe('planChunks (card 1.10, Stage B1)', () => {
  it('covers the range in order, with the last chunk short', () => {
    expect(planChunks(10, 3)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: 9 },
      { start: 9, end: 10 },
    ]);
    expect(planChunks(6, 3)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
  });

  it('keeps base64 aligned: slices of a multiple of 3 concatenate to the base64 of the whole', () => {
    const bytes = seededBytes(1000, 0x5eed);
    const parts = planChunks(bytes.length, 3 * 37).map((r) =>
      Buffer.from(bytes.subarray(r.start, r.end)).toString('base64'),
    );
    expect(parts.join('')).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('splits a full canvas of 8000 x 4000 RGBA8 into 31 chunks, the last short', () => {
    const ranges = planChunks(128000000, TRANSFER_MAX_CHUNK_BYTES);
    expect(ranges).toHaveLength(31);
    for (const r of ranges.slice(0, 30)) expect(r.end - r.start).toBe(4194303);
    expect(ranges[ranges.length - 1]).toEqual({ start: 125829090, end: 128000000 });
  });

  it("refuses bad sizes with code 'param'", () => {
    expect(codeOf(() => planChunks(0, 3))).toBe('param');
    expect(codeOf(() => planChunks(1.5, 3))).toBe('param');
    expect(codeOf(() => planChunks(Number.NaN, 3))).toBe('param');
    expect(codeOf(() => planChunks(10, 0))).toBe('param');
    expect(codeOf(() => planChunks(10, 4))).toBe('param');
    expect(codeOf(() => planChunks(10, 4194306))).toBe('param');
    expect(codeOf(() => planChunks(10, 2147483648))).toBe('param');
  });

  it('fixes the constant at the largest multiple of 3 not above 4 MiB', () => {
    expect(TRANSFER_MAX_CHUNK_BYTES).toBe(4194303);
    expect(TRANSFER_MAX_CHUNK_BYTES % 3).toBe(0);
    expect(TRANSFER_MAX_CHUNK_BYTES).toBe(3 * 1398101);
    expect(TRANSFER_MAX_CHUNK_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});
