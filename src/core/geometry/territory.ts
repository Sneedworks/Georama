/** Portable, asset-independent territory borders from a row-major ID raster. */
export type TerritoryBorder = Readonly<{
  x1: number; y1: number; x2: number; y2: number;
  /** Territory ID on the left or upper side. Zero means unclaimed. */
  a: number;
  /** Territory ID on the right or lower side. Zero means unclaimed. */
  b: number;
}>;
export type TerritoryBorderResult =
  | Readonly<{ ok: true; borders: readonly TerritoryBorder[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;
export type TerritoryBorderOptions = Readonly<{
  width: number;
  height: number;
  ids: readonly number[] | Uint16Array;
  maxBorders?: number;
}>;

/** Placeholder for test-first regression evidence; not the implementation. */
export function extractTerritoryBorders(_options: TerritoryBorderOptions): TerritoryBorderResult {
  return { ok: true, borders: [] };
}
