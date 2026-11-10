import { describe, expect, it, vi } from 'vitest';
import { selectWindow, type RgbaRaster } from '../../src/core/firstlight/layers.ts';

function solidMask(width: number, height: number, alpha: number): RgbaRaster {
  const data = new Uint8Array(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = alpha;
  return { width, height, data };
}

/** Count full-map Uint32 summed-area tables without tying the test to their contents. */
function withTableAllocationCount(mask: RgbaRaster, run: () => void): number {
  const tableLength = (mask.width + 1) * (mask.height + 1);
  const allocations: number[] = [];
  const original = globalThis.Uint32Array;
  vi.stubGlobal('Uint32Array', new Proxy(original, {
    construct(target, args, newTarget) {
      if (args[0] === tableLength) allocations.push(tableLength);
      return Reflect.construct(target, args, newTarget);
    },
  }));
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
  }
  return allocations.length;
}

describe('First Light window selection avoids unnecessary coast tables', () => {
  it.each([
    ['all land', 255, 16],
    ['all water', 0, 16],
    ['window cannot fit', 255, 64],
  ] as const)('does not build a coast table for %s', (_case, alpha, size) => {
    const mask = solidMask(48, 40, alpha);
    const allocations = withTableAllocationCount(mask, () => {
      expect(() => selectWindow(mask, 128, size, 8)).toThrowError(
        new RangeError('no candidate window fits, or none is eligible'),
      );
    });
    expect(allocations).toBe(1); // land table only
  });

  it('still builds the coast table and scores eligible windows', () => {
    const mask = solidMask(48, 40, 0);
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < 24; x++) mask.data[(y * mask.width + x) * 4 + 3] = 255;
    }
    const allocations = withTableAllocationCount(mask, () => {
      expect(selectWindow(mask, 128, 16, 8)).toEqual({
        x0: 16,
        y0: 0,
        coastTexels: 64,
        landFraction: 0.5,
      });
    });
    expect(allocations).toBe(2);
  });
});
