import { describe, expect, it } from 'vitest';
import { COAST_RADIUS, selectWindow, type RgbaRaster, type WindowPick } from '../../src/core/firstlight/layers.ts';

function maskOf(width: number, height: number, alpha: (x: number, y: number) => number): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i + 3] = alpha(x, y);
      // RGB channels must have no influence on land classification.
      data[i] = (x * 17 + y * 3) & 255;
      data[i + 1] = (y * 29 + x * 7) & 255;
      data[i + 2] = (x ^ y) & 255;
    }
  }
  return { width, height, data };
}

/** Independent oracle: scan candidate windows and every in-map neighbor directly.
 * No summed-area tables or production coastFlags() are used.
 */
function directPick(mask: RgbaRaster, threshold: number, size: number, stride: number): WindowPick | null {
  const { width, height, data } = mask;
  const landAt = (x: number, y: number): boolean => data[(y * width + x) * 4 + 3] >= threshold;
  let best: WindowPick | null = null;
  for (let y0 = 0; y0 + size <= height; y0 += stride) {
    for (let x0 = 0; x0 + size <= width; x0 += stride) {
      let landCount = 0;
      let coastCount = 0;
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) {
          const isLand = landAt(x, y);
          if (isLand) landCount++;
          let isCoast = false;
          for (let ny = Math.max(0, y - COAST_RADIUS); ny <= Math.min(height - 1, y + COAST_RADIUS) && !isCoast; ny++) {
            for (let nx = Math.max(0, x - COAST_RADIUS); nx <= Math.min(width - 1, x + COAST_RADIUS); nx++) {
              if ((nx !== x || ny !== y) && landAt(nx, ny) !== isLand) {
                isCoast = true;
                break;
              }
            }
          }
          if (isCoast) coastCount++;
        }
      }
      const landFraction = landCount / (size * size);
      if (landFraction < 0.3 || landFraction > 0.7) continue;
      if (
        best === null ||
        coastCount > best.coastTexels ||
        (coastCount === best.coastTexels && (y0 < best.y0 || (y0 === best.y0 && x0 < best.x0)))
      ) {
        best = { x0, y0, coastTexels: coastCount, landFraction };
      }
    }
  }
  return best;
}

function expectEquivalent(mask: RgbaRaster, threshold: number, size: number, stride: number): void {
  const originalBytes = mask.data.slice();
  const expected = directPick(mask, threshold, size, stride);
  if (expected === null) {
    expect(() => selectWindow(mask, threshold, size, stride)).toThrow(RangeError);
  } else {
    expect(selectWindow(mask, threshold, size, stride)).toEqual(expected);
  }
  expect(mask.data).toEqual(originalBytes);
}

describe('First Light summed-area coastline classification', () => {
  const sizes: readonly (readonly [number, number])[] = [
    [1, 1], [1, 9], [9, 1], [3, 3], [8, 7], [13, 11], [21, 16],
  ];
  it.each(sizes)('matches an independent direct-neighbor oracle for a %ix%i map', (width, height) => {
    const patterns: readonly ((x: number, y: number) => number)[] = [
      () => 0,
      () => 255,
      (x) => x < Math.ceil(width / 2) ? 255 : 0,
      (_x, y) => y < Math.ceil(height / 2) ? 255 : 0,
      (x, y) => ((x + y) & 1) === 0 ? 255 : 0,
      (x, y) => x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 255 : 0,
      (x, y) => x === width - 1 && y === height - 1 ? 255 : 0,
    ];
    for (const pattern of patterns) {
      const mask = maskOf(width, height, pattern);
      for (const threshold of [0, 1, 128, 255]) {
        for (const size of [1, 2, 3, 5, Math.min(width, height)]) {
          for (const stride of [1, 3]) {
            expectEquivalent(mask, threshold, size, stride);
          }
        }
      }
    }
  });

  it.each([0, 1, 2, 3, 4])('matches 100 seeded randomized maps and windows (batch %i)', (batch) => {
    let state = (0xa341316c + Math.imul(batch, 0x9e3779b9)) >>> 0;
    const rand = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const alphas = [0, 1, 127, 128, 254, 255] as const;
    for (let trial = 0; trial < 100; trial++) {
      const width = 1 + rand() % 23;
      const height = 1 + rand() % 21;
      const threshold = alphas[rand() % alphas.length];
      const mask = maskOf(width, height, () => alphas[rand() % alphas.length]);
      const size = 1 + rand() % (Math.max(width, height) + 3);
      const stride = 1 + rand() % 6;
      expectEquivalent(mask, threshold, size, stride);
    }
  });

  it('preserves tie-breaking and edge-candidate coordinates', () => {
    const stripes = maskOf(16, 8, (x) => x === 5 || x === 6 ? 255 : 0);
    expect(selectWindow(stripes, 128, 4, 4)).toEqual({ x0: 4, y0: 0, coastTexels: 16, landFraction: 0.5 });
    expectEquivalent(stripes, 128, 4, 4);

    const rightEdge = maskOf(8, 4, (x) => x === 4 || x === 5 ? 255 : 0);
    expect(selectWindow(rightEdge, 128, 4, 4)).toEqual({ x0: 4, y0: 0, coastTexels: 16, landFraction: 0.5 });
    expectEquivalent(rightEdge, 128, 4, 4);
  });

  it('preserves eligibility at exactly 30% and 70% land', () => {
    for (const rows of [3, 7]) {
      const mask = maskOf(10, 10, (_x, y) => y < rows ? 255 : 0);
      const expected = directPick(mask, 128, 10, 10);
      expect(expected).not.toBeNull();
      expect(selectWindow(mask, 128, 10, 10)).toEqual(expected);
      expect(selectWindow(mask, 128, 10, 10).landFraction).toBe(rows / 10);
    }
  });
});
