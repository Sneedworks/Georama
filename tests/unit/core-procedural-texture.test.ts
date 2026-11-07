import { describe, expect, it } from 'vitest';
import { generateTileableTexture } from '../../src/core/texture/procedural';

const base = { width: 19, height: 13, seed: 12345, cellsX: 4, cellsY: 3 };

describe('portable procedural texture', () => {
  it('produces byte-for-byte deterministic output for identical inputs', () => {
    const a = generateTileableTexture(base);
    const b = generateTileableTexture(base);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.pixels).toEqual(b.pixels);
      expect(a.pixels.length).toBe(base.width * base.height);
    }
  });

  it('varies when the seed changes', () => {
    const a = generateTileableTexture(base);
    const b = generateTileableTexture({ ...base, seed: 12346 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.pixels).not.toEqual(b.pixels);
  });

  it('matches opposite edges exactly in both axes', () => {
    for (const dimensions of [{ width: 2, height: 2 }, { width: 19, height: 13 }, { width: 64, height: 32 }]) {
      const r = generateTileableTexture({ ...base, ...dimensions });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      for (let y = 0; y < r.height; y++) {
        expect(r.pixels[y * r.width]).toBe(r.pixels[y * r.width + r.width - 1]);
      }
      for (let x = 0; x < r.width; x++) {
        expect(r.pixels[x]).toBe(r.pixels[(r.height - 1) * r.width + x]);
      }
    }
  });

  it('rejects malformed, degenerate and oversized requests before allocation', () => {
    expect(generateTileableTexture({ ...base, width: 1 })).toEqual({ ok: false, code: 'INPUT' });
    expect(generateTileableTexture({ ...base, cellsX: 0 })).toEqual({ ok: false, code: 'INPUT' });
    expect(generateTileableTexture({ ...base, seed: NaN })).toEqual({ ok: false, code: 'INPUT' });
    expect(generateTileableTexture({ ...base, width: 1025 })).toEqual({ ok: false, code: 'LIMIT' });
    expect(generateTileableTexture({ ...base, cellsY: 129 })).toEqual({ ok: false, code: 'LIMIT' });
  });

  it('handles a single periodic cell and negative seeds', () => {
    const r = generateTileableTexture({ width: 8, height: 9, seed: -7, cellsX: 1, cellsY: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new Set(r.pixels).size).toBe(1);
  });
});
