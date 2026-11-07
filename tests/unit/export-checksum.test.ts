import { describe, expect, it } from 'vitest';
import { fnv1a32 } from '../../src/core/export/checksum.ts';

// Card 1.10 Stage B2 (detail v2): FNV-1a 32-bit checksum for the transfer integrity check. Pure; Node only.

function bigintFnv1a32(bytes: Uint8Array): number {
  let h = 0x811c9dc5n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x01000193n) & 0xffffffffn;
  }
  return Number(h);
}

function seededBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out[i] = s & 0xff;
  }
  return out;
}

describe('fnv1a32 (card 1.10, Stage B2)', () => {
  it('matches the published FNV-1a 32-bit vectors', () => {
    expect(fnv1a32(new Uint8Array([]))).toBe(0x811c9dc5);
    expect(fnv1a32(new TextEncoder().encode('a'))).toBe(0xe40c292c);
    expect(fnv1a32(new TextEncoder().encode('foobar'))).toBe(0xbf9cf968);
  });

  it('agrees with an independent BigInt implementation on seeded arrays', () => {
    for (let k = 0; k < 32; k++) {
      const bytes = seededBytes(1 + k * 37, 0x9e3779b9 + k);
      expect(fnv1a32(bytes)).toBe(bigintFnv1a32(bytes));
    }
  });
});
