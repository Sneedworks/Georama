// Card 1.4 vectors: fixed, pure CPU inputs for the tile rule. No network, no GPU, no files.
import type { TileParams } from '../../src/core/texture/tiling.ts';

export interface VectorTexture {
  readonly tw: number;
  readonly th: number;
  readonly rgba: Uint8Array;
}

// Seeded 32-bit linear congruential generator; the constants are fixed so the bytes repeat on every run.
function seededBytes(seed: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  let s = seed >>> 0;
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const SIDE = 5;

export const VECTOR_TEXTURE: VectorTexture = {
  tw: SIDE,
  th: SIDE,
  rgba: seededBytes(0x1f4a, SIDE * SIDE * 4),
};

export function flipV(t: VectorTexture): Uint8Array {
  const row = t.tw * 4;
  const out = new Uint8Array(t.rgba.length);
  for (let y = 0; y < t.th; y++) {
    const src = (t.th - 1 - y) * row;
    out.set(t.rgba.subarray(src, src + row), y * row);
  }
  return out;
}

export function transposeSquare(t: VectorTexture): Uint8Array {
  if (t.tw !== t.th) throw new Error('transposeSquare needs a square texture');
  const out = new Uint8Array(t.rgba.length);
  for (let y = 0; y < t.th; y++) {
    for (let x = 0; x < t.tw; x++) {
      const src = (y * t.tw + x) * 4;
      const dst = (x * t.tw + y) * 4;
      for (let c = 0; c < 4; c++) out[dst + c] = t.rgba[src + c];
    }
  }
  return out;
}

export const VECTOR_OUT = { outW: 13, outH: 9 } as const;

export const VECTOR_SETS: ReadonlyArray<{ name: string; params: TileParams }> = [
  { name: 'set 1: k 1, no offset', params: { k: 1, ox: 0, oy: 0 } },
  { name: 'set 2: k 1, small offsets', params: { k: 1, ox: 7, oy: 5 } },
  { name: 'set 3: k 2, no offset', params: { k: 2, ox: 0, oy: 0 } },
  { name: 'set 4: k 3, mixed offsets', params: { k: 3, ox: 11, oy: 2 } },
  { name: 'set 5: k 7, large offsets', params: { k: 7, ox: 60000, oy: 40000 } },
  { name: 'set 6: k 64, range edges', params: { k: 64, ox: 65535, oy: 65535 } },
];
