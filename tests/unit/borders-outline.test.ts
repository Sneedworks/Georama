// Card 1.7, step 1 (RED): closure and the border wrappers, written before src/core/borders/outline.ts exists.
// The wrappers reuse the card 1.6 path mechanism unchanged; only closeOutline is new.
import { describe, expect, it } from 'vitest';
import { PathError, pathIndexTable, pathLayerReference, type PathStyle } from '../../src/core/paths/textured.ts';
import { borderIndexTable, borderLayerReference, closeOutline } from '../../src/core/borders/outline.ts';
import { borderVectorSets, borderVectorStyle } from '../gpu/borders-vectors.ts';

const STYLE: PathStyle = {
  width: 2,
  height: 2,
  bytes: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]),
};
const COLOUR: readonly [number, number, number, number] = [200, 120, 40, 255];

// The PathError code a call throws; fails if the call throws anything else or throws nothing.
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof PathError) return error.code;
    throw error;
  }
  throw new Error('expected a PathError; nothing was thrown');
}

describe('closeOutline', () => {
  it('returns the same object when the outline is open', () => {
    const points = new Float32Array([1, 2, 3, 4]);
    expect(closeOutline(points, false)).toBe(points);
  });

  it('appends a copy of the first pair when the outline is closed', () => {
    const closed = closeOutline(new Float32Array([1.5, 2.5, 3, 4]), true);
    expect(Array.from(closed)).toEqual([1.5, 2.5, 3, 4, 1.5, 2.5]);
  });

  it('throws length on odd input, whether or not the outline is closed', () => {
    expect(codeOf(() => closeOutline(new Float32Array([1, 2, 3]), false))).toBe('length');
    expect(codeOf(() => closeOutline(new Float32Array([1, 2, 3]), true))).toBe('length');
  });

  it('an empty outline stays empty when closed; the wrappers refuse it with param (fewer than two vertices)', () => {
    expect(closeOutline(new Float32Array(0), true).length).toBe(0);
    expect(codeOf(() => borderIndexTable(new Float32Array(0), true, 2, 16, STYLE))).toBe('param');
  });
});

describe('border wrappers', () => {
  it('a closed outline whose last point equals its first gives the table of the closed outline without the repeat (B1)', () => {
    const withRepeat = new Float32Array([10.2, 5.7, 40.9, 30.1, 60, 47.6, 10.2, 5.7]);
    const withoutRepeat = new Float32Array([10.2, 5.7, 40.9, 30.1, 60, 47.6]);
    expect(borderIndexTable(withRepeat, true, 2, 16, STYLE)).toEqual(borderIndexTable(withoutRepeat, true, 2, 16, STYLE));
  });

  it('borderIndexTable equals pathIndexTable of the closed outline, and borderLayerReference equals pathLayerReference of that table', () => {
    const points = new Float32Array([5.2, 6.8, 20.4, 9.1, 12.7, 30.2]);
    const table = borderIndexTable(points, true, 3, 9, STYLE);
    expect(table).toEqual(pathIndexTable(closeOutline(points, true), 3, 9, STYLE));
    expect(borderLayerReference(points, true, 3, 9, STYLE, COLOUR)).toEqual(pathLayerReference(table, STYLE, COLOUR));
  });

  it('for each vector set, borderIndexTable equals pathIndexTable of the closed outline, and borderLayerReference equals pathLayerReference of that table', () => {
    for (const set of borderVectorSets) {
      const table = borderIndexTable(set.points, set.closed, set.width, set.period, borderVectorStyle);
      expect(table, set.name).toEqual(pathIndexTable(closeOutline(set.points, set.closed), set.width, set.period, borderVectorStyle));
      expect(borderLayerReference(set.points, set.closed, set.width, set.period, borderVectorStyle, COLOUR), set.name).toEqual(
        pathLayerReference(table, borderVectorStyle, COLOUR),
      );
    }
  });

  it('a coordinate of 64.4 gives limit, because the raw bound is checked before rounding', () => {
    expect(codeOf(() => borderIndexTable(new Float32Array([10, 10, 64.4, 20]), false, 2, 16, STYLE))).toBe('limit');
  });

  it('64 closed vertices pairwise distinct after rounding give limit (B2); the same 64 open do not', () => {
    const flat = new Float32Array(128);
    for (let i = 0; i < 64; i++) {
      flat[2 * i] = i;
      flat[2 * i + 1] = 0;
    }
    expect(() => borderIndexTable(flat, false, 2, 16, STYLE)).not.toThrow();
    expect(codeOf(() => borderIndexTable(flat, true, 2, 16, STYLE))).toBe('limit');
  });

  it('64 raw-distinct vertices that all round to one point give param, not limit (B2)', () => {
    const flat = new Float32Array(128);
    for (let i = 0; i < 64; i++) {
      flat[2 * i] = 0.1 + 0.001 * i;
      flat[2 * i + 1] = 0.1;
    }
    expect(codeOf(() => borderIndexTable(flat, false, 2, 16, STYLE))).toBe('param');
    expect(codeOf(() => borderIndexTable(flat, true, 2, 16, STYLE))).toBe('param');
  });

  it('each PathError code passes through the wrappers unchanged', () => {
    expect(codeOf(() => borderIndexTable(new Float32Array([1, 2, 3, 4]), false, 0, 16, STYLE))).toBe('param');
    expect(codeOf(() => borderLayerReference(new Float32Array([1, 2, 3]), true, 2, 16, STYLE, COLOUR))).toBe('length');
    expect(codeOf(() => borderLayerReference(new Float32Array([10, 10, 64.4, 20]), false, 2, 16, STYLE, COLOUR))).toBe('limit');
  });
});
