import { describe, expect, it } from 'vitest';
import { extractTerritoryBorders } from '../../src/core/geometry/territory';

describe('portable B4 territory-border geometry', () => {
  it('emits one vertical edge between unlike horizontally adjacent territories', () => {
    expect(extractTerritoryBorders({ width: 2, height: 1, ids: [7, 9] })).toEqual({
      ok: true, borders: [{ x1: 1, y1: 0, x2: 1, y2: 1, a: 7, b: 9 }],
    });
  });

  it('emits one horizontal edge between unlike vertically adjacent territories', () => {
    expect(extractTerritoryBorders({ width: 1, height: 2, ids: [7, 9] })).toEqual({
      ok: true, borders: [{ x1: 0, y1: 1, x2: 1, y2: 1, a: 7, b: 9 }],
    });
  });

  it('emits each interior edge once, in stable row-major right-then-bottom order', () => {
    expect(extractTerritoryBorders({ width: 2, height: 2, ids: [1, 2, 3, 4] })).toEqual({
      ok: true, borders: [
        { x1: 1, y1: 0, x2: 1, y2: 1, a: 1, b: 2 },
        { x1: 0, y1: 1, x2: 1, y2: 1, a: 1, b: 3 },
        { x1: 1, y1: 1, x2: 2, y2: 1, a: 2, b: 4 },
        { x1: 1, y1: 1, x2: 1, y2: 2, a: 3, b: 4 },
      ],
    });
  });

  it('omits outer perimeter and all edges against unclaimed ID zero', () => {
    expect(extractTerritoryBorders({ width: 1, height: 1, ids: [5] }))
      .toEqual({ ok: true, borders: [] });
    for (const ids of [[0, 0], [0, 5], [5, 0]]) {
      expect(extractTerritoryBorders({ width: 2, height: 1, ids }))
        .toEqual({ ok: true, borders: [] });
    }
    for (const ids of [[0, 5], [5, 0]]) {
      expect(extractTerritoryBorders({ width: 1, height: 2, ids }))
        .toEqual({ ok: true, borders: [] });
    }
  });

  it('retains claimed-to-claimed borders next to unclaimed land in both axes', () => {
    expect(extractTerritoryBorders({
      width: 3, height: 2, ids: [0, 7, 9, 0, 7, 9],
    })).toEqual({ ok: true, borders: [
      { x1: 2, y1: 0, x2: 2, y2: 1, a: 7, b: 9 },
      { x1: 2, y1: 1, x2: 2, y2: 2, a: 7, b: 9 },
    ] });
  });

  it('accepts Uint16Array masks without mutating them or their identities', () => {
    const ids = new Uint16Array([1, 2, 1, 1, 2, 1]);
    const before = ids.slice();
    const a = extractTerritoryBorders({ width: 3, height: 2, ids });
    const b = extractTerritoryBorders({ width: 3, height: 2, ids });
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.borders).toHaveLength(4);
    expect(ids).toEqual(before);
  });

  it('rejects malformed dimensions, lengths, IDs and containers', () => {
    expect(extractTerritoryBorders({ width: 0, height: 1, ids: [1] })).toEqual({ ok: false, code: 'INPUT' });
    expect(extractTerritoryBorders({ width: 2, height: 1, ids: [1] })).toEqual({ ok: false, code: 'INPUT' });
    for (const id of [-1, 1.5, NaN, Infinity, 65536]) {
      expect(extractTerritoryBorders({ width: 1, height: 1, ids: [id] }))
        .toEqual({ ok: false, code: 'INPUT' });
    }
    expect(extractTerritoryBorders({ width: 1, height: 1, ids: '5' as never }))
      .toEqual({ ok: false, code: 'INPUT' });
  });

  it('bounds both input cells and generated edges', () => {
    const checkerboard = [1, 2, 2, 1];
    expect(extractTerritoryBorders({ width: 2, height: 2, ids: checkerboard, maxBorders: 1 }))
      .toEqual({ ok: false, code: 'LIMIT' });
    expect(extractTerritoryBorders({ width: 4097, height: 1, ids: [] }))
      .toEqual({ ok: false, code: 'LIMIT' });
    expect(extractTerritoryBorders({ width: 1024, height: 1025, ids: [] }))
      .toEqual({ ok: false, code: 'LIMIT' });
    expect(extractTerritoryBorders({ width: 1, height: 1, ids: [1], maxBorders: 0 }))
      .toEqual({ ok: false, code: 'INPUT' });
    expect(extractTerritoryBorders({ width: 1, height: 1, ids: [1], maxBorders: 65537 }))
      .toEqual({ ok: false, code: 'LIMIT' });
  });
});
