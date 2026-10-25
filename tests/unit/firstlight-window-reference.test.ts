import { describe, expect, it } from 'vitest';
import { selectWindow, type RgbaRaster, type WindowPick } from '../../src/core/firstlight/layers.ts';

// Deliberately independent of the summed-area-table implementation:
// classify and count every pixel and its in-map neighbours for each candidate.
function referencePick(mask: RgbaRaster, threshold: number, size: number, stride: number): WindowPick | null {
  const landAt = (x: number, y: number): boolean =>
    mask.data[(y * mask.width + x) * 4 + 3] >= threshold;
  let best: WindowPick | null = null;
  for (let y0 = 0; y0 + size <= mask.height; y0 += stride) {
    for (let x0 = 0; x0 + size <= mask.width; x0 += stride) {
      let landCount = 0;
      let coastCount = 0;
      for (let y = y0; y < y0 + size; y++) {
        for (let x = x0; x < x0 + size; x++) {
          const isLand = landAt(x, y);
          if (isLand) landCount++;
          let isCoast = false;
          for (let ny = Math.max(0, y - 2); ny <= Math.min(mask.height - 1, y + 2) && !isCoast; ny++) {
            for (let nx = Math.max(0, x - 2); nx <= Math.min(mask.width - 1, x + 2); nx++) {
              if (nx === x && ny === y) continue;
              if (landAt(nx, ny) !== isLand) {
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

function maskOf(width: number, height: number, alpha: (x: number, y: number) => number): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7 + y * 11) & 255;
      data[i + 1] = (x * 13 + y * 3) & 255;
      data[i + 2] = (x * 5 + y * 17) & 255;
      data[i + 3] = alpha(x, y);
    }
  }
  return { width, height, data };
}

function checkAgainstReference(mask: RgbaRaster, threshold: number, size: number, stride: number): void {
  const expected = referencePick(mask, threshold, size, stride);
  if (expected === null) {
    expect(() => selectWindow(mask, threshold, size, stride)).toThrow(RangeError);
  } else {
    expect(selectWindow(mask, threshold, size, stride)).toEqual(expected);
  }
}

describe('first-light window selection against direct pixel-count oracle', () => {
  it('agrees on structured coastlines, borders, all-one-class masks and candidate ties', () => {
    const cases: readonly RgbaRaster[] = [
      maskOf(9, 7, (x, y) => (x + y) % 2 ? 255 : 0),
      maskOf(13, 11, (x) => x < 5 ? 255 : 0),
      maskOf(11, 13, (_x, y) => y < 6 ? 255 : 0),
      maskOf(12, 9, (x, y) => (x > 2 && x < 9 && y > 1 && y < 7) ? 255 : 0),
      maskOf(9, 9, (x, y) => (x === 0 || y === 0 || x === 8 || y === 8) ? 255 : 0),
      maskOf(7, 6, () => 0),
      maskOf(7, 6, () => 255),
    ];
    for (const mask of cases) {
      for (const threshold of [1, 128, 255]) {
        for (const size of [1, 2, 3, 4, 6, 10]) {
          for (const stride of [1, 2, 4]) {
            checkAgainstReference(mask, threshold, size, stride);
          }
        }
      }
    }
  });

  it('agrees on 250 deterministic synthetic maps, including alpha threshold boundaries', () => {
    let state = 0x9e3779b9;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const alphas = [0, 1, 127, 128, 254, 255] as const;
    const thresholds = [0, 1, 127, 128, 254, 255] as const;
    for (let trial = 0; trial < 250; trial++) {
      const width = 2 + next() % 12;
      const height = 2 + next() % 12;
      const mask = maskOf(width, height, () => alphas[next() % alphas.length] as number);
      const threshold = thresholds[next() % thresholds.length] as number;
      const size = 1 + next() % (Math.min(width, height) + 2);
      const stride = 1 + next() % 5;
      checkAgainstReference(mask, threshold, size, stride);
    }
  });
});
