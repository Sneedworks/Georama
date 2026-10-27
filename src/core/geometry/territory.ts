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
  /** Integer IDs 0..65535, one per map cell. */
  ids: readonly number[] | Uint16Array;
  maxBorders?: number;
}>;

const MAX_CELLS = 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_BORDERS = 65536;

/**
 * Emit each in-map edge between unlike adjacent territories exactly once.
 * The outer map perimeter is not a border. IDs are validated before output
 * allocation. Result order is row-major (right, then bottom). Vertical edges
 * run top-to-bottom (a=left); horizontal edges run left-to-right (a=top).
 * No geometry is stitched or rendered here.
 */
export function extractTerritoryBorders(options: TerritoryBorderOptions): TerritoryBorderResult {
  if (!options || !Number.isSafeInteger(options.width) || !Number.isSafeInteger(options.height) ||
      options.width < 1 || options.height < 1 ||
      !(Array.isArray(options.ids) || options.ids instanceof Uint16Array)) {
    return { ok: false, code: 'INPUT' };
  }
  const { width, height, ids } = options;
  const maxBorders = options.maxBorders ?? MAX_BORDERS;
  if (!Number.isSafeInteger(maxBorders) || maxBorders < 1) return { ok: false, code: 'INPUT' };
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_CELLS ||
      maxBorders > MAX_BORDERS) return { ok: false, code: 'LIMIT' };
  if (ids.length !== width * height) return { ok: false, code: 'INPUT' };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!Number.isInteger(id) || id < 0 || id > 65535) return { ok: false, code: 'INPUT' };
  }

  const borders: TerritoryBorder[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = ids[y * width + x];
      if (x + 1 < width) {
        const b = ids[y * width + x + 1];
        if (a !== b) {
          if (borders.length >= maxBorders) return { ok: false, code: 'LIMIT' };
          borders.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1, a, b });
        }
      }
      if (y + 1 < height) {
        const b = ids[(y + 1) * width + x];
        if (a !== b) {
          if (borders.length >= maxBorders) return { ok: false, code: 'LIMIT' };
          borders.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1, a, b });
        }
      }
    }
  }
  return { ok: true, borders };
}
