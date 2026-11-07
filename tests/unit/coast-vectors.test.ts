import { describe, expect, it } from 'vitest';
import { coastFxReference } from '../../src/core/coast/fx.ts';
import { JFA_SENTINEL } from '../../src/core/sdf/jfa.ts';
import {
  COAST_VECTOR_HEIGHT,
  COAST_VECTOR_SETS,
  COAST_VECTOR_WIDTH,
  coastVectorGrid,
  coastVectorSeeds,
} from '../gpu/coast-vectors.ts';

// Card 1.5 step 3 (RED): every texel of every vector set equals an independent formula.
// tests/gpu/coast-vectors.ts is not written yet, so this file must fail on the import.

const seeds = coastVectorSeeds();
const texels = COAST_VECTOR_WIDTH * COAST_VECTOR_HEIGHT;

describe('coast vectors: CPU reference against the independent formula', () => {
  it('the seeded grid has land and water and varied seeds, so the sets are not vacuous', () => {
    // A grid with land and water has a coast, so JFA gives every texel a nearest seed.
    // The sentinel marks grids with no coast; the step-1 unit test covers that case.
    const land = coastVectorGrid().land;
    let landCount = 0;
    let sentinelCount = 0;
    const distinct = new Set<number>();
    for (let p = 0; p < texels; p++) {
      landCount += land[p];
      if (seeds[2 * p] === JFA_SENTINEL) sentinelCount++;
      distinct.add(seeds[2 * p] * 65536 + seeds[2 * p + 1]);
    }
    expect(landCount).toBeGreaterThan(0);
    expect(landCount).toBeLessThan(texels);
    expect(sentinelCount).toBe(0);
    expect(distinct.size).toBeGreaterThan(1);
  });

  for (const set of COAST_VECTOR_SETS) {
    it(`${set.name}: every texel matches the independent formula`, () => {
      const out = coastFxReference(seeds, COAST_VECTOR_WIDTH, COAST_VECTOR_HEIGHT, set.params);
      const { radius, rgb } = set.params;
      let mismatches = 0;
      for (let p = 0; p < texels; p++) {
        const x = p % COAST_VECTOR_WIDTH;
        const y = Math.floor(p / COAST_VECTOR_WIDTH);
        const sx = seeds[2 * p];
        const sy = seeds[2 * p + 1];
        // Independent form: 0 for no coast or W = 0; else max(0, 255 - ceil(255 * d2 / W^2)).
        let want = 0;
        if (sx !== JFA_SENTINEL && radius > 0) {
          const d2 = (x - sx) ** 2 + (y - sy) ** 2;
          want = Math.max(0, 255 - Math.ceil((255 * d2) / (radius * radius)));
        }
        const i = 4 * p;
        const got = [out[i], out[i + 1], out[i + 2], out[i + 3]];
        const expected = [rgb[0], rgb[1], rgb[2], want];
        if (got.some((value, k) => value !== expected[k])) mismatches++;
      }
      expect(mismatches).toBe(0);
    });
  }
});
