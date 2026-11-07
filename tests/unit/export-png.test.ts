import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePngRgba8 } from '../../src/core/assets/png-pixels.ts';
import { ExportError, type ExportErrorCode } from '../../src/core/export/errors.ts';
import { encodePngRgba8 } from '../../src/core/export/png.ts';

// Golden hashes recorded from the LEGACY harness encoder (tests/e2e/firstlight-png.mjs) before card 1.10 changed anything.
// Fixture: rgba[n] = (n * 37 + 11) & 255. Detail v1, fact F16.
const GOLDEN = [
  { width: 1, height: 1, bytes: 70, sha256: '154d01c88b27f4e19cd7ef8e7e41c4ab3db21a549de40ba4a432f178fb386c3b' },
  { width: 3, height: 2, bytes: 92, sha256: '61f99983f58102141538e8766cf62296617b317ee51120ede187fd5293e751f4' },
  { width: 17, height: 9, bytes: 372, sha256: '7a995731fbf6aa1f710ae415afb975e44a2adcec1bfebb6d8736bda525573fcb' },
] as const;

// Default IDAT chunk size of the core encoder (1 MiB). Pinned by the default-chunk case.
const DEFAULT_IDAT_BYTES = 1048576;

function fixture(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let n = 0; n < rgba.length; n++) rgba[n] = (n * 37 + 11) & 255;
  return rgba;
}

function deflate(raw: Uint8Array): Uint8Array {
  return deflateSync(raw);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Chunks in file order: type and data length. Offset-aware (buffer, byteOffset, byteLength).
function chunks(png: Uint8Array): { type: string; length: number }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; length: number }[] = [];
  let pos = 8;
  while (pos < png.length) {
    const length = view.getUint32(pos, false);
    out.push({ type: Buffer.from(png.subarray(pos + 4, pos + 8)).toString('latin1'), length });
    pos += 12 + length;
  }
  return out;
}

function codeOf(fn: () => unknown): ExportErrorCode | 'ok' {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (error instanceof ExportError) return error.code;
    throw error;
  }
}

describe('encodePngRgba8 (card 1.10, Stage A)', () => {
  it('reproduces the legacy golden bytes for the three fixtures', () => {
    for (const g of GOLDEN) {
      const png = encodePngRgba8(g.width, g.height, fixture(g.width, g.height), deflate);
      expect(png.length).toBe(g.bytes);
      expect(sha256(png)).toBe(g.sha256);
    }
  });

  it('round-trips through decodePngRgba8 for 3x2 and 17x9', () => {
    for (const [width, height] of [[3, 2], [17, 9]] as const) {
      const rgba = fixture(width, height);
      const decoded = decodePngRgba8(encodePngRgba8(width, height, rgba, deflate));
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
    }
  });

  it('splits IDAT into chunks of at most idatChunkBytes, and still round-trips', () => {
    const rgba = fixture(5, 4);
    const png = encodePngRgba8(5, 4, rgba, deflate, { idatChunkBytes: 7 });
    const list = chunks(png);
    expect(list[0]?.type).toBe('IHDR');
    expect(list[list.length - 1]?.type).toBe('IEND');
    const idats = list.filter((c) => c.type === 'IDAT').map((c) => c.length);
    expect(idats.length).toBeGreaterThan(1);
    expect(Math.max(...idats)).toBeLessThanOrEqual(7);
    expect(idats.slice(0, -1).every((length) => length === 7)).toBe(true);
    const decoded = decodePngRgba8(png);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  it('uses 1 MiB IDAT chunks by default', () => {
    // Incompressible fixture (seeded LCG): the compressed stream is larger than one chunk.
    const width = 1024;
    const height = 1024;
    const rgba = new Uint8Array(width * height * 4);
    let seed = 0x2545f491;
    for (let n = 0; n < rgba.length; n++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      rgba[n] = seed >>> 24;
    }
    const idats = chunks(encodePngRgba8(width, height, rgba, deflate))
      .filter((c) => c.type === 'IDAT')
      .map((c) => c.length);
    expect(idats.length).toBeGreaterThan(1);
    expect(Math.max(...idats)).toBeLessThanOrEqual(DEFAULT_IDAT_BYTES);
    expect(idats.slice(0, -1).every((length) => length === DEFAULT_IDAT_BYTES)).toBe(true);
  });

  it('refuses bad input with the documented codes, checked in the documented order', () => {
    const one = new Uint8Array(4);
    expect(codeOf(() => encodePngRgba8(0, 1, one, deflate))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, Number.NaN, one, deflate))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, 1, new Uint8Array(3), deflate))).toBe('length');
    expect(codeOf(() => encodePngRgba8(1, 1, [1, 2, 3, 4] as unknown as Uint8Array, deflate))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, 1, one, 'deflate' as unknown as typeof deflate))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, 1, one, () => [1, 2] as unknown as Uint8Array))).toBe('deflate');
    expect(codeOf(() => encodePngRgba8(1, 1, one, () => new Uint8Array(0)))).toBe('deflate');
    expect(codeOf(() => encodePngRgba8(16385, 1, new Uint8Array(0), deflate))).toBe('limit');
    expect(codeOf(() => encodePngRgba8(16385, 1, [] as unknown as Uint8Array, deflate))).toBe('limit');
    expect(codeOf(() => encodePngRgba8(1, 1, one, deflate, { idatChunkBytes: 0 }))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, 1, one, deflate, { idatChunkBytes: Number.NaN }))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, 1, one, deflate, { idatChunkBytes: 2.5 }))).toBe('param');
    expect(codeOf(() => encodePngRgba8(1, 1, one, deflate, { idatChunkBytes: 2147483648 }))).toBe('param');
    // The chunk-size check runs before deflate: a refused size never calls it.
    let calls = 0;
    const counting = (raw: Uint8Array): Uint8Array => {
      calls++;
      return deflateSync(raw);
    };
    expect(codeOf(() => encodePngRgba8(1, 1, one, counting, { idatChunkBytes: 0 }))).toBe('param');
    expect(calls).toBe(0);
  });

  it('keeps the harness wrapper output byte-identical to the golden bytes, and returns a Buffer', async () => {
    const url = new URL('../e2e/firstlight-png.mjs', import.meta.url).href;
    const wrapper = (await import(url)) as {
      encodePngRgba8: (width: number, height: number, rgba: Uint8Array) => Uint8Array;
    };
    for (const g of GOLDEN) {
      const out = wrapper.encodePngRgba8(g.width, g.height, fixture(g.width, g.height));
      expect(sha256(out)).toBe(g.sha256);
      expect(Buffer.isBuffer(out)).toBe(true);
    }
  });
});
