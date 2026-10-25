// First-light v0 layers: portable CPU reference for the GPU compositor.
// No DOM, no renderer imports. Rasters are row-major with a top-left origin.
export interface RgbaRaster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export const FIRSTLIGHT_WATER_RGB = [40, 88, 136] as const;
export const COAST_RADIUS = 2;
export const COAST_LAND_FACTOR = 0.62;
export const COAST_FOAM_MIX = 0.35;
export const WINDOW_SIZE = 1024;
export const WINDOW_STRIDE = 512;
export const LAND_FRACTION_MIN = 0.3;
export const LAND_FRACTION_MAX = 0.7;

export interface WindowPick {
  readonly x0: number;
  readonly y0: number;
  readonly coastTexels: number;
  readonly landFraction: number;
}

export interface FirstLightInput {
  readonly mask: RgbaRaster;
  readonly ground: RgbaRaster;
  readonly tint: RgbaRaster;
  readonly threshold: number;
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
}

export interface FirstLightOutput {
  readonly mask: RgbaRaster;
  readonly ground: RgbaRaster;
  readonly water: RgbaRaster;
  readonly stats: {
    readonly land: number;
    readonly water: number;
    readonly coastLand: number;
    readonly coastWater: number;
  };
}

function assertThreshold(threshold: number): void {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError(`threshold must be an integer in 0..255, got ${String(threshold)}`);
  }
}

function assertRaster(raster: RgbaRaster, name: string): void {
  if (typeof raster !== 'object' || raster === null) {
    throw new RangeError(`${name} must be an object`);
  }
  if (!Number.isSafeInteger(raster.width) || raster.width < 1) {
    throw new RangeError(`${name}.width must be a safe integer >= 1`);
  }
  if (!Number.isSafeInteger(raster.height) || raster.height < 1) {
    throw new RangeError(`${name}.height must be a safe integer >= 1`);
  }
  if (!(raster.data instanceof Uint8Array) || raster.data.length !== raster.width * raster.height * 4) {
    throw new RangeError(`${name}.data must hold exactly width * height * 4 bytes`);
  }
}

