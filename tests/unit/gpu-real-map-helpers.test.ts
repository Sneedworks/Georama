import { describe, expect, it } from 'vitest';
import {
  assertRealMapContent,
  compareReadback,
  passes,
  planRealMap,
  samplePoints,
} from '../helpers/real-map-sampling.ts';

const key = (p: { readonly x: number; readonly y: number }): string => `${p.x},${p.y}`;

describe('samplePoints', () => {
  it('returns exactly count distinct in-bounds points on a large map', () => {
    const points = samplePoints(1024, 512, 16);
    expect(points.length).toBe(16);
    expect(new Set(points.map(key)).size).toBe(16);
    for (const p of points) {
      expect(Number.isInteger(p.x) && p.x >= 0 && p.x < 1024).toBe(true);
      expect(Number.isInteger(p.y) && p.y >= 0 && p.y < 512).toBe(true);
    }
  });

  it('starts with the four corners and then the centre', () => {
    const points = samplePoints(37, 23, 16);
    expect(points.slice(0, 5).map(key)).toEqual(['0,0', '36,0', '0,22', '36,22', '18,11']);
  });

  it('is deterministic', () => {
    expect(samplePoints(37, 23, 16)).toEqual(samplePoints(37, 23, 16));
  });

  it('places the 16 points of a 37x23 map exactly (lattice rounded to the nearest texel)', () => {
    // Hand-computed: corners and centre, then rows ys = 0, 7, 15, 22 and columns xs = 0, 12, 24, 36,
    // row-major, skipping points already chosen, until 16 are placed.
    expect(samplePoints(37, 23, 16).map(key)).toEqual([
      '0,0', '36,0', '0,22', '36,22', '18,11',
      '12,0', '24,0', '0,7', '12,7', '24,7', '36,7', '0,15', '12,15', '24,15', '36,15', '12,22',
    ]);
  });

  it('returns one point for a 1x1 map and every texel of a 2x2 map', () => {
    expect(samplePoints(1, 1, 16)).toEqual([{ x: 0, y: 0 }]);
    expect(samplePoints(2, 2, 16).length).toBe(4);
  });

  it('rejects an invalid size or count', () => {
    expect(() => samplePoints(0, 4, 1)).toThrow(RangeError);
    expect(() => samplePoints(4, 4, 0)).toThrow(RangeError);
  });
});

describe('compareReadback', () => {
  const width = 4;
  const height = 3;
  const channels = 4;
  const frame = (fill: number): Uint8Array => new Uint8Array(width * height * channels).fill(fill);

  it('reports no mismatch for identical samples', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 2 }];
    expect(compareReadback(frame(10), frame(10), width, points, channels, height)).toEqual({
      samples: 2,
      exactMismatches: 0,
      maxDeviation: 0,
    });
  });

  it('counts a sampled difference and reports its size', () => {
    const actual = frame(10);
    actual[(2 * width + 3) * channels + 1] = 13;
    const result = compareReadback(frame(10), actual, width, [{ x: 3, y: 2 }], channels, height);
    expect(result).toEqual({ samples: 1, exactMismatches: 1, maxDeviation: 3 });
  });

  it('counts a difference of exactly one channel level as a mismatch', () => {
    const actual = frame(10);
    actual[2] = 11;
    expect(compareReadback(frame(10), actual, width, [{ x: 0, y: 0 }], channels, height)).toEqual({
      samples: 1,
      exactMismatches: 1,
      maxDeviation: 1,
    });
  });

  it('does not see a difference at an unsampled texel', () => {
    const actual = frame(10);
    actual[(1 * width + 1) * channels] = 99;
    const result = compareReadback(frame(10), actual, width, [{ x: 0, y: 0 }], channels, height);
    expect(result).toEqual({ samples: 1, exactMismatches: 0, maxDeviation: 0 });
  });

  it('rejects a buffer too short for the sampled texels', () => {
    expect(() =>
      compareReadback(new Uint8Array(4), new Uint8Array(4), width, [{ x: 3, y: 2 }], channels, height),
    ).toThrow(/buffer too short/);
  });

  it('rejects a sample at or beyond the map height, even when the buffers are long enough', () => {
    const tall = new Uint8Array(width * (height + 1) * channels).fill(10);
    expect(() => compareReadback(tall, tall, width, [{ x: 0, y: height }], channels, height)).toThrow(
      /sample outside the map/,
    );
  });

  it('defaults the height to the width, so a square frame rejects a row past its edge', () => {
    // Four rows of data, so only the height bound can reject row 3; the buffer check alone would pass it.
    const tall = new Uint8Array(3 * 4 * channels).fill(10);
    expect(() => compareReadback(tall, tall, 3, [{ x: 0, y: 3 }], channels)).toThrow(/sample outside the map/);
    expect(compareReadback(tall, tall, 3, [{ x: 2, y: 2 }], channels)).toEqual({
      samples: 1,
      exactMismatches: 0,
      maxDeviation: 0,
    });
  });
});

describe('passes', () => {
  it('the exact policy requires zero mismatching samples', () => {
    expect(passes({ samples: 16, exactMismatches: 0, maxDeviation: 0 }, { kind: 'exact' })).toBe(true);
    expect(passes({ samples: 16, exactMismatches: 1, maxDeviation: 1 }, { kind: 'exact' })).toBe(false);
  });

  it('the tolerance policy compares the largest channel deviation', () => {
    const tolerance = { kind: 'tolerance' as const, maxChannelDelta: 3 };
    expect(passes({ samples: 16, exactMismatches: 4, maxDeviation: 3 }, tolerance)).toBe(true);
    expect(passes({ samples: 16, exactMismatches: 4, maxDeviation: 4 }, tolerance)).toBe(false);
  });

  it('rejects a negative or non-finite tolerance', () => {
    const result = { samples: 16, exactMismatches: 0, maxDeviation: 0 };
    expect(() => passes(result, { kind: 'tolerance', maxChannelDelta: -1 })).toThrow(RangeError);
    expect(() => passes(result, { kind: 'tolerance', maxChannelDelta: Number.NaN })).toThrow(RangeError);
  });
});

