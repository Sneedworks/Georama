// Card 1.9, GREEN (core): the opaque CPU reference for the element rectangles. Detail v2 section 12.1-12.2.
// Pure: no DOM, no GL. It is the byte reference that the GPU case compares against.
import type { Rect } from './rects.ts';

function byte(c: number): number {
  return Math.floor(255 * Math.min(1, Math.max(0, c)) + 0.5);
}

/** RGBA8, row 0 is y = 0. Each rectangle is clipped, then filled in array order (later ones overwrite). Alpha must be 1. */
export function rasterRects(rects: readonly Rect[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (const r of rects) {
    if (r.rgba[3] !== 1) throw new RangeError(`rasterRects: alpha must be 1 (got ${r.rgba[3]})`);
    const x0 = Math.max(r.x0, 0);
    const y0 = Math.max(r.y0, 0);
    const x1 = Math.min(r.x1, width);
    const y1 = Math.min(r.y1, height);
    if (x1 <= x0 || y1 <= y0) continue;
    const red = byte(r.rgba[0]);
    const green = byte(r.rgba[1]);
    const blue = byte(r.rgba[2]);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        out[i] = red;
        out[i + 1] = green;
        out[i + 2] = blue;
        out[i + 3] = 255;
      }
    }
  }
  return out;
}
