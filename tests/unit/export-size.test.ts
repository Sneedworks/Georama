import { describe, expect, it } from 'vitest';
import { GRADE_MAX_PIXELS } from '../../src/core/color/grade.ts';
import { ExportError, type ExportErrorCode } from '../../src/core/export/errors.ts';
import { EXPORT_MAX_PIXELS, EXPORT_MAX_SIDE, checkExportSize } from '../../src/core/export/size.ts';

// Card 1.10, decision D3: 8192 px per side and GRADE_MAX_PIXELS in total. Detail v1, Stage A.

function codeOf(width: unknown, height: unknown): ExportErrorCode | 'ok' {
  try {
    checkExportSize(width, height);
    return 'ok';
  } catch (error) {
    if (error instanceof ExportError) return error.code;
    throw error;
  }
}

describe('export size rule (card 1.10, D3)', () => {
  it('pins the constants: 8192 per side, and GRADE_MAX_PIXELS in total', () => {
    expect(EXPORT_MAX_SIDE).toBe(8192);
    expect(EXPORT_MAX_PIXELS).toBe(67108864);
    expect(EXPORT_MAX_PIXELS).toBe(GRADE_MAX_PIXELS);
  });

  it('accepts sizes within the cap and returns them as given', () => {
    const sizes = [[1, 1], [8000, 4000], [7016, 4960], [8192, 4096], [8192, 8192]] as const;
    for (const [width, height] of sizes) {
      expect(checkExportSize(width, height)).toEqual({ width, height });
    }
  });

  it("refuses a side above 8192 with code 'limit'", () => {
    expect(codeOf(8193, 1)).toBe('limit');
    expect(codeOf(1, 8193)).toBe('limit');
    expect(codeOf(8192, 8193)).toBe('limit');
  });

  it("refuses zero, negative, non-integer, non-finite or non-number values with code 'param'", () => {
    const bad = [[0, 4], [4, 0], [-1, 4], [2.5, 4], [Number.NaN, 4], [Number.POSITIVE_INFINITY, 4], ['8', 4]] as const;
    for (const [width, height] of bad) {
      expect(codeOf(width, height)).toBe('param');
    }
  });

  it('throws an ExportError instance that carries the code', () => {
    let caught: unknown = null;
    try {
      checkExportSize(8193, 1);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExportError);
    expect((caught as ExportError).code).toBe('limit');
  });

  it('builds an ExportError for each documented code, with its name set', () => {
    for (const code of ['param', 'limit', 'length', 'deflate'] as const) {
      const error = new ExportError(code, 'probe');
      expect(error.code).toBe(code);
      expect(error.name).toBe('ExportError');
    }
  });
});
