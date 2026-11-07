// Card 1.10 Stage C step 1 (detail v3, P18): the single row flip of the PNG writer.
// Readback bytes are bottom-up (row 0 is the bottom row). The writer flips the rows once, so the PNG's row 0 is
// the top row. Pure: no DOM, no GL, no file access.
import { ExportError } from './errors.ts';

/**
 * Returns a new RGBA8 buffer whose rows are in reverse order. Each texel's four bytes move together.
 * The input is not changed.
 */
export function flipRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new ExportError('param', 'flipRows: width and height must be safe integers >= 1');
  }
  if (!(rgba instanceof Uint8Array)) {
    throw new ExportError('param', 'flipRows: rgba must be a Uint8Array');
  }
  const stride = width * 4;
  const expected = stride * height;
  if (rgba.length !== expected) {
    throw new ExportError('length', `flipRows: rgba has ${rgba.length} bytes, expected ${expected}`);
  }
  const out = new Uint8Array(expected);
  for (let y = 0; y < height; y++) {
    out.set(rgba.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return out;
}
