import { describe, expect, it } from 'vitest';
import { samplePath } from '../../src/core/geometry/path';

describe('portable path geometry', () => {
  it('samples endpoints and fixed arc lengths with continuous texture coordinates', () => {
    const r = samplePath([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }], 2, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.length).toBe(7);
    expect(r.samples.map(s => s.distance)).toEqual([0, 2, 4, 6, 7]);
    expect(r.samples.map(s => s.u)).toEqual([0, 1, 2, 3, 3.5]);
    expect(r.samples[2]).toMatchObject({ x: 3, y: 1, tangentX: 0, tangentY: 1, normalX: -1, normalY: 0 });
    expect(r.samples[4]).toMatchObject({ x: 3, y: 4 });
  });
  it('ignores coincident intermediate vertices', () => {
    const r = samplePath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }], 1, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.samples.map(s => s.x)).toEqual([0, 1, 2]);
  });
  it('rejects invalid inputs and degenerate paths', () => {
    expect(samplePath([{ x: 0, y: 0 }, { x: 0, y: 0 }], 1, 1)).toMatchObject({ ok: false, code: 'INPUT' });
    expect(samplePath([{ x: 0, y: 0 }, { x: NaN, y: 0 }], 1, 1)).toMatchObject({ ok: false, code: 'INPUT' });
    expect(samplePath([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0, 1)).toMatchObject({ ok: false, code: 'INPUT' });
  });
  it('rejects sample counts above the cap before allocating output', () => {
    expect(samplePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0.01, 1, 10)).toMatchObject({ ok: false, code: 'LIMIT' });
  });
});
