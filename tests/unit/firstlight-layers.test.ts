import { describe, expect, it } from 'vitest';
import {
  buildFirstLightLayers,
  landMask,
  selectWindow,
  type RgbaRaster,
} from '../../src/core/firstlight/layers.ts';

type Pixel = readonly [number, number, number, number];

function makeRaster(width: number, height: number, at: (x: number, y: number) => Pixel): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return { width, height, data };
}

function texel(raster: RgbaRaster, x: number, y: number): [number, number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [raster.data[i], raster.data[i + 1], raster.data[i + 2], raster.data[i + 3]];
}

describe('first-light layers', () => {
  it('landMask: alpha 155 is water and alpha 156 is land at threshold 156', () => {
    const mask = makeRaster(2, 1, (x) => (x === 0 ? [0, 0, 0, 155] : [0, 0, 0, 156]));
    expect(Array.from(landMask(mask, 156))).toEqual([0, 1]);
  });

  it('landMask throws RangeError for thresholds 256, 1.5 and NaN', () => {
    const mask = makeRaster(1, 1, () => [0, 0, 0, 255]);
    for (const threshold of [256, 1.5, NaN]) {
      expect(() => landMask(mask, threshold)).toThrow(RangeError);
    }
  });

  it('paints a vertical coast on a 5x5 map with hand-computed ground, water and stats', () => {
    const mask = makeRaster(5, 5, (x) => (x < 2 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    const ground = makeRaster(5, 5, () => [200, 200, 200, 255]);
    const tint = makeRaster(5, 5, () => [0, 0, 0, 0]);
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 5, height: 5 });
    // Land columns 2 and 3 touch water within distance 2, so they darken to round(200 * 0.62) = 124.
    expect(texel(out.ground, 2, 0)).toEqual([124, 124, 124, 255]);
    expect(texel(out.ground, 3, 4)).toEqual([124, 124, 124, 255]);
    // Column 4 is 3 texels from the nearest water, so it keeps the ground colour.
    expect(texel(out.ground, 4, 0)).toEqual([200, 200, 200, 255]);
    expect(texel(out.ground, 4, 4)).toEqual([200, 200, 200, 255]);
    // Water columns 0 and 1 touch land, so the flat base (40, 88, 136) lightens
    // by 0.35 towards white: (115, 146, 178).
    expect(texel(out.water, 0, 0)).toEqual([115, 146, 178, 255]);
    expect(texel(out.water, 1, 3)).toEqual([115, 146, 178, 255]);
    // A land texel that is not a water coast keeps the unlit base water colour.
    expect(texel(out.water, 4, 2)).toEqual([40, 88, 136, 255]);
    // The mask window is copied unchanged.
    expect(texel(out.mask, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(texel(out.mask, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(out.stats).toEqual({ land: 15, water: 10, coastLand: 10, coastWater: 10 });
  });

  it('blends the water tint by exact integers on a coast-free water map', () => {
    const mask = makeRaster(3, 1, () => [0, 0, 0, 0]);
    const ground = makeRaster(3, 1, () => [7, 7, 7, 255]);
    const tint = makeRaster(3, 1, (x) =>
      x === 0 ? [9, 9, 9, 0] : x === 1 ? [10, 20, 30, 255] : [200, 100, 50, 128],
    );
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 3, height: 1 });
    // Tint alpha 0 keeps the flat base colour.
    expect(texel(out.water, 0, 0)).toEqual([40, 88, 136, 255]);
    // Tint alpha 255 takes the tint RGB exactly.
    expect(texel(out.water, 1, 0)).toEqual([10, 20, 30, 255]);
    // Tint alpha 128 with tint (200, 100, 50): each channel is
    // round(base * 127 / 255 + tint * 128 / 255) = (120, 94, 93).
    expect(texel(out.water, 2, 0)).toEqual([120, 94, 93, 255]);
    expect(out.stats).toEqual({ land: 0, water: 3, coastLand: 0, coastWater: 0 });
  });

  it('clamps at the map border: window column 0 reads the in-map neighbour, never outside', () => {
    const mask = makeRaster(5, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255]));
    const ground = makeRaster(5, 1, () => [200, 200, 200, 255]);
    const tint = makeRaster(5, 1, () => [0, 0, 0, 0]);
    // Columns 1 and 2 see the water at column 0 within distance 2; column 3 does not.
    const inner = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 1, y0: 0, width: 3, height: 1 });
    expect(texel(inner.ground, 0, 0)).toEqual([124, 124, 124, 255]);
    expect(texel(inner.ground, 1, 0)).toEqual([124, 124, 124, 255]);
    expect(texel(inner.ground, 2, 0)).toEqual([200, 200, 200, 255]);
    expect(inner.stats).toEqual({ land: 3, water: 0, coastLand: 2, coastWater: 0 });
    // Column 0 is water with land nearby, so it foams.
    const edge = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 1, height: 1 });
    expect(texel(edge.water, 0, 0)).toEqual([115, 146, 178, 255]);
    expect(edge.stats).toEqual({ land: 0, water: 1, coastLand: 0, coastWater: 1 });
    // An all-land strip has no coast at all: hypothetical out-of-map water is ignored.
    const solid = makeRaster(3, 1, () => [0, 0, 0, 255]);
    const solidGround = makeRaster(3, 1, () => [200, 200, 200, 255]);
    const solidTint = makeRaster(3, 1, () => [0, 0, 0, 0]);
    const flat = buildFirstLightLayers({
      mask: solid,
      ground: solidGround,
      tint: solidTint,
      threshold: 128,
      x0: 0,
      y0: 0,
      width: 3,
      height: 1,
    });
    expect(texel(flat.ground, 0, 0)).toEqual([200, 200, 200, 255]);
    expect(texel(flat.ground, 2, 0)).toEqual([200, 200, 200, 255]);
    expect(flat.stats).toEqual({ land: 3, water: 0, coastLand: 0, coastWater: 0 });
  });

  it('selectWindow picks the unique best eligible window on a 16x8 map', () => {
    // A two-wide land stripe at columns 5-6, rows 0-5. Only the window at (4, 0)
    // is eligible: 8 land texels out of 16 is a 0.5 fraction, and every one of
    // its 16 texels touches the opposite kind within distance 2.
    const mask = makeRaster(16, 8, (x, y) => (x === 5 || x === 6) && y < 6 ? [0, 0, 0, 255] : [0, 0, 0, 0]);
    expect(selectWindow(mask, 128, 4, 4)).toEqual({ x0: 4, y0: 0, coastTexels: 16, landFraction: 0.5 });
  });

  it('selectWindow breaks ties by smaller y0, then smaller x0', () => {
    // Full-height stripe: windows (4, 0) and (4, 4) tie at 16 coast texels.
    const tall = makeRaster(16, 8, (x) => (x === 5 || x === 6 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(selectWindow(tall, 128, 4, 4)).toEqual({ x0: 4, y0: 0, coastTexels: 16, landFraction: 0.5 });
    // Twin stripes: windows (0, 0) and (8, 0) tie, so the smaller x0 wins.
    const twins = makeRaster(
      16,
      4,
      (x) => (x === 1 || x === 2 || x === 9 || x === 10 ? [0, 0, 0, 255] : [0, 0, 0, 0]),
    );
    expect(selectWindow(twins, 128, 4, 4)).toEqual({ x0: 0, y0: 0, coastTexels: 16, landFraction: 0.5 });
  });

  it('selectWindow throws RangeError when no window is eligible', () => {
    const water = makeRaster(8, 8, () => [0, 0, 0, 0]);
    expect(() => selectWindow(water, 128, 4, 4)).toThrow(RangeError);
    const tiny = makeRaster(2, 2, () => [0, 0, 0, 255]);
    expect(() => selectWindow(tiny, 128, 4, 4)).toThrow(RangeError);
  });

  it('buildFirstLightLayers throws RangeError on mismatched, outside or empty windows', () => {
    const mask = makeRaster(3, 3, () => [0, 0, 0, 255]);
    const ground = makeRaster(3, 3, () => [200, 200, 200, 255]);
    const tint = makeRaster(3, 3, () => [0, 0, 0, 0]);
    const small = makeRaster(2, 2, () => [0, 0, 0, 0]);
    expect(() => buildFirstLightLayers({ mask, ground: small, tint, threshold: 128, x0: 0, y0: 0, width: 2, height: 2 })).toThrow(
      RangeError,
    );
    expect(() => buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 2, y0: 0, width: 2, height: 2 })).toThrow(
      RangeError,
    );
    expect(() => buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 0, height: 1 })).toThrow(
      RangeError,
    );
  });

  it('emits rows top-first: output row 0 equals map row y0', () => {
    const rows: Pixel[] = [
      [1, 2, 3, 200],
      [7, 8, 9, 201],
      [13, 14, 15, 202],
    ];
    const grounds: Pixel[] = [
      [10, 20, 30, 255],
      [40, 50, 60, 255],
      [70, 80, 90, 255],
    ];
    const mask = makeRaster(2, 3, (_x, y) => rows[y]);
    const ground = makeRaster(2, 3, (_x, y) => grounds[y]);
    const tint = makeRaster(2, 3, () => [0, 0, 0, 0]);
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 1, width: 2, height: 1 });
    expect(texel(out.ground, 0, 0)).toEqual([40, 50, 60, 255]);
    expect(texel(out.ground, 1, 0)).toEqual([40, 50, 60, 255]);
    expect(texel(out.mask, 0, 0)).toEqual([7, 8, 9, 201]);
    expect(texel(out.mask, 1, 0)).toEqual([7, 8, 9, 201]);
  });

  it('paints a horizontal coast whose land side reaches the water two rows away', () => {
    const mask = makeRaster(3, 5, (_x, y) => [0, 0, 0, y < 2 ? 0 : 255]);
    const ground = makeRaster(3, 5, () => [200, 200, 200, 255]);
    const tint = makeRaster(3, 5, () => [0, 0, 0, 0]);
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 3, height: 5 });
    expect(texel(out.ground, 0, 2)).toEqual([124, 124, 124, 255]);
    expect(texel(out.ground, 1, 3)).toEqual([124, 124, 124, 255]);
    expect(texel(out.ground, 2, 4)).toEqual([200, 200, 200, 255]);
    expect(texel(out.water, 0, 0)).toEqual([115, 146, 178, 255]);
    expect(texel(out.water, 2, 1)).toEqual([115, 146, 178, 255]);
    expect(out.stats).toEqual({ land: 9, water: 6, coastLand: 6, coastWater: 6 });
  });

  it('selectWindow accepts a window with exactly 30 percent land', () => {
    const mask = makeRaster(10, 10, (_x, y) => [0, 0, 0, y < 3 ? 255 : 0]);
    expect(selectWindow(mask, 128, 10, 10)).toEqual({ x0: 0, y0: 0, coastTexels: 40, landFraction: 0.3 });
  });

  it('selectWindow accepts a window with exactly 70 percent land', () => {
    const mask = makeRaster(10, 10, (_x, y) => [0, 0, 0, y < 7 ? 255 : 0]);
    expect(selectWindow(mask, 128, 10, 10)).toEqual({ x0: 0, y0: 0, coastTexels: 40, landFraction: 0.7 });
  });

  it('selectWindow considers the window that ends exactly at the right edge', () => {
    const mask = makeRaster(8, 4, (x) => [0, 0, 0, x === 4 || x === 5 ? 255 : 0]);
    expect(selectWindow(mask, 128, 4, 4)).toEqual({ x0: 4, y0: 0, coastTexels: 16, landFraction: 0.5 });
  });

  it('landMask accepts threshold 255', () => {
    const mask = makeRaster(2, 1, (x) => [0, 0, 0, x === 0 ? 255 : 254]);
    expect(Array.from(landMask(mask, 255))).toEqual([1, 0]);
  });

  it('takes a water tint of alpha 255 exactly over the base colour', () => {
    const mask = makeRaster(1, 1, () => [0, 0, 0, 0]);
    const ground = makeRaster(1, 1, () => [0, 0, 0, 255]);
    const tint = makeRaster(1, 1, () => [255, 255, 255, 255]);
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 1, height: 1 });
    expect(texel(out.water, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it('rounds the blended water channel to nearest, not down', () => {
    const mask = makeRaster(1, 1, () => [0, 0, 0, 0]);
    const ground = makeRaster(1, 1, () => [0, 0, 0, 255]);
    const tint = makeRaster(1, 1, () => [201, 100, 50, 128]);
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 1, height: 1 });
    expect(texel(out.water, 0, 0)).toEqual([121, 94, 93, 255]);
  });

  it('rounds the darkened land colour to nearest, not down', () => {
    const mask = makeRaster(2, 1, (x) => [0, 0, 0, x === 0 ? 255 : 0]);
    const ground = makeRaster(2, 1, () => [201, 201, 201, 255]);
    const tint = makeRaster(2, 1, () => [0, 0, 0, 0]);
    const out = buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 2, height: 1 });
    expect(texel(out.ground, 0, 0)).toEqual([125, 125, 125, 255]);
  });

  it('selectWindow refuses a zero window size', () => {
    const mask = makeRaster(4, 4, () => [0, 0, 0, 0]);
    expect(() => selectWindow(mask, 128, 0, 4)).toThrow(RangeError);
  });

  it('selectWindow refuses a zero stride before it scans', () => {
    // The window is larger than the map, so a mutant that skips the stride check never
    // enters the scan loop: it fails on the message instead of hanging.
    const mask = makeRaster(4, 4, () => [0, 0, 0, 0]);
    let caught: unknown = null;
    try {
      selectWindow(mask, 128, 8, 0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as RangeError).message).toMatch(/stride/);
  });

  it('buildFirstLightLayers refuses a tint raster whose size differs from the mask', () => {
    const mask = makeRaster(2, 2, () => [0, 0, 0, 0]);
    const ground = makeRaster(2, 2, () => [0, 0, 0, 255]);
    const tint = makeRaster(1, 1, () => [0, 0, 0, 0]);
    expect(() => buildFirstLightLayers({ mask, ground, tint, threshold: 128, x0: 0, y0: 0, width: 2, height: 2 })).toThrow(RangeError);
  });

  it('selectWindow finds an interior window whose land count needs full inclusion-exclusion', () => {
    const landBR = new Set(['3,3', '4,3', '3,4', '5,5']);
    const mask = makeRaster(6, 6, (x, y) => [0, 0, 0, (x < 3 && y < 3) || landBR.has(`${x},${y}`) ? 255 : 0]);
    expect(selectWindow(mask, 128, 3, 3)).toEqual({ x0: 3, y0: 3, coastTexels: 9, landFraction: 4 / 9 });
  });
});