describe('planRealMap', () => {
  // A 100 x 60 map on a 512 x 512 view with eight pan steps of (-32, -16). The expected values are worked out by hand
  // from the view rules: 1:1 centres the map, a pan moves the view by its delta, and a zoom about the centre doubles
  // the scale while keeping the map point under the centre fixed.
  const plan = planRealMap(100, 60, 512, 8, -32, -16);

  it('has 12 steps in order: 1:1 start, eight pans, two zooms, then the fit', () => {
    expect(plan.map((step) => step.name)).toEqual([
      'start', 'pan-1', 'pan-2', 'pan-3', 'pan-4', 'pan-5', 'pan-6', 'pan-7', 'pan-8', 'zoom-2', 'zoom-4', 'fit',
    ]);
  });

  it('starts at 1:1, centred on the view', () => {
    expect(plan[0].view).toEqual({ scale: 1, tx: 206, ty: 226 });
  });

  it('moves each pan step by the fixed delta and keeps the scale', () => {
    for (let i = 1; i <= 8; i++) {
      const before = plan[i - 1].view;
      const after = plan[i].view;
      expect(after.scale).toBe(1);
      expect(after.tx - before.tx).toBe(-32);
      expect(after.ty - before.ty).toBe(-16);
    }
    expect(plan[8].view).toEqual({ scale: 1, tx: -50, ty: 98 });
  });

  it('doubles the scale at each zoom, about the screen centre', () => {
    expect(plan[9].view).toEqual({ scale: 2, tx: -356, ty: -60 });
    expect(plan[10].view).toEqual({ scale: 4, tx: -968, ty: -376 });
    // The map point under the screen centre stays at (306, 158) through both zooms.
    const under = (v: { readonly scale: number; readonly tx: number; readonly ty: number }): number[] => [
      (256 - v.tx) / v.scale,
      (256 - v.ty) / v.scale,
    ];
    expect(under(plan[8].view)).toEqual([306, 158]);
    expect(under(plan[9].view)).toEqual([306, 158]);
    expect(under(plan[10].view)).toEqual([306, 158]);
  });

  it('ends with the fit view of the map', () => {
    const fit = plan[11].view;
    expect(fit.scale).toBeCloseTo(5.12, 9);
    expect(fit.tx).toBeCloseTo(0, 9);
    expect(fit.ty).toBeCloseTo(102.4, 9);
  });

  it('refuses a degenerate map', () => {
    expect(() => planRealMap(0, 60, 512, 8, -32, -16)).toThrow(/refused/);
  });
});

describe('assertRealMapContent', () => {
  const mask = (alphas: readonly number[]): Uint8Array => {
    const out = new Uint8Array(alphas.length * 4);
    alphas.forEach((alpha, i) => {
      out[i * 4 + 3] = alpha;
    });
    return out;
  };
  const ground = (colours: readonly (readonly number[])[]): Uint8Array => {
    const out = new Uint8Array(colours.length * 4);
    colours.forEach((colour, i) => out.set(colour, i * 4));
    return out;
  };

  it('accepts land, water and at least two ground colours, and reports the counts', () => {
    const result = assertRealMapContent(mask([255, 255, 0]), ground([[10, 20, 30], [40, 50, 60], [0, 0, 0]]), 128);
    expect(result).toEqual({ landTexels: 2, waterTexels: 1, groundColours: 2 });
  });

  it('refuses a blank input with no land', () => {
    expect(() =>
      assertRealMapContent(mask([0, 0, 0]), ground([[1, 2, 3], [4, 5, 6], [7, 8, 9]]), 128),
    ).toThrow(/no land/);
  });

  it('refuses an input with no water', () => {
    expect(() =>
      assertRealMapContent(mask([255, 255, 255]), ground([[1, 2, 3], [4, 5, 6], [7, 8, 9]]), 128),
    ).toThrow(/no water/);
  });

  it('refuses a ground layer that is one colour on every land texel', () => {
    expect(() =>
      assertRealMapContent(mask([255, 255, 0]), ground([[9, 9, 9], [9, 9, 9], [0, 0, 0]]), 128),
    ).toThrow(/single colour/);
  });

  it('treats alpha equal to the threshold as land', () => {
    const result = assertRealMapContent(mask([128, 127, 255]), ground([[1, 1, 1], [2, 2, 2], [3, 3, 3]]), 128);
    expect(result).toEqual({ landTexels: 2, waterTexels: 1, groundColours: 2 });
  });

  it('counts land at exactly the threshold and not one level above it', () => {
    const result = assertRealMapContent(
      mask([128, 127, 255, 255]),
      ground([[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]]),
      128,
    );
    expect(result).toEqual({ landTexels: 3, waterTexels: 1, groundColours: 3 });
  });

  it('counts colours that differ only in green, or only in blue, as separate colours', () => {
    expect(assertRealMapContent(mask([255, 255, 0]), ground([[1, 1, 1], [1, 2, 1], [0, 0, 0]]), 128).groundColours).toBe(2);
    expect(assertRealMapContent(mask([255, 255, 0]), ground([[1, 1, 1], [1, 1, 2], [0, 0, 0]]), 128).groundColours).toBe(2);
  });

  it('refuses mismatched buffer sizes', () => {
    expect(() => assertRealMapContent(mask([255, 0]), ground([[1, 2, 3]]), 128)).toThrow(RangeError);
  });
});
