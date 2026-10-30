import { describe, expect, it } from 'vitest';
import { layoutScaleBar } from '../../src/core/geometry/scale-bar';

describe('portable scale-bar geometry', () => {
  it('chooses the largest 1-2-5 world distance that fits the pixel budget', () => {
    const r = layoutScaleBar({ unitsPerPixel: 2, maxWidthPx: 150, segments: 4 });
    expect(r).toEqual({ ok: true, worldLength: 200, pixelLength: 100, ticks: [
      { index: 0, pixel: 0, world: 0 },
      { index: 1, pixel: 25, world: 50 },
      { index: 2, pixel: 50, world: 100 },
      { index: 3, pixel: 75, world: 150 },
      { index: 4, pixel: 100, world: 200 },
    ] });
  });

  it('chooses a shorter nice distance rather than exceeding the budget', () => {
    const r = layoutScaleBar({ unitsPerPixel: 0.099, maxWidthPx: 100 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.worldLength).toBe(5);
    expect(r.pixelLength).toBeCloseTo(5 / 0.099, 10);
    expect(r.pixelLength).toBeLessThanOrEqual(100);
  });

  it('handles fractional world units and defaults to four segments', () => {
    const r = layoutScaleBar({ unitsPerPixel: 0.001, maxWidthPx: 100 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.worldLength).toBeCloseTo(0.1, 12);
    expect(r.pixelLength).toBeCloseTo(100, 10);
    expect(r.ticks).toHaveLength(5);
    expect(r.ticks[0]).toEqual({ index: 0, pixel: 0, world: 0 });
    expect(r.ticks[4].world).toBe(r.worldLength);
    expect(r.ticks[4].pixel).toBe(r.pixelLength);
  });

  it('supports one segment and produces deterministic, ordered ticks', () => {
    const options = Object.freeze({ unitsPerPixel: 3, maxWidthPx: 100, segments: 1 });
    const a = layoutScaleBar(options);
    const b = layoutScaleBar(options);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.worldLength).toBe(200);
      expect(a.ticks).toHaveLength(2);
      expect(a.ticks[0].pixel).toBe(0);
      expect(a.ticks[1].pixel).toBe(a.pixelLength);
      expect(a.ticks[1].world).toBe(a.worldLength);
    }
  });

  it('rejects invalid parameters without allocating ticks', () => {
    expect(layoutScaleBar({ unitsPerPixel: 0, maxWidthPx: 100 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutScaleBar({ unitsPerPixel: Infinity, maxWidthPx: 100 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutScaleBar({ unitsPerPixel: 1, maxWidthPx: -1 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutScaleBar({ unitsPerPixel: 1, maxWidthPx: 100, segments: 0 })).toEqual({ ok: false, code: 'INPUT' });
    expect(layoutScaleBar({ unitsPerPixel: 1, maxWidthPx: 100, segments: 1.5 })).toEqual({ ok: false, code: 'INPUT' });
  });

  it('bounds oversized, overflowed and unrepresentably small scales', () => {
    expect(layoutScaleBar({ unitsPerPixel: 1, maxWidthPx: 10000001 })).toEqual({ ok: false, code: 'LIMIT' });
    expect(layoutScaleBar({ unitsPerPixel: 1, maxWidthPx: 100, segments: 33 })).toEqual({ ok: false, code: 'LIMIT' });
    expect(layoutScaleBar({ unitsPerPixel: Number.MAX_VALUE, maxWidthPx: 100 })).toEqual({ ok: false, code: 'LIMIT' });
    expect(layoutScaleBar({ unitsPerPixel: Number.MIN_VALUE, maxWidthPx: 1 })).toEqual({ ok: false, code: 'LIMIT' });
  });
});
