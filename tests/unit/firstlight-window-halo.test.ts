import { describe, expect, it } from 'vitest';
import {
  buildFirstLightLayers,
  COAST_FOAM_MIX,
  COAST_LAND_FACTOR,
  COAST_RADIUS,
  FIRSTLIGHT_WATER_RGB,
  type FirstLightInput,
  type FirstLightOutput,
  type RgbaRaster,
} from '../../src/core/firstlight/layers.ts';

function raster(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

// Independent full-map reference: classify neighbors by their original map coordinates,
// without cropping, halo arrays, or calling the implementation's coastFlags().
function referenceLayers(input: FirstLightInput): FirstLightOutput {
  const { mask, ground, tint, threshold, x0, y0, width, height } = input;
  const maskOut = new Uint8Array(width * height * 4);
  const groundOut = new Uint8Array(width * height * 4);
  const waterOut = new Uint8Array(width * height * 4);
  let landCount = 0;
  let waterCount = 0;
  let coastLandCount = 0;
  let coastWaterCount = 0;
  const isLand = (x: number, y: number): boolean =>
    mask.data[(y * mask.width + x) * 4 + 3] >= threshold;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = x0 + col, y = y0 + row;
      const mapI = (y * mask.width + x) * 4;
      const outI = (row * width + col) * 4;
      const land = isLand(x, y);
      let coast = false;
      for (let ny = Math.max(0, y - COAST_RADIUS); ny <= Math.min(mask.height - 1, y + COAST_RADIUS) && !coast; ny++) {
        for (let nx = Math.max(0, x - COAST_RADIUS); nx <= Math.min(mask.width - 1, x + COAST_RADIUS); nx++) {
          if (nx !== x || ny !== y) {
            if (isLand(nx, ny) !== land) {
              coast = true;
              break;
            }
          }
        }
      }
      if (land) {
        landCount++;
        if (coast) coastLandCount++;
      } else {
        waterCount++;
        if (coast) coastWaterCount++;
      }
      maskOut.set(mask.data.subarray(mapI, mapI + 4), outI);
      for (let channel = 0; channel < 3; channel++) {
        const groundValue = ground.data[mapI + channel];
        groundOut[outI + channel] = land && coast
          ? Math.round(groundValue * COAST_LAND_FACTOR)
          : groundValue;
        const alpha = tint.data[mapI + 3] / 255;
        let value = Math.round(
          FIRSTLIGHT_WATER_RGB[channel] * (1 - alpha) + tint.data[mapI + channel] * alpha,
        );
        if (!land && coast) value = Math.round(value + (255 - value) * COAST_FOAM_MIX);
        waterOut[outI + channel] = value;
      }
      groundOut[outI + 3] = 255;
      waterOut[outI + 3] = 255;
    }
  }
  return {
    mask: { width, height, data: maskOut },
    ground: { width, height, data: groundOut },
    water: { width, height, data: waterOut },
    stats: { land: landCount, water: waterCount, coastLand: coastLandCount, coastWater: coastWaterCount },
  };
}

function compare(input: FirstLightInput): void {
  const maskBefore = input.mask.data.slice();
  const groundBefore = input.ground.data.slice();
  const tintBefore = input.tint.data.slice();
  const actual = buildFirstLightLayers(input);
  const expected = referenceLayers(input);
  expect(actual).toEqual(expected);
  // The extraction may read the inputs but must not overwrite source raster bytes.
  expect(input.mask.data).toEqual(maskBefore);
  expect(input.ground.data).toEqual(groundBefore);
  expect(input.tint.data).toEqual(tintBefore);
}

function inputs(
  width: number,
  height: number,
  threshold: number,
  alpha: (x: number, y: number) => number,
): Pick<FirstLightInput, 'mask' | 'ground' | 'tint' | 'threshold'> {
  return {
    mask: raster(width, height, (x, y) => [x * 9 & 255, y * 13 & 255, x ^ y, alpha(x, y)]),
    ground: raster(width, height, (x, y) => [(x * 19 + y) & 255, (x + y * 29) & 255, (x * 7 + y * 11) & 255, x & 255]),
    tint: raster(width, height, (x, y) => [(x * 31 + y * 5) & 255, (x * 7 + y * 37) & 255, (x + y * 41) & 255, (x * 67 + y * 89) & 255]),
    threshold,
  };
}

describe('First Light window-halo extraction equivalence', () => {
  it('matches a full-map pixel oracle on structured coasts, all edges and narrow maps', () => {
    const shapes: readonly (readonly [number, number])[] = [[1, 1], [1, 12], [12, 1], [3, 3], [8, 5], [9, 11], [18, 15]];
    const patterns: readonly ((x: number, y: number, w: number, h: number) => number)[] = [
      () => 0,
      () => 255,
      (x, _y, w) => x < w / 2 ? 255 : 0,
      (_x, y, _w, h) => y < h / 2 ? 255 : 0,
      (x, y) => (x + y) % 2 ? 255 : 0,
      (x, y, w, h) => x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 255 : 0,
      (x, y, w, h) => x === w - 1 && y === h - 1 ? 255 : 0,
    ];
    for (const [w, h] of shapes) {
      for (const pattern of patterns) {
        for (const threshold of [0, 1, 128, 255]) {
          const common = inputs(w, h, threshold, (x, y) => pattern(x, y, w, h));
          const boxes: readonly (readonly [number, number, number, number])[] = [
            [0, 0, w, h],
            [0, 0, 1, 1],
            [w - 1, h - 1, 1, 1],
            [w - 1, 0, 1, h],
            [0, h - 1, w, 1],
            [Math.floor((w - 1) / 2), Math.floor((h - 1) / 2), 1, 1],
            [Math.floor(w / 3), Math.floor(h / 3), w - Math.floor(w / 3), h - Math.floor(h / 3)],
          ];
          for (const [x0, y0, width, height] of boxes) {
            compare({ ...common, x0, y0, width, height });
          }
        }
      }
    }
  });

  it('matches the full-map oracle on 250 deterministic arbitrary windows and alpha boundaries', () => {
    let state = 0x6d2b79f5;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const alphas = [0, 1, 127, 128, 254, 255] as const;
    for (let trial = 0; trial < 250; trial++) {
      const mapW = 1 + next() % 29;
      const mapH = 1 + next() % 23;
      const threshold = alphas[next() % alphas.length];
      const common = inputs(mapW, mapH, threshold, () => alphas[next() % alphas.length]);
      const width = 1 + next() % mapW;
      const height = 1 + next() % mapH;
      const x0 = next() % (mapW - width + 1);
      const y0 = next() % (mapH - height + 1);
      compare({ ...common, x0, y0, width, height });
    }
  });

  it('captures coastline pixels exactly two pixels outside the requested window', () => {
    const common = inputs(14, 12, 128, (x, y) => x === 3 && y === 6 ? 255 : 0);
    compare({ ...common, x0: 5, y0: 5, width: 4, height: 3 });
    const out = buildFirstLightLayers({ ...common, x0: 5, y0: 5, width: 4, height: 3 });
    expect(out.stats.coastWater).toBe(2);
    expect(out.stats.coastLand).toBe(0);
  });
});
