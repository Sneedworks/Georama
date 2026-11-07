// Card 1.7, step 3 (RED): the three border vector sets and their style, written before tests/gpu/borders-vectors.ts exists.
import { describe, expect, it } from 'vitest';
import { borderIndexTable } from '../../src/core/borders/outline.ts';
import { borderVectorSets, borderVectorStyle } from '../gpu/borders-vectors.ts';

const SENTINEL = 65535;

// The style bytes, reproduced here from the seed 0x7c2e with the same generator as the card 1.6 vectors. It is written
// out again so that this check does not depend on the vector module it checks.
function reproduceStyle(seed: number): Uint8Array {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const bytes = new Uint8Array(8 * 8 * 4);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.floor(next() * 256);
  return bytes;
}

describe('border vector sets', () => {
  it('are well formed: widths, periods, closed flags and vertex counts as the card says; every coordinate finite and inside the 64 x 48 grid', () => {
    expect(borderVectorSets.map((s) => [s.width, s.period, s.closed])).toEqual([
      [2, 16, true],
      [3, 9, false],
      [5, 12, true],
    ]);
    expect(borderVectorSets.map((s) => s.points.length)).toEqual([8, 10, 10]);
    for (const set of borderVectorSets) {
      for (let i = 0; i < set.points.length; i += 2) {
        expect(Number.isFinite(set.points[i]), `${set.name}: x finite`).toBe(true);
        expect(Number.isFinite(set.points[i + 1]), `${set.name}: y finite`).toBe(true);
        expect(set.points[i], `${set.name}: x inside the grid`).toBeGreaterThanOrEqual(0);
        expect(set.points[i], `${set.name}: x inside the grid`).toBeLessThanOrEqual(64);
        expect(set.points[i + 1], `${set.name}: y inside the grid`).toBeGreaterThanOrEqual(0);
        expect(set.points[i + 1], `${set.name}: y inside the grid`).toBeLessThanOrEqual(48);
      }
    }
  });

  it('each set covers at least one pixel, and at least one covered pixel reads a style texel with a nonzero R or B byte', () => {
    for (const set of borderVectorSets) {
      const table = borderIndexTable(set.points, set.closed, set.width, set.period, borderVectorStyle);
      const count = table.gridWidth * table.gridHeight;
      let covered = 0;
      let nonzeroRB = 0;
      for (let p = 0; p < count; p++) {
        const u = table.index[2 * p];
        const v = table.index[2 * p + 1];
        if (u === SENTINEL) continue;
        covered++;
        const k = (v * table.styleWidth + u) * 4;
        if (borderVectorStyle.bytes[k] !== 0 || borderVectorStyle.bytes[k + 2] !== 0) nonzeroRB++;
      }
      expect(covered, `${set.name}: covered pixels`).toBeGreaterThan(0);
      expect(nonzeroRB, `${set.name}: covered pixels with a nonzero R or B style byte`).toBeGreaterThan(0);
    }
  });

  it('the style is 8 by 8 and its bytes are reproduced from the seed 0x7c2e', () => {
    expect(borderVectorStyle.width).toBe(8);
    expect(borderVectorStyle.height).toBe(8);
    expect(Array.from(borderVectorStyle.bytes)).toEqual(Array.from(reproduceStyle(0x7c2e)));
  });

  it('the table of each set is the same on two runs', () => {
    for (const set of borderVectorSets) {
      const first = borderIndexTable(set.points, set.closed, set.width, set.period, borderVectorStyle);
      const second = borderIndexTable(set.points, set.closed, set.width, set.period, borderVectorStyle);
      expect(second, set.name).toEqual(first);
    }
  });
});
