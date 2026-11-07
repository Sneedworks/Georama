import { GRADE_MAX_PIXELS } from '../color/grade.ts';
import { ExportError } from './errors.ts';

// Card 1.10, decision D3 (owner, 2026-10-31): 8192 px per side, and GRADE_MAX_PIXELS in total.
export const EXPORT_MAX_SIDE = 8192;
export const EXPORT_MAX_PIXELS: number = GRADE_MAX_PIXELS;

export interface ExportSize {
  readonly width: number;
  readonly height: number;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

// Check order: values ('param'), then the side cap ('limit'), then the pixel cap ('limit').
// With sides capped at 8192 the pixel cap cannot fire; it stays as a second bound.
export function checkExportSize(width: unknown, height: unknown): ExportSize {
  if (!isCount(width) || !isCount(height)) {
    throw new ExportError('param', 'export size: width and height must be safe integers >= 1');
  }
  if (width > EXPORT_MAX_SIDE || height > EXPORT_MAX_SIDE) {
    throw new ExportError('limit', `export size: a side exceeds ${EXPORT_MAX_SIDE} px`);
  }
  if (width * height > EXPORT_MAX_PIXELS) {
    throw new ExportError('limit', `export size: ${width * height} px exceeds ${EXPORT_MAX_PIXELS}`);
  }
  return { width, height };
}
