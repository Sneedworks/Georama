import { describe, expect, it } from 'vitest';
import { rasterRects } from '../../src/core/elements/raster.ts';
import type { Rect } from '../../src/core/elements/rects.ts';

function pixel(bytes: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]];
}

describe('rasterRects', () => {
  it('fills the rectangle and leaves the rest cleared', () => {
    const red: Rect = { x0: 1, y0: 0, x1: 3, y1: 1, rgba: [1, 0, 0, 1] };
    const bytes = rasterRects([red], 4, 2);
    expect(bytes.length).toBe(4 * 2 * 4);
    expect(pixel(bytes, 4, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(bytes, 4, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(bytes, 4, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(bytes, 4, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(bytes, 4, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('lets later rectangles overwrite earlier ones', () => {
    const red: Rect = { x0: 0, y0: 0, x1: 2, y1: 1, rgba: [1, 0, 0, 1] };
    const blue: Rect = { x0: 1, y0: 0, x1: 3, y1: 1, rgba: [0, 0, 1, 1] };
    const bytes = rasterRects([red, blue], 4, 1);
    expect(pixel(bytes, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(bytes, 4, 1, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(bytes, 4, 2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('rounds each channel with floor(255 x c + 0.5)', () => {
    const half: Rect = { x0: 0, y0: 0, x1: 1, y1: 1, rgba: [0.5, 0, 0, 1] };
    expect(pixel(rasterRects([half], 1, 1), 1, 0, 0)).toEqual([128, 0, 0, 255]);
  });

  it('clips rectangles that extend past the target', () => {
    const big: Rect = { x0: -5, y0: -5, x1: 50, y1: 50, rgba: [0, 1, 0, 1] };
    const bytes = rasterRects([big], 2, 2);
    expect(pixel(bytes, 2, 1, 1)).toEqual([0, 255, 0, 255]);
  });

  it('rejects any alpha other than 1', () => {
    const translucent: Rect = { x0: 0, y0: 0, x1: 1, y1: 1, rgba: [1, 0, 0, 0.5] };
    expect(() => rasterRects([translucent], 1, 1)).toThrow(RangeError);
  });

  it('rejects alpha values near 1, zero and NaN', () => {
    expect(() => rasterRects([{ x0: 0, y0: 0, x1: 1, y1: 1, rgba: [1, 0, 0, 0] }], 1, 1)).toThrow(RangeError);
    expect(() => rasterRects([{ x0: 0, y0: 0, x1: 1, y1: 1, rgba: [1, 0, 0, 0.999] }], 1, 1)).toThrow(RangeError);
    expect(() => rasterRects([{ x0: 0, y0: 0, x1: 1, y1: 1, rgba: [1, 0, 0, Number.NaN] }], 1, 1)).toThrow(RangeError);
  });

  it('clamps out-of-range channels before rounding', () => {
    const wild: Rect = { x0: 0, y0: 0, x1: 1, y1: 1, rgba: [1.5, -0.2, 0, 1] };
    expect(pixel(rasterRects([wild], 1, 1), 1, 0, 0)).toEqual([255, 0, 0, 255]);
  });
});
