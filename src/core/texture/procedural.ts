/** Deterministic, tileable, asset-independent grayscale texture synthesis. */
export type TextureResult =
  | Readonly<{ ok: true; width: number; height: number; pixels: Uint8Array }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;

export type TextureOptions = Readonly<{
  width: number;
  height: number;
  seed: number;
  cellsX: number;
  cellsY: number;
}>;

const MAX_PIXELS = 1024 * 1024;
const MAX_CELLS = 128;

/** Stable 32-bit integer lattice hash; no ambient randomness or platform APIs. */
function lattice(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Samples periodic value noise. Opposite image edges have identical values,
 * so the returned pixels tile without a seam when repeated.
 * Each output pixel is one unsigned 8-bit grayscale sample.
 */
export function generateTileableTexture(options: TextureOptions): TextureResult {
  if (!options || !Number.isSafeInteger(options.width) || !Number.isSafeInteger(options.height) ||
      options.width < 2 || options.height < 2 || !Number.isSafeInteger(options.seed) ||
      !Number.isSafeInteger(options.cellsX) || !Number.isSafeInteger(options.cellsY) ||
      options.cellsX < 1 || options.cellsY < 1) return { ok: false, code: 'INPUT' };
  if (options.width > 1024 || options.height > 1024 ||
      options.width * options.height > MAX_PIXELS ||
      options.cellsX > MAX_CELLS || options.cellsY > MAX_CELLS) return { ok: false, code: 'LIMIT' };

  const { width, height, seed, cellsX, cellsY } = options;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = y * cellsY / (height - 1);
    const iy = Math.min(cellsY - 1, Math.floor(v));
    const fy = fade(v - iy);
    const y0 = iy % cellsY;
    const y1 = (iy + 1) % cellsY;
    for (let x = 0; x < width; x++) {
      const u = x * cellsX / (width - 1);
      const ix = Math.min(cellsX - 1, Math.floor(u));
      const fx = fade(u - ix);
      const x0 = ix % cellsX;
      const x1 = (ix + 1) % cellsX;
      const top = lattice(seed, x0, y0) * (1 - fx) + lattice(seed, x1, y0) * fx;
      const bottom = lattice(seed, x0, y1) * (1 - fx) + lattice(seed, x1, y1) * fx;
      pixels[y * width + x] = Math.round(255 * (top * (1 - fy) + bottom * fy));
    }
  }
  return { ok: true, width, height, pixels };
}
