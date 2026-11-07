import { describe, expect, it } from 'vitest';
import { PATH_GRID, pathIndexTable } from '../../src/core/paths/textured.ts';
import { pathVectorSets, pathVectorStyle } from '../gpu/paths-vectors.ts';

const SENTINEL = 65535;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('vector sets are well formed', () => {
  it('six sets with the widths and periods of card 1.6, in order', () => {
    expect(pathVectorSets.map((s) => [s.width, s.period])).toEqual([
      [1, 16],
      [2, 16],
      [3, 16],
      [5, 16],
      [8, 16],
      [16, 7],
    ]);
  });

  it('every coordinate is finite and inside the 64 x 48 test grid', () => {
    for (const set of pathVectorSets) {
      expect(set.points.length % 2).toBe(0);
      for (let i = 0; i < set.points.length; i += 2) {
        const x = set.points[i];
        const y = set.points[i + 1];
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x >= 0 && x <= PATH_GRID.width).toBe(true);
        expect(y >= 0 && y <= PATH_GRID.height).toBe(true);
      }
    }
  });

  it('each set builds a table and covers at least one pixel', () => {
    for (const set of pathVectorSets) {
      const table = pathIndexTable(set.points, set.width, set.period, pathVectorStyle);
      let covered = 0;
      for (let p = 0; p < table.index.length; p += 2) {
        if (table.index[p] !== SENTINEL) covered++;
      }
      expect(covered).toBeGreaterThan(0);
    }
  });

  it('the CPU table of each set is the same on two runs', () => {
    for (const set of pathVectorSets) {
      const a = pathIndexTable(set.points, set.width, set.period, pathVectorStyle);
      const b = pathIndexTable(set.points, set.width, set.period, pathVectorStyle);
      expect(Array.from(a.index)).toEqual(Array.from(b.index));
    }
  });
});

describe('style bytes are reproduced from the seed', () => {
  it('the 8 x 8 RGBA8 style is the first 256 draws of seed 0x3a6b', () => {
    const rnd = lcg(0x3a6b);
    const expected: number[] = [];
    for (let k = 0; k < 8 * 8 * 4; k++) expected.push(Math.floor(rnd() * 256));
    expect(pathVectorStyle.width).toBe(8);
    expect(pathVectorStyle.height).toBe(8);
    expect(Array.from(pathVectorStyle.bytes)).toEqual(expected);
  });
});
