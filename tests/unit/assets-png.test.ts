import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PngError, PNG_LIMITS, crc32, readPngInfo, validatePng } from '../../src/core/assets/png.ts';
import type { PngErrorCode } from '../../src/core/assets/png.ts';
import { makePng } from '../helpers/pck-synthetic.ts';

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectCode(fn: () => unknown, code: PngErrorCode): PngError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PngError);
    expect((error as PngError).code).toBe(code);
    return error as PngError;
  }
  throw new Error(`expected PngError ${code}, but nothing was thrown`);
}

/** Walk chunk starts (offsets of the length field) of a complete PNG. */
function chunkStarts(png: Uint8Array): number[] {
  const starts: number[] = [];
  let pos = 8;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (pos + 8 <= png.length) {
    starts.push(pos);
    const length = view.getUint32(pos, false);
    if (length > 0x7fffffff || pos + 12 + length > png.length) break;
    pos += 12 + length;
    if (starts.length > 100_000) break;
  }
  return starts;
}

function setU32BE(bytes: Uint8Array, pos: number, value: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(pos, value, false);
}

function getU32BE(bytes: Uint8Array, pos: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(pos, false);
}

function fixChunkCrc(png: Uint8Array, start: number): void {
  const length = getU32BE(png, start);
  const check = png.subarray(start + 4, start + 8 + length);
  setU32BE(png, start + 8 + length, nodeCrc32(check) >>> 0);
}

const legalPairs: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 4], [0, 8], [0, 16],
  [2, 8], [2, 16],
  [3, 1], [3, 2], [3, 4], [3, 8],
  [4, 8], [4, 16],
  [6, 8], [6, 16],
];

describe('valid PNGs', () => {
  it.each(legalPairs)('colour type %i bit depth %i validates', (colorType, bitDepth) => {
    const png = makePng({ width: 3, height: 2, colorType, bitDepth });
    const info = validatePng(png);
    const head = readPngInfo(png);
    expect(info.width).toBe(3);
    expect(info.height).toBe(2);
    expect(head.width).toBe(info.width);
    expect(head.height).toBe(info.height);
    expect(info.bitDepth).toBe(bitDepth);
    expect(info.colorType).toBe(colorType);
    expect(info.chunkCount).toBeGreaterThanOrEqual(3);
    expect(info.idatBytes).toBeGreaterThan(0);
  });

  it('readPngInfo and validatePng agree on dimensions', () => {
    const png = makePng({ width: 13, height: 7, colorType: 2, bitDepth: 8, idatChunks: 3 });
    expect(readPngInfo(png).width).toBe(validatePng(png).width);
    expect(readPngInfo(png).height).toBe(validatePng(png).height);
  });

  it('split IDAT chunks validate', () => {
    const png = makePng({ width: 5, height: 5, idatChunks: 4 });
    expect(validatePng(png).chunkCount).toBe(1 + 4 + 1);
  });
});

