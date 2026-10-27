/** Portable D8 steepest-descent flow accumulation on a height grid. */
export type TerrainFlowOptions = Readonly<{
  width: number;
  height: number;
  heights: readonly number[] | Float64Array;
  maxCells?: number;
}>;
export type TerrainFlowResult =
  | Readonly<{ ok: true; downstream: Int32Array; accumulation: Uint32Array }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;

/**
 * For each cell, choose the steepest strictly lower of eight neighbours.
 * Return the downstream cell index (-1 for a sink) and contributing-cell
 * count including the cell itself. Equal slopes choose the lowest index.
 */
export function accumulateTerrainFlow(_options: TerrainFlowOptions): TerrainFlowResult {
  // Provisional implementation: independent behavior tests must fail.
  return { ok: true, downstream: new Int32Array(0), accumulation: new Uint32Array(0) };
}
