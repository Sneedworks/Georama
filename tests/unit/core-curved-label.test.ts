import { describe, expect, it } from 'vitest';
import { layoutCurvedLabel } from '../../src/core/geometry/curved-label';

describe('portable curved label layout', () => {
  it('centers glyphs along a straight path using supplied advances', () => {
    const r = layoutCurvedLabel({
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      advances: [2, 4],
    });
    expect(r).toEqual({ ok: true, pathLength: 10, placements: [
      { x: 3, y: 0, angle: 0, distance: 3, advance: 2 },
      { x: 6, y: 0, angle: 0, distance: 6, advance: 4 },
    ] });
  });

  it('follows segment tangents around a corner and skips repeated vertices', () => {
    const r = layoutCurvedLabel({
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }],
      advances: [2, 2, 2, 2, 2],
      anchor: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.placements.map(p => [p.x, p.y])).toEqual([
      [1, 0], [3, 0], [4, 1], [4, 3], [4, 5],
    ]);
    expect(r.placements[1].angle).toBe(0);
    expect(r.placements[2].angle).toBe(Math.PI / 2);
  });

  it('honors anchor and letter spacing', () => {
    const r = layoutCurvedLabel({
      points: [{ x: 0, y: 0 }, { x: 12, y: 0 }],
      advances: [2, 2], letterSpacing: 2, anchor: 1,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.placements.map(p => p.x)).toEqual([7, 11]);
  });

  it('reports FIT when glyph advances exceed available path length', () => {
    expect(layoutCurvedLabel({
      points: [{ x: 0, y: 0 }, { x: 3, y: 0 }], advances: [2, 2],
    })).toEqual({ ok: false, code: 'FIT' });
  });

  it('rejects invalid metrics, degenerate paths and oversized requests', () => {
    const base = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], advances: [2] };
    expect(layoutCurvedLabel({ ...base, advances: [0] })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutCurvedLabel({ ...base, letterSpacing: -1 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutCurvedLabel({ ...base, anchor: 2 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutCurvedLabel({ ...base, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }))
      .toEqual({ ok: false, code: 'INPUT' });
    expect(layoutCurvedLabel({ ...base, maxGlyphs: 0 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutCurvedLabel({ ...base, maxGlyphs: 1, advances: [1, 1] }))
      .toEqual({ ok: false, code: 'LIMIT' });
  });
});
