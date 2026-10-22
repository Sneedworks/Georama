import { GlError } from '../gl/errors.ts';
import type { GlBudget } from '../gl/budget.ts';
import { createTexture2D, uploadRegion, type GlTexture } from '../gl/texture.ts';
import { planRasterUpload } from './chunk-plan.ts';

export interface RasterSource {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly data: Uint8Array;
}

export interface UploadOptions {
  readonly label?: string;
  readonly budget?: GlBudget;
  readonly maxChunkBytes?: number;
  readonly yieldFrame?: () => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface UploadedLayer {
  readonly texture: GlTexture;
  readonly chunks: number;
  readonly yields: number;
}

export async function uploadRasterLayer(
  gl: WebGL2RenderingContext,
  raster: RasterSource,
  options?: UploadOptions,
): Promise<UploadedLayer> {
  const plan = planRasterUpload(raster, options?.maxChunkBytes);
  if (!plan.ok) {
    throw new GlError(plan.code, plan.message);
  }
  if (options?.signal?.aborted === true) {
    throw new GlError('UPLOAD', 'upload aborted');
  }
  const src = raster as RasterSource;
  const width = src.width;
  const height = src.height;
  const data = src.data;
  const label = options?.label ?? 'raster-layer';
  const budget = options?.budget;
  const yieldFrame = options?.yieldFrame ?? defaultYieldFrame;
  const signal: AbortSignal | undefined = options?.signal;
  const texture = createTexture2D(gl, { width, height, format: 'RGBA8', label }, budget);
  try {
    let yields = 0;
    for (let i = 0; i < plan.chunks.length; i++) {
      if (signal?.aborted === true) {
        throw new GlError('UPLOAD', 'upload aborted');
      }
      const chunk = plan.chunks[i];
      uploadRegion(
        gl,
        texture,
        0,
        chunk.y0,
        width,
        chunk.rows,
        data.subarray(chunk.y0 * width * 4, (chunk.y0 + chunk.rows) * width * 4),
      );
      if (i + 1 < plan.chunks.length) {
        await yieldFrame();
        yields += 1;
      }
    }
    return { texture, chunks: plan.chunks.length, yields };
  } catch (error) {
    texture.dispose();
    throw error;
  }
}

function defaultYieldFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
