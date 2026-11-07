// Grade comparison for the full-size composition probe (card 1.10, Stage B2 v3, D-B2-3).
// Pure: no globals, no Node or DOM imports. Errors carry static messages, never the content.
import { ExportError } from './errors.ts';

export interface GradeComparison {
  readonly exact: number;
  readonly diff1: number;
  readonly diff2plus: number;
  readonly maxDiff: number;
  readonly alphaOk: number;
}

// Counts, over the four bytes per pixel, how many pixels are exact, how many have a largest
// channel difference of 1, and how many reach 2 or more; plus the maximum channel difference
// and how many output pixels carry alpha 255. Refusals use 'param'.
export function compareGrade(out: Uint8Array, ref: Uint8Array, width: number, height: number): GradeComparison {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new ExportError('param', 'compare: width and height must be safe integers >= 1');
  }
  if (!(out instanceof Uint8Array) || !(ref instanceof Uint8Array)) {
    throw new ExportError('param', 'compare: out and ref must be Uint8Array');
  }
  if (out.length !== ref.length) {
    throw new ExportError('param', 'compare: out and ref differ in length');
  }
  const total = width * height;
  if (!Number.isSafeInteger(total) || out.length !== total * 4) {
    throw new ExportError('param', 'compare: bytes differ from width and height');
  }
  let exact = 0;
  let diff1 = 0;
  let diff2plus = 0;
  let maxDiff = 0;
  let alphaOk = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const d0 = Math.abs(out[i] - ref[i]);
    const d1 = Math.abs(out[i + 1] - ref[i + 1]);
    const d2 = Math.abs(out[i + 2] - ref[i + 2]);
    const d3 = Math.abs(out[i + 3] - ref[i + 3]);
    const m = Math.max(d0, d1, d2, d3);
    if (m > maxDiff) maxDiff = m;
    if (m === 0) exact++;
    else if (m === 1) diff1++;
    else diff2plus++;
    if (out[i + 3] === 255) alphaOk++;
  }
  return { exact, diff1, diff2plus, maxDiff, alphaOk };
}
