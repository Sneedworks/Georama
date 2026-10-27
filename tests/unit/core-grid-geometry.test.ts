import { describe, expect, it } from 'vitest';
import { generateGridLines } from '../../src/core/geometry/grid';

const base = {
  minX: -5, minY: -3, maxX: 5, maxY: 3,
  originX: 0, originY: 0, stepX: 2, stepY: 2,
};

describe('portable map grid geometry', () => {
  it('anchors grid coordinates to the supplied origin in stable axis order', () => {
    const result = generateGridLines(base);
    expect(result).toEqual({ ok: true, lines: [
      { axis: 'x', coordinate: -4, index: -2 },
      { axis: 'x', coordinate: -2, index: -1 },
      { axis: 'x', coordinate: 0, index: 0 },
      { axis: 'x', coordinate: 2, index: 1 },
      { axis: 'x', coordinate: 4, index: 2 },
      { axis: 'y', coordinate: -2, index: -1 },
      { axis: 'y', coordinate: 0, index: 0 },
      { axis: 'y', coordinate: 2, index: 1 },
    ] });
  });

  it('produces identical shared lines in overlapping viewports', () => {
    const a = generateGridLines({ ...base, minX: -10, maxX: 4 });
    const b = generateGridLines({ ...base, minX: 0, maxX: 10 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const sharedA = a.lines.filter(line => line.axis === 'x' && line.coordinate >= 0 && line.coordinate <= 4);
    const sharedB = b.lines.filter(line => line.axis === 'x' && line.coordinate >= 0 && line.coordinate <= 4);
    expect(sharedA).toEqual(sharedB);
  });

  it('supports shifted origins and degenerate point viewports', () => {
    expect(generateGridLines({ ...base, minX: 1, maxX: 1, minY: 3, maxY: 3, originX: 1, originY: 3 }))
      .toEqual({ ok: true, lines: [
        { axis: 'x', coordinate: 1, index: 0 },
        { axis: 'y', coordinate: 3, index: 0 },
      ] });
  });

  it('returns empty lines for a viewport containing no grid crossing', () => {
    expect(generateGridLines({ ...base, minX: 0.2, maxX: 0.4, minY: 0.2, maxY: 0.4 }))
      .toEqual({ ok: true, lines: [] });
  });

  it('rejects invalid inputs and caps the number of generated lines', () => {
    expect(generateGridLines({ ...base, stepX: 0 })).toEqual({ ok: false, code: 'INPUT' });
    expect(generateGridLines({ ...base, minX: 6 })).toEqual({ ok: false, code: 'INPUT' });
    expect(generateGridLines({ ...base, originY: Infinity })).toEqual({ ok: false, code: 'INPUT' });
    expect(generateGridLines({ ...base, maxLines: 3 })).toEqual({ ok: false, code: 'LIMIT' });
    expect(generateGridLines({ ...base, stepX: Number.MIN_VALUE })).toEqual({ ok: false, code: 'LIMIT' });
  });
});
