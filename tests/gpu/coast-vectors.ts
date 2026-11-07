// Card 1.5 step 4 (GREEN): vectors for the coast band.
// One 64 x 48 grid (a labelled test size), a land mask from one fixed seed, and the seeds
// from jumpFloodReference (card 0.10). Six parameter sets. The radii and colours are test
// parameters only: no product value, no mapping from the theme.
import type { CoastFxParams } from '../../src/core/coast/fx.ts';
import { jumpFloodReference, type ClassGrid } from '../../src/core/sdf/jfa.ts';

export const COAST_VECTOR_WIDTH = 64;
export const COAST_VECTOR_HEIGHT = 48;

const VECTOR_SEED = 0x2c5e;

function nextState(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

// About 40 percent land, so both classes occur and the grid has a coast.
function coastVectorLand(): Uint8Array {
  const land = new Uint8Array(COAST_VECTOR_WIDTH * COAST_VECTOR_HEIGHT);
  let state = VECTOR_SEED;
  for (let p = 0; p < land.length; p++) {
    state = nextState(state);
    land[p] = (state >>> 16) % 5 < 2 ? 1 : 0;
  }
  return land;
}

export function coastVectorGrid(): ClassGrid {
  return { width: COAST_VECTOR_WIDTH, height: COAST_VECTOR_HEIGHT, land: coastVectorLand() };
}

export function coastVectorSeeds(): Uint16Array {
  const verdict = jumpFloodReference(coastVectorGrid());
  if (!verdict.ok) throw new Error('jumpFloodReference refused the coast vector grid');
  return verdict.seeds;
}

const TEST_RGB = [120, 60, 200] as const;

export const COAST_VECTOR_SETS: readonly { readonly name: string; readonly params: CoastFxParams }[] = [
  { name: 'W0', params: { radius: 0, rgb: TEST_RGB } },
  { name: 'W1', params: { radius: 1, rgb: TEST_RGB } },
  { name: 'W3', params: { radius: 3, rgb: TEST_RGB } },
  { name: 'W17', params: { radius: 17, rgb: TEST_RGB } },
  { name: 'W2048', params: { radius: 2048, rgb: TEST_RGB } },
  { name: 'W17-colour-extremes', params: { radius: 17, rgb: [0, 255, 0] } },
];