describe('hostile PNGs with exact codes', () => {
  it('short input is SIGNATURE or TRUNCATED', () => {
    expectCode(() => validatePng(new Uint8Array(0)), 'TRUNCATED');
    expectCode(() => validatePng(new Uint8Array([137, 80, 78])), 'TRUNCATED');
    expectCode(() => readPngInfo(new Uint8Array(0)), 'TRUNCATED');
  });

  it('wrong signature is SIGNATURE', () => {
    const png = makePng().slice();
    png[0] = 0x00;
    expectCode(() => validatePng(png), 'SIGNATURE');
    expectCode(() => readPngInfo(png), 'SIGNATURE');
  });

  it('every prefix of a small PNG is TRUNCATED, SIGNATURE or chunk-aligned CHUNK', () => {
    const png = makePng({ width: 4, height: 4 });
    const boundaries = new Set(chunkStarts(png));
    for (let len = 0; len < png.length; len++) {
      const prefix = png.subarray(0, len);
      try {
        validatePng(prefix);
      } catch (error) {
        expect(error).toBeInstanceOf(PngError);
        const code = (error as PngError).code;
        if (code === 'CHUNK') {
          // Only a prefix that ends exactly on a chunk boundary may report a
          // missing IEND/IDAT instead of TRUNCATED (N4/N5 take precedence there).
          expect(boundaries.has(len)).toBe(true);
        } else {
          expect(code === 'TRUNCATED' || code === 'SIGNATURE').toBe(true);
        }
        continue;
      }
      throw new Error(`prefix ${len} unexpectedly validated`);
    }
  });

  it('corrupt chunk data is CRC', () => {
    const png = makePng({ width: 4, height: 4, extraChunksBeforeIdat: [{ type: 'tEXt', data: new Uint8Array([1, 2, 3, 4]) }] }).slice();
    const starts = chunkStarts(png);
    const textStart = starts[1];
    png[textStart + 8 + 1] ^= 0xff;
    expectCode(() => validatePng(png), 'CRC');
  });

  it('corrupt CRC is CRC', () => {
    const png = makePng().slice();
    png[png.length - 1] ^= 0x01;
    expectCode(() => validatePng(png), 'CRC');
  });

  it('a flipped byte in IHDR data is CRC', () => {
    const png = makePng({ width: 4, height: 4 }).slice();
    png[20] ^= 0xff; // inside the height field; the CRC now mismatches
    expectCode(() => validatePng(png), 'CRC');
    expectCode(() => readPngInfo(png), 'CRC');
  });

  it('a flipped byte in the IHDR CRC is CRC', () => {
    const png = makePng({ width: 4, height: 4 }).slice();
    png[29] ^= 0x10; // first byte of the IHDR CRC
    expectCode(() => validatePng(png), 'CRC');
    expectCode(() => readPngInfo(png), 'CRC');
  });

  it('a flipped byte in IDAT data is CRC', () => {
    const png = makePng({ width: 4, height: 4 }).slice();
    const starts = chunkStarts(png);
    png[starts[1] + 8] ^= 0x01; // first byte of the IDAT payload
    expectCode(() => validatePng(png), 'CRC');
  });

  it('a lying chunk length is TRUNCATED', () => {
    const png = makePng().slice();
    const starts = chunkStarts(png);
    setU32BE(png, starts[1], getU32BE(png, starts[1]) + 1000);
    expectCode(() => validatePng(png), 'TRUNCATED');
  });

  it('a length above 0x7FFFFFFF is CHUNK', () => {
    const png = makePng().slice();
    setU32BE(png, 8, 0x80000000);
    expectCode(() => validatePng(png), 'CHUNK');
  });

  it('a non-letter chunk type is CHUNK', () => {
    const png = makePng().slice();
    png[12] = 0x21;
    expectCode(() => validatePng(png), 'CHUNK');
  });

  it('missing IEND is CHUNK', () => {
    const png = makePng({ width: 3, height: 3 });
    const starts = chunkStarts(png);
    const iend = starts[starts.length - 1];
    // Replace the trailing IEND with a tEXt chunk so the file ends cleanly.
    const head = png.subarray(0, iend);
    const tail = makePng({ width: 3, height: 3, extraChunksBeforeIdat: [{ type: 'tEXt', data: new Uint8Array([9]) }] });
    const tailStarts = chunkStarts(tail);
    const textChunk = tail.subarray(tailStarts[1], tailStarts[2]);
    const out = new Uint8Array(head.length + textChunk.length);
    out.set(head, 0);
    out.set(textChunk, head.length);
    expectCode(() => validatePng(out), 'CHUNK');
  });

  it('IEND not last is CHUNK', () => {
    const png = makePng({ width: 3, height: 3 });
    const extra = makePng({ width: 3, height: 3, extraChunksBeforeIdat: [{ type: 'tEXt', data: new Uint8Array([7, 7]) }] });
    const extraStarts = chunkStarts(extra);
    const textChunk = extra.subarray(extraStarts[1], extraStarts[2]);
    // A chunk AFTER IEND: IEND is no longer last.
    const out = new Uint8Array(png.length + textChunk.length);
    out.set(png, 0);
    out.set(textChunk, png.length);
    expectCode(() => validatePng(out), 'CHUNK');
  });

  it('non-empty IEND is CHUNK', () => {
    const ihdr = makePng({ width: 2, height: 2 });
    const starts = chunkStarts(ihdr);
    const iend = starts[starts.length - 1];
    const out = new Uint8Array(ihdr.length + 1);
    out.set(ihdr.subarray(0, iend), 0);
    const view = new DataView(out.buffer);
    view.setUint32(iend, 1, false);
    out.set([73, 69, 78, 68], iend + 4);
    out[iend + 8] = 0x00;
    const check = out.subarray(iend + 4, iend + 9);
    view.setUint32(iend + 9, nodeCrc32(check) >>> 0, false);
    expectCode(() => validatePng(out), 'CHUNK');
  });

  it('bytes after IEND are TRAILING', () => {
    const png = makePng();
    const out = new Uint8Array(png.length + 1);
    out.set(png, 0);
    out[png.length] = 0x00;
    expectCode(() => validatePng(out), 'TRAILING');
  });

  it('IDAT split by tEXt is CHUNK', () => {
    const png = makePng({ width: 4, height: 4, idatChunks: 2 });
    const starts = chunkStarts(png);
    // Layout: IHDR, IDAT, IDAT, IEND. Insert a tEXt chunk between the IDATs.
    const firstIdatEnd = starts[2];
    const text = makePng({ extraChunksBeforeIdat: [{ type: 'tEXt', data: new Uint8Array([1]) }] });
    const textStarts = chunkStarts(text);
    const textChunk = text.subarray(textStarts[1], textStarts[2]);
    const out = new Uint8Array(png.length + textChunk.length);
    out.set(png.subarray(0, firstIdatEnd), 0);
    out.set(textChunk, firstIdatEnd);
    out.set(png.subarray(firstIdatEnd), firstIdatEnd + textChunk.length);
    expectCode(() => validatePng(out), 'CHUNK');
  });

  it('colour type 3 without PLTE is CHUNK', () => {
    const full = makePng({ width: 2, height: 2, colorType: 3, bitDepth: 8 });
    const starts = chunkStarts(full);
    // Drop the auto-generated PLTE (chunk index 1).
    const plteStart = starts[1];
    const plteEnd = starts[2];
    const out = new Uint8Array(full.length - (plteEnd - plteStart));
    out.set(full.subarray(0, plteStart), 0);
    out.set(full.subarray(plteEnd), plteStart);
    expectCode(() => validatePng(out), 'CHUNK');
  });

  it.each([0, 4])('PLTE with colour type %i is CHUNK', (colorType) => {
    const plte = new Uint8Array([0, 0, 0, 255, 255, 255]);
    const png = makePng({ width: 2, height: 2, colorType, bitDepth: 8, extraChunksBeforeIdat: [{ type: 'PLTE', data: plte }] });
    expectCode(() => validatePng(png), 'CHUNK');
  });

  it('zero width is IHDR', () => {
    const png = makePng().slice();
    setU32BE(png, 16, 0);
    fixChunkCrc(png, 8);
    expectCode(() => validatePng(png), 'IHDR');
    expectCode(() => readPngInfo(png), 'IHDR');
  });

  it('width above the limit is LIMIT', () => {
    const png = makePng().slice();
    setU32BE(png, 16, PNG_LIMITS.maxDimension + 1);
    fixChunkCrc(png, 8);
    expectCode(() => validatePng(png), 'LIMIT');
  });

  it('legal dimensions with too many pixels are LIMIT', () => {
    // 16384 x 8193 = 134,225,920 > 134,217,728, each dimension within the cap.
    const png = makePng().slice();
    setU32BE(png, 16, 16384);
    setU32BE(png, 20, 8193);
    fixChunkCrc(png, 8);
    expectCode(() => validatePng(png), 'LIMIT');
  });

  it('interlace 2 is IHDR', () => {
    const png = makePng().slice();
    png[28] = 2;
    fixChunkCrc(png, 8);
    expectCode(() => validatePng(png), 'IHDR');
  });

  it('illegal pair (2, 4) is IHDR', () => {
    const png = makePng({ colorType: 2, bitDepth: 8 }).slice();
    png[24] = 4;
    fixChunkCrc(png, 8);
    expectCode(() => validatePng(png), 'IHDR');
  });

  it('first chunk not IHDR is IHDR', () => {
    const png = makePng().slice();
    png[12] = 73; // 'I'
    png[13] = 68; // 'D'
    png[14] = 65; // 'A'
    png[15] = 84; // 'T'
    fixChunkCrc(png, 8);
    expectCode(() => validatePng(png), 'IHDR');
  });
});

