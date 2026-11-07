import { describe, expect, it } from 'vitest';
import { TILE_LIMITS, tileRgba8, type TileParams } from '../../src/core/texture/tiling.ts';
import { VECTOR_OUT, VECTOR_SETS, VECTOR_TEXTURE, flipV, transposeSquare, type VectorTexture } from '../gpu/tiling-vectors.ts';

// Independent formulation for the comparison: floor-based wrap and division, not the module's % and subtraction.
function independentTile(tex: VectorTexture, outW: number, outH: number, p: TileParams): Uint8Array {
  const out = new Uint8Array(outW * outH * 4);
  const periodX = tex.tw * p.k;
  const periodY = tex.th * p.k;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const wx = x + p.ox - Math.floor((x + p.ox) / periodX) * periodX;
      const wy = y + p.oy - Math.floor((y + p.oy) / periodY) * periodY;
      const sx = Math.floor(wx / p.k);
      const sy = Math.floor(wy / p.k);
      for (let c = 0; c < 4; c++) {
        out[(y * outW + x) * 4 + c] = tex.rgba[(sy * tex.tw + sx) * 4 + c];
      }
    }
  }
  return out;
}

describe('tiling vectors', () => {
  it('the seeded texture is square and differs from its own vertical flip and transpose', () => {
    expect(VECTOR_TEXTURE.tw).toBe(VECTOR_TEXTURE.th);
    expect(VECTOR_TEXTURE.rgba).not.toEqual(flipV(VECTOR_TEXTURE));
    expect(VECTOR_TEXTURE.rgba).not.toEqual(transposeSquare(VECTOR_TEXTURE));
  });

  it('there are six parameter sets, all inside the module ranges', () => {
    expect(VECTOR_SETS).toHaveLength(6);
    for (const s of VECTOR_SETS) {
      const { k, ox, oy } = s.params;
      expect(Number.isInteger(k) && k >= TILE_LIMITS.minK && k <= TILE_LIMITS.maxK).toBe(true);
      expect(Number.isInteger(ox) && ox >= 0 && ox <= TILE_LIMITS.maxOffset).toBe(true);
      expect(Number.isInteger(oy) && oy >= 0 && oy <= TILE_LIMITS.maxOffset).toBe(true);
    }
  });

  for (const set of VECTOR_SETS) {
    it(`${set.name}: every output byte equals the independent formulation`, () => {
      const got = tileRgba8(VECTOR_TEXTURE.rgba, VECTOR_TEXTURE.tw, VECTOR_TEXTURE.th, VECTOR_OUT.outW, VECTOR_OUT.outH, set.params);
      const want = independentTile(VECTOR_TEXTURE, VECTOR_OUT.outW, VECTOR_OUT.outH, set.params);
      expect(got.length).toBe(want.length);
      let mismatches = 0;
      for (let i = 0; i < want.length; i++) {
        if (got[i] !== want[i]) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }

  it('the six sets give six different outputs', () => {
    const outs = VECTOR_SETS.map((s) =>
      tileRgba8(VECTOR_TEXTURE.rgba, VECTOR_TEXTURE.tw, VECTOR_TEXTURE.th, VECTOR_OUT.outW, VECTOR_OUT.outH, s.params).join(','),
    );
    expect(new Set(outs).size).toBe(6);
  });
});
