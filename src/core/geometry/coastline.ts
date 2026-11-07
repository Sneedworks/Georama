/** Portable coastline extraction from a binary, row-major land mask. */
export type CoastSegment = Readonly<{
  x1: number; y1: number; x2: number; y2: number;
}>;
export type CoastResult =
  | Readonly<{ ok: true; segments: readonly CoastSegment[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;
export type CoastOptions = Readonly<{
  width: number;
  height: number;
  land: readonly number[] | Uint8Array;
  /** Whether the area beyond the mask is water (default true). */
  outsideIsWater?: boolean;
  maxSegments?: number;
}>;

/**
 * Extracts unit-length boundary edges between land (1) and water (0).
 * Coordinates lie on pixel-cell corners. Each edge is emitted exactly once,
 * with land on its right side in screen coordinates (y increases downward).
 * Edges are not stitched into polylines: diagonal contacts remain distinct.
 */
export function extractCoastSegments(options: CoastOptions): CoastResult {
  if (!options || !Number.isSafeInteger(options.width) ||
      !Number.isSafeInteger(options.height) || options.width < 1 || options.height < 1 ||
      !options.land || !(Array.isArray(options.land) || options.land instanceof Uint8Array) ||
      (options.outsideIsWater !== undefined && typeof options.outsideIsWater !== 'boolean')) {
    return { ok: false, code: 'INPUT' };
  }
  const { width, height, land } = options;
  const maxSegments = options.maxSegments ?? 65536;
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) return { ok: false, code: 'INPUT' };
  if (width > 4096 || height > 4096 || width * height > 1048576 ||
      land.length !== width * height) return { ok: false, code: 'LIMIT' };

  // Validate the entire mask before extracting any geometry.
  for (let i = 0; i < land.length; i++) {
    if (land[i] !== 0 && land[i] !== 1) return { ok: false, code: 'INPUT' };
  }

  const outside = options.outsideIsWater !== false;
  const isLand = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height
      ? land[y * width + x] === 1
      : !outside;

  const segments: CoastSegment[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number): boolean => {
    if (segments.length >= maxSegments) return false;
    segments.push({ x1, y1, x2, y2 });
    return true;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isLand(x, y)) continue;
      // Clockwise around each land cell in screen coordinates.
      if (!isLand(x, y - 1) && !add(x, y, x + 1, y)) return { ok: false, code: 'LIMIT' };
      if (!isLand(x + 1, y) && !add(x + 1, y, x + 1, y + 1)) return { ok: false, code: 'LIMIT' };
      if (!isLand(x, y + 1) && !add(x + 1, y + 1, x, y + 1)) return { ok: false, code: 'LIMIT' };
      if (!isLand(x - 1, y) && !add(x, y + 1, x, y)) return { ok: false, code: 'LIMIT' };
    }
  }
  return { ok: true, segments };
}
