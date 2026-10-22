import { describe, expect, it } from 'vitest';
import {
  thresholdFromWaterLevel,
  isLand,
} from '../../src/renderer/render/compose/classify';

describe('thresholdFromWaterLevel', () => {
  it('maps 0.5 to 128', () => {
    const r = thresholdFromWaterLevel(0.5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.threshold).toBe(128);
  });

  it('maps 0 to 0', () => {
    const r = thresholdFromWaterLevel(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.threshold).toBe(0);
  });

  it('maps 1 to 255', () => {
    const r = thresholdFromWaterLevel(1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.threshold).toBe(255);
  });

  it('rejects 1.5 as INPUT', () => {
    const r = thresholdFromWaterLevel(1.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects NaN as INPUT', () => {
    const r = thresholdFromWaterLevel(Number.NaN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects negative as INPUT', () => {
    const r = thresholdFromWaterLevel(-0.25);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });
});

describe('isLand', () => {
  it('reports land when alpha equals threshold', () => {
    const r = isLand(156, 156);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.land).toBe(true);
  });

  it('reports water when alpha is below threshold', () => {
    const r = isLand(155, 156);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.land).toBe(false);
  });

  it('rejects alpha 256 as INPUT', () => {
    const r = isLand(256, 156);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects non-integer alpha as INPUT', () => {
    const r = isLand(155.5, 156);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects negative threshold as INPUT', () => {
    const r = isLand(100, -1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });

  it('rejects threshold 256 as INPUT', () => {
    const r = isLand(100, 256);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INPUT');
  });
});

describe('isLand byte boundaries (strength)', () => {
  it('accepts alpha and threshold at the byte limits 0 and 255', () => {
    const zero = isLand(0, 0);
    const top = isLand(255, 255);
    const below = isLand(254, 255);
    expect(zero.ok).toBe(true);
    expect(top.ok).toBe(true);
    expect(below.ok).toBe(true);
    if (zero.ok) expect(zero.land).toBe(true);
    if (top.ok) expect(top.land).toBe(true);
    if (below.ok) expect(below.land).toBe(false);
  });
});
