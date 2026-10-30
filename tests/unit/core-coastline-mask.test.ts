import { describe, expect, it } from 'vitest';
import { extractCoastSegments } from '../../src/core/geometry/coastline';

describe('portable coastline mask geometry', () => {
  it('extracts four clockwise edges around one land cell', () => {
    expect(extractCoastSegments({ width: 1, height: 1, land: [1] })).toEqual({
      ok: true, segments: [
        { x1: 0, y1: 0, x2: 1, y2: 0 },
        { x1: 1, y1: 0, x2: 1, y2: 1 },
        { x1: 1, y1: 1, x2: 0, y2: 1 },
        { x1: 0, y1: 1, x2: 0, y2: 0 },
      ],
    });
  });

  it('does not emit interior shared edges between adjacent land cells', () => {
    const r = extractCoastSegments({ width: 2, height: 1, land: new Uint8Array([1, 1]) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.segments).toHaveLength(6);
      expect(r.segments.some(s => s.x1 === 1 && s.x2 === 1)).toBe(false);
    }
  });

  it('preserves distinct edges for diagonally touching land cells', () => {
    const r = extractCoastSegments({ width: 2, height: 2, land: [1, 0, 0, 1] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.segments).toHaveLength(8);
  });

  it('extracts lake shorelines and supports treating the exterior as land', () => {
    const land = [1, 1, 1, 1, 0, 1, 1, 1, 1];
    const a = extractCoastSegments({ width: 3, height: 3, land });
    const b = extractCoastSegments({ width: 3, height: 3, land, outsideIsWater: false });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.segments).toHaveLength(16);
      expect(b.segments).toHaveLength(4);
    }
  });

  it('returns no edges for an all-water mask', () => {
    expect(extractCoastSegments({ width: 2, height: 2, land: [0, 0, 0, 0] }))
      .toEqual({ ok: true, segments: [] });
  });

  it('rejects malformed masks and bounds output', () => {
    expect(extractCoastSegments({ width: 2, height: 1, land: [1] }))
      .toEqual({ ok: false, code: 'LIMIT' });
    expect(extractCoastSegments({ width: 1, height: 1, land: [2] }))
      .toEqual({ ok: false, code: 'INPUT' });
    expect(extractCoastSegments({ width: 1, height: 1, land: [1], maxSegments: 3 }))
      .toEqual({ ok: false, code: 'LIMIT' });
    expect(extractCoastSegments({ width: 4097, height: 1, land: [] }))
      .toEqual({ ok: false, code: 'LIMIT' });
  });
});