function assertExtent(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a safe integer >= 1`);
  }
}

/** 1 for land (alpha >= threshold), 0 for water. Matches the GPU compositor rule. */
export function landMask(mask: RgbaRaster, threshold: number): Uint8Array {
  assertThreshold(threshold);
  assertRaster(mask, 'mask');
  const out = new Uint8Array(mask.width * mask.height);
  const data = mask.data;
  for (let i = 0; i < out.length; i++) {
    out[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
  }
  return out;
}

/**
 * Coast flags over the full map: a texel is coast when at least one in-map
 * texel within Chebyshev distance COAST_RADIUS has the opposite
 * classification. Out-of-map neighbours are ignored.
 */
function coastFlags(land: Uint8Array, width: number, height: number): { coastLand: Uint8Array; coastWater: Uint8Array } {
  const coastLand = new Uint8Array(land.length);
  const coastWater = new Uint8Array(land.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const isLand = land[i] === 1;
      const y0 = Math.max(0, y - COAST_RADIUS);
      const y1 = Math.min(height - 1, y + COAST_RADIUS);
      const x0 = Math.max(0, x - COAST_RADIUS);
      const x1 = Math.min(width - 1, x + COAST_RADIUS);
      let coast = 0;
      for (let ny = y0; ny <= y1 && coast === 0; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          if (nx === x && ny === y) continue;
          if ((land[ny * width + nx] === 1) !== isLand) {
            coast = 1;
            break;
          }
        }
      }
      if (isLand) coastLand[i] = coast;
      else coastWater[i] = coast;
    }
  }
  return { coastLand, coastWater };
}

/** Summed-area table over a 0/1 flag array: sat[(y+1)*(w+1)+(x+1)] sums rows 0..y, cols 0..x.
 * Each prefix count is at most width*height. Use half-sized Uint32 storage
 * when every count fits; retain Float64 for theoretical larger inputs.
 */
function summedArea(flags: Uint8Array, width: number, height: number): Uint32Array | Float64Array {
  const stride = width + 1;
  const length = (width + 1) * (height + 1);
  const sat = width * height <= 0xffff_ffff ? new Uint32Array(length) : new Float64Array(length);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += flags[y * width + x];
      sat[(y + 1) * stride + (x + 1)] = sat[y * stride + (x + 1)] + rowSum;
    }
  }
  return sat;
}

function rectSum(sat: Uint32Array | Float64Array, width: number, x0: number, y0: number, size: number): number {
  const stride = width + 1;
  const x1 = x0 + size;
  const y1 = y0 + size;
  return sat[y1 * stride + x1] - sat[y0 * stride + x1] - sat[y1 * stride + x0] + sat[y0 * stride + x0];
}

export function selectWindow(
  mask: RgbaRaster,
  threshold: number,
  size = WINDOW_SIZE,
  stride = WINDOW_STRIDE,
): WindowPick {
  assertThreshold(threshold);
  assertRaster(mask, 'mask');
  assertExtent(size, 'size');
  assertExtent(stride, 'stride');
  const { width, height } = mask;
  const land = landMask(mask, threshold);
  const { coastLand, coastWater } = coastFlags(land, width, height);
  const landSat = summedArea(land, width, height);
  const coastSat = summedArea(
    coastLand.map((v, i) => v + coastWater[i]),
    width,
    height,
  );
  const area = size * size;
  let best: WindowPick | null = null;
  for (let y0 = 0; y0 + size <= height; y0 += stride) {
    for (let x0 = 0; x0 + size <= width; x0 += stride) {
      const landCount = rectSum(landSat, width, x0, y0, size);
      const landFraction = landCount / area;
      if (landFraction < LAND_FRACTION_MIN || landFraction > LAND_FRACTION_MAX) continue;
      const coastTexels = rectSum(coastSat, width, x0, y0, size);
      if (
        best === null ||
        coastTexels > best.coastTexels ||
        (coastTexels === best.coastTexels && (y0 < best.y0 || (y0 === best.y0 && x0 < best.x0)))
      ) {
        best = { x0, y0, coastTexels, landFraction };
      }
    }
  }
  if (best === null) {
    throw new RangeError('no candidate window fits, or none is eligible');
  }
  return best;
}

export function buildFirstLightLayers(input: FirstLightInput): FirstLightOutput {
  assertThreshold(input.threshold);
  assertRaster(input.mask, 'mask');
  assertRaster(input.ground, 'ground');
  assertRaster(input.tint, 'tint');
  const mapWidth = input.mask.width;
  const mapHeight = input.mask.height;
  if (input.ground.width !== mapWidth || input.ground.height !== mapHeight) {
    throw new RangeError('ground must match the mask dimensions');
  }
  if (input.tint.width !== mapWidth || input.tint.height !== mapHeight) {
    throw new RangeError('tint must match the mask dimensions');
  }
  assertExtent(input.width, 'width');
  assertExtent(input.height, 'height');
  if (
    !Number.isSafeInteger(input.x0) ||
    !Number.isSafeInteger(input.y0) ||
    input.x0 < 0 ||
    input.y0 < 0 ||
    input.x0 + input.width > mapWidth ||
    input.y0 + input.height > mapHeight
  ) {
    throw new RangeError('the window must sit fully inside the map');
  }
  const land = landMask(input.mask, input.threshold);
  const { coastLand, coastWater } = coastFlags(land, mapWidth, mapHeight);
  const { x0, y0, width, height } = input;
  const maskOut = new Uint8Array(width * height * 4);
  const groundOut = new Uint8Array(width * height * 4);
  const waterOut = new Uint8Array(width * height * 4);
  const [baseR, baseG, baseB] = FIRSTLIGHT_WATER_RGB;
  let landCount = 0;
  let waterCount = 0;
  let coastLandCount = 0;
  let coastWaterCount = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const mapI = ((y0 + row) * mapWidth + (x0 + col)) * 4;
      const outI = (row * width + col) * 4;
      const flat = (y0 + row) * mapWidth + (x0 + col);
      const isLand = land[flat] === 1;
      if (isLand) {
        landCount++;
        if (coastLand[flat] === 1) coastLandCount++;
      } else {
        waterCount++;
        if (coastWater[flat] === 1) coastWaterCount++;
      }
      maskOut[outI] = input.mask.data[mapI];
      maskOut[outI + 1] = input.mask.data[mapI + 1];
      maskOut[outI + 2] = input.mask.data[mapI + 2];
      maskOut[outI + 3] = input.mask.data[mapI + 3];
      const gr = input.ground.data[mapI];
      const gg = input.ground.data[mapI + 1];
      const gb = input.ground.data[mapI + 2];
      if (isLand && coastLand[flat] === 1) {
        groundOut[outI] = Math.round(gr * COAST_LAND_FACTOR);
        groundOut[outI + 1] = Math.round(gg * COAST_LAND_FACTOR);
        groundOut[outI + 2] = Math.round(gb * COAST_LAND_FACTOR);
      } else {
        groundOut[outI] = gr;
        groundOut[outI + 1] = gg;
        groundOut[outI + 2] = gb;
      }
      groundOut[outI + 3] = 255;
      const tr = input.tint.data[mapI];
      const tg = input.tint.data[mapI + 1];
      const tb = input.tint.data[mapI + 2];
      const a = input.tint.data[mapI + 3] / 255;
      let wr = Math.round(baseR * (1 - a) + tr * a);
      let wg = Math.round(baseG * (1 - a) + tg * a);
      let wb = Math.round(baseB * (1 - a) + tb * a);
      if (!isLand && coastWater[flat] === 1) {
        wr = Math.round(wr + (255 - wr) * COAST_FOAM_MIX);
        wg = Math.round(wg + (255 - wg) * COAST_FOAM_MIX);
        wb = Math.round(wb + (255 - wb) * COAST_FOAM_MIX);
      }
      waterOut[outI] = wr;
      waterOut[outI + 1] = wg;
      waterOut[outI + 2] = wb;
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