describe('crc32 oracle', () => {
  it('matches the known value for "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('equals zlib.crc32 on 200 random buffers', () => {
    const rnd = mulberry32(0x5eed);
    for (let i = 0; i < 200; i++) {
      const n = Math.floor(rnd() * 64);
      const bytes = new Uint8Array(n);
      for (let k = 0; k < n; k++) bytes[k] = Math.floor(rnd() * 256);
      expect(crc32(bytes)).toBe(nodeCrc32(bytes) >>> 0);
      if (n > 2) {
        const start = Math.floor(rnd() * n);
        const end = start + Math.floor(rnd() * (n - start));
        expect(crc32(bytes, start, end)).toBe(nodeCrc32(bytes.subarray(start, end)) >>> 0);
      }
    }
  });
});

function mutatePng(base: Uint8Array, rnd: () => number): Uint8Array {
  const kind = Math.floor(rnd() * 5);
  if (kind === 0) {
    const out = base.slice();
    const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) out[Math.floor(rnd() * out.length)] = Math.floor(rnd() * 256);
    return out;
  }
  if (kind === 1) {
    const at = Math.floor(rnd() * (base.length + 1));
    const n = 1 + Math.floor(rnd() * 8);
    const out = new Uint8Array(base.length + n);
    out.set(base.subarray(0, at), 0);
    for (let k = 0; k < n; k++) out[at + k] = Math.floor(rnd() * 256);
    out.set(base.subarray(at), at + n);
    return out;
  }
  if (kind === 2) {
    if (base.length < 2) return base.slice();
    const at = Math.floor(rnd() * base.length);
    const n = 1 + Math.floor(rnd() * Math.min(8, base.length - at));
    const out = new Uint8Array(base.length - n);
    out.set(base.subarray(0, at), 0);
    out.set(base.subarray(at + n), at);
    return out;
  }
  if (kind === 3) {
    const out = base.slice();
    const a = Math.floor(rnd() * out.length);
    const b = Math.floor(rnd() * out.length);
    const t = out[a];
    out[a] = out[b];
    out[b] = t;
    return out;
  }
  const out = base.slice();
  const at = Math.floor(rnd() * out.length);
  const n = 1 + Math.floor(rnd() * Math.min(16, out.length - at));
  for (let k = 0; k < n; k++) out[at + k] = out[at];
  return out;
}

describe('seeded fuzz', () => {
  it('1000 mutations throw only PngError', () => {
    const base = makePng({ width: 6, height: 5, colorType: 2, bitDepth: 8, idatChunks: 2 });
    const rnd = mulberry32(0xf02);
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      const mut = mutatePng(base, rnd);
      try {
        validatePng(mut);
        ok++;
      } catch (error) {
        expect(error).toBeInstanceOf(PngError);
      }
    }
    expect(ok).toBeGreaterThan(0);
  });
});

describe('large PNG budget', () => {
  it('a 9 MB PNG validates quickly', () => {
    const big = new Uint8Array(9 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
    const png = makePng({ width: 8, height: 8, extraChunksBeforeIdat: [{ type: 'tEXt', data: big }] });
    expect(png.length).toBeGreaterThan(9 * 1024 * 1024);
    const start = Date.now();
    const info = validatePng(png);
    const elapsed = Date.now() - start;
    expect(info.width).toBe(8);
    expect(elapsed).toBeLessThan(1000);
  });
});
