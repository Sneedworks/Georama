export interface RasterShape {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly data: Uint8Array;
}

export interface RowChunk {
  readonly y0: number;
  readonly rows: number;
}

export type RasterPlan =
  | { ok: true; chunks: readonly RowChunk[] }
  | { ok: false; code: 'UPLOAD' | 'LIMIT'; message: string };

export const DEFAULT_CHUNK_BYTES = 1048576;

export function planRasterUpload(raster: unknown, maxChunkBytes?: number): RasterPlan {
  if (typeof raster !== 'object' || raster === null) {
    return { ok: false, code: 'UPLOAD', message: 'raster must be an object' };
  }
  const shape = raster as Partial<RasterShape>;
  if (shape.format !== 'RGBA8') {
    return { ok: false, code: 'UPLOAD', message: 'raster format must be RGBA8' };
  }
  const width = shape.width;
  if (typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1) {
    return { ok: false, code: 'LIMIT', message: `invalid width ${String(width)}` };
  }
  const height = shape.height;
  if (typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1) {
    return { ok: false, code: 'LIMIT', message: `invalid height ${String(height)}` };
  }
  const data = shape.data;
  if (!(data instanceof Uint8Array)) {
    return { ok: false, code: 'UPLOAD', message: 'raster data must be a Uint8Array' };
  }
  if (data.length !== width * height * 4) {
    return { ok: false, code: 'UPLOAD', message: 'raster data length must be width * height * 4' };
  }
  const limit = maxChunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < width * 4) {
    return { ok: false, code: 'LIMIT', message: `invalid maxChunkBytes ${String(limit)}` };
  }
  const rowsPerChunk = Math.floor(limit / (width * 4));
  const chunks: RowChunk[] = [];
  let y = 0;
  while (y < height) {
    const rows = Math.min(rowsPerChunk, height - y);
    chunks.push({ y0: y, rows });
    y += rows;
  }
  return { ok: true, chunks };
}
