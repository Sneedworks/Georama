// Card 1.10 Stage C step 2a (detail v4): full-map extent and raster checks for the hidden harness.
// Pure: no DOM, no GL, no file access. The harness calls these before any allocation (detail Method 5a).
import { ExportError } from './errors.ts';
import { checkExportSize } from './size.ts';
import type { RgbaRaster } from '../firstlight/layers.ts';

export interface FullMapExtent {
  readonly x0: 0;
  readonly y0: 0;
  readonly width: number;
  readonly height: number;
}

/** The full extent of a map: the mask's own size, at the origin, after the export size check. */
export function fullMapExtent(mask: RgbaRaster): FullMapExtent {
  const { width, height } = checkExportSize(mask.width, mask.height);
  return { x0: 0, y0: 0, width, height };
}

/**
 * Checks that ground and tint match the mask's extent, and that every raster holds width * height * 4 bytes.
 * Refusals: 'param' for an extent mismatch; 'length' for a byte-length mismatch (png.ts uses the same code).
 */
export function checkFullMapRasters(mask: RgbaRaster, ground: RgbaRaster, tint: RgbaRaster): void {
  const { width, height } = checkExportSize(mask.width, mask.height);
  for (const [name, raster] of [
    ['ground', ground],
    ['tint', tint],
  ] as const) {
    if (raster.width !== width || raster.height !== height) {
      throw new ExportError('param', `full map: ${name} must match the mask dimensions`);
    }
  }
  const expected = width * height * 4;
  for (const [name, raster] of [
    ['mask', mask],
    ['ground', ground],
    ['tint', tint],
  ] as const) {
    if (raster.data.length !== expected) {
      throw new ExportError('length', `full map: ${name} has ${raster.data.length} bytes, expected ${expected}`);
    }
  }
}
