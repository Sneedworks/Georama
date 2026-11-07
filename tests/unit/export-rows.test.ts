import { describe, expect, it } from 'vitest';
import { ExportError } from '../../src/core/export/errors.ts';
import { flipRows } from '../../src/core/export/rows.ts';

// Card 1.10 Stage C step 1 (detail v3, P18): the single row flip of the PNG writer.
// Readback bytes are bottom-up (row 0 is the bottom row). A PNG writer flips the rows once.

/** Builds an RGBA buffer from rows of bytes; each texel is [value, 0, 0, 255]. */
function redRows(values: number[][]): Uint8Array {
  const height = values.length;
  const width = values[0].length;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = values[y][x];
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Reads the red byte of every texel back into rows. */
function readRed(rgba: Uint8Array, width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(rgba[(y * width + x) * 4]);
    rows.push(row);
  }
  return rows;
}

/** The error code thrown by fn, or 'none' when it returns, or 'other' for a non-export error. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof ExportError ? error.code : 'other';
  }
}

describe('flipRows (PNG writer row flip)', () => {
  it('reverses the row order of a 2 x 2 asymmetric image', () => {
    const input = redRows([
      [10, 20],
      [30, 40],
    ]);
    expect(readRed(flipRows(input, 2, 2), 2, 2)).toEqual([
      [30, 40],
      [10, 20],
    ]);
  });

  it('moves all four bytes of a texel together', () => {
    const input = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(Array.from(flipRows(input, 2, 2))).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reverses a single column of three rows', () => {
    expect(readRed(flipRows(redRows([[1], [2], [3]]), 1, 3), 1, 3)).toEqual([[3], [2], [1]]);
  });

  it('leaves a single row unchanged', () => {
    expect(readRed(flipRows(redRows([[1, 2, 3]]), 3, 1), 3, 1)).toEqual([[1, 2, 3]]);
  });

  it('flipping twice gives the input back', () => {
    const values = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
      [12, 13, 14, 15],
      [16, 17, 18, 19],
    ];
    const input = redRows(values);
    expect(Array.from(flipRows(flipRows(input, 4, 5), 4, 5))).toEqual(Array.from(input));
  });

  it('returns a new buffer and does not change its input', () => {
    const input = redRows([
      [1, 2],
      [3, 4],
    ]);
    const before = Array.from(input);
    const out = flipRows(input, 2, 2);
    expect(out).not.toBe(input);
    expect(Array.from(input)).toEqual(before);
  });

  it('refuses a byte length that is not width x height x 4 with code length', () => {
    expect(codeOf(() => flipRows(new Uint8Array(15), 2, 2))).toBe('length');
  });

  it('refuses bad dimensions with code param', () => {
    expect(codeOf(() => flipRows(new Uint8Array(4), 0, 1))).toBe('param');
    expect(codeOf(() => flipRows(new Uint8Array(4), 1, 0))).toBe('param');
    expect(codeOf(() => flipRows(new Uint8Array(4), 1.5, 1))).toBe('param');
    expect(codeOf(() => flipRows(new Uint8Array(4), 1, -1))).toBe('param');
    expect(codeOf(() => flipRows(new Uint8Array(4), Number.NaN, 1))).toBe('param');
  });
});
