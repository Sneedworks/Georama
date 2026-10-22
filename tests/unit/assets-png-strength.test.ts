// Strength round for src/core/assets/png.ts, written from the card (T0.6a, rules N1 to N5) and from a mutation
// table of the module (432 operator mutants; 306 were killed by the implementer's tests). The block pins what no
// earlier test pinned: every signature byte, chunk-type letter boundaries, each IHDR field in isolation, the
// dimension and pixel limits at their exact edge, the chunk-count limit, the PLTE / IDAT / IEND ordering rules,
// the byte range of crc32, and the error offsets (the card fixes them for TRUNCATED and CRC; the others are
// characterised here, so a change must be deliberate).
//
// Mutants that stay alive on purpose (reasoning, not a test gap):
//  - initial values of locals that are always assigned before use (`let width = 0`, `bitDepth`, `colorType`,
//    `interlace`, `seenIhdr`, `firstIdat = -2`, `iendAt = -2`): the first chunk is IHDR or the walk throws.
//  - the CRC table size and its loop bound (`256 -> 257`, `i = 1`, `i <= 255`): index 0 is 0 anyway and 256 is never read.
//  - `idatCount > 0` against `>= 0` in `plteAfterIdat` and the equivalent `gapSinceIdat` guards: each is hidden by the
//    ordering check that follows it.
//
// N5 (resolved in this round, test first): once IEND has been read, bytes that do not form a chunk (fewer than 8 bytes, a
// header with an impossible length or a type that is not four letters, a chunk that claims more than remains) are TRAILING
// at the end of IEND, as the card says ("any byte after its CRC"). A well-formed extra chunk is "IEND is not last" (CHUNK),
// or CRC when its CRC is wrong.
import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PNG_LIMITS, PngError, crc32, readPngInfo, validatePng } from '../../src/core/assets/png.ts';

const SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function be32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

function chunk(type: string | number[], data: ArrayLike<number> = [], o: { length?: number; crc?: number } = {}): Uint8Array {
  const typeBytes = Uint8Array.from(typeof type === 'string' ? Array.from(type, (c) => c.charCodeAt(0)) : type);
  const body = Uint8Array.from(data);
  const crc = o.crc ?? zlibCrc32(cat(typeBytes, body)) >>> 0;
  return cat(be32(o.length ?? body.length), typeBytes, body, be32(crc));
}

interface IhdrOptions { w?: number; h?: number; depth?: number; color?: number; comp?: number; filter?: number; interlace?: number }
function ihdrData(o: IhdrOptions = {}): Uint8Array {
  return cat(be32(o.w ?? 2), be32(o.h ?? 2), Uint8Array.of(o.depth ?? 8, o.color ?? 6, o.comp ?? 0, o.filter ?? 0, o.interlace ?? 0));
}

const PLTE = (): Uint8Array => chunk('PLTE', [0, 0, 0, 255, 255, 255]);
const IDAT = (n = 3): Uint8Array => chunk('IDAT', Array.from({ length: n }, (_, i) => i + 1));
const IEND = (): Uint8Array => chunk('IEND');
const IHDR = (o: IhdrOptions = {}): Uint8Array => chunk('IHDR', ihdrData(o));
const png = (...chunks: Uint8Array[]): Uint8Array => cat(SIG, ...chunks);
/** A minimal valid PNG of any colour type: PLTE is added where the card requires it. */
function minimal(o: IhdrOptions = {}): Uint8Array {
  return png(IHDR(o), ...((o.color ?? 6) === 3 ? [PLTE()] : []), IDAT(), IEND());
}

type Outcome = 'ok' | { code: string; offset: number };
function outcome(fn: () => unknown): Outcome {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (!(error instanceof PngError)) throw error;
    return { code: error.code, offset: error.offset };
  }
}
const err = (code: string, offset: number): Outcome => ({ code, offset });

describe('crc32: argument validation and byte range', () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 255);
  it('is the CRC of exactly [start, end)', () => {
    for (const [s, e] of [[0, 64], [1, 64], [0, 63], [10, 20], [63, 64], [64, 64], [0, 0], [30, 30], [5, 6]]) {
      expect(crc32(bytes, s, e)).toBe(zlibCrc32(bytes.subarray(s, e)) >>> 0);
    }
    expect(crc32(bytes)).toBe(zlibCrc32(bytes) >>> 0);
    expect(crc32(bytes, 7)).toBe(zlibCrc32(bytes.subarray(7)) >>> 0);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it.each([
    ['not a Uint8Array', () => crc32([1, 2, 3] as unknown as Uint8Array)],
    ['null', () => crc32(null as unknown as Uint8Array)],
    ['start NaN', () => crc32(bytes, Number.NaN, 10)],
    ['start -1', () => crc32(bytes, -1, 10)],
    ['start 1.5', () => crc32(bytes, 1.5, 10)],
    ['start Infinity', () => crc32(bytes, Number.POSITIVE_INFINITY, 64)],
    ['end NaN', () => crc32(bytes, 0, Number.NaN)],
    ['end 1.5', () => crc32(bytes, 0, 1.5)],
    ['end below start', () => crc32(bytes, 10, 9)],
    ['end above the length', () => crc32(bytes, 0, 65)],
    ['start above the length', () => crc32(bytes, 65, 65)],
  ])('%s is a PngError CHUNK at offset 0', (_name, run) => {
    expect(outcome(run)).toEqual(err('CHUNK', 0));
  });
});

describe('signature: every byte, every length', () => {
  const good = minimal();
  it.each(Array.from({ length: 8 }, (_, i) => i))('byte %i wrong is SIGNATURE at offset 0 in both readers', (i) => {
    const bad = good.slice();
    bad[i] ^= 0x01;
    expect(outcome(() => validatePng(bad))).toEqual(err('SIGNATURE', 0));
    expect(outcome(() => readPngInfo(bad))).toEqual(err('SIGNATURE', 0));
  });
  it('lengths below 8 are TRUNCATED at the length, 8 is TRUNCATED at 8 (no chunk)', () => {
    for (const n of [0, 1, 7]) {
      expect(outcome(() => validatePng(good.subarray(0, n)))).toEqual(err('TRUNCATED', n));
      expect(outcome(() => readPngInfo(good.subarray(0, n)))).toEqual(err('TRUNCATED', n));
    }
    expect(outcome(() => validatePng(SIG))).toEqual(err('TRUNCATED', 8));
    expect(outcome(() => readPngInfo(SIG))).toEqual(err('TRUNCATED', 8));
  });
  it('something that is not a Uint8Array is TRUNCATED at 0', () => {
    for (const bad of [null, undefined, [137, 80], 'PNG', {}]) {
      expect(outcome(() => validatePng(bad as unknown as Uint8Array))).toEqual(err('TRUNCATED', 0));
      expect(outcome(() => readPngInfo(bad as unknown as Uint8Array))).toEqual(err('TRUNCATED', 0));
    }
  });
});

describe('readPngInfo: the first chunk only', () => {
  const full = minimal({ w: 300, h: 7, depth: 16, color: 2, interlace: 1 });
  it('returns the header fields and the documented constants', () => {
    expect(readPngInfo(full)).toEqual({ width: 300, height: 7, bitDepth: 16, colorType: 2, interlace: 1, idatBytes: 0, chunkCount: 1 });
    expect(readPngInfo(minimal({ w: 1, h: 1, depth: 1, color: 0 }))).toEqual({ width: 1, height: 1, bitDepth: 1, colorType: 0, interlace: 0, idatBytes: 0, chunkCount: 1 });
  });
  it('lengths 8..15 are TRUNCATED at the length; 16 and 32 are TRUNCATED at the length; 33 parses', () => {
    for (const n of [9, 12, 15, 16, 20, 32]) expect(outcome(() => readPngInfo(full.subarray(0, n)))).toEqual(err('TRUNCATED', n));
    expect(outcome(() => readPngInfo(full.subarray(0, 33)))).toBe('ok');
  });
  it('a chunk length above 0x7fffffff is CHUNK at 8; exactly 0x7fffffff reaches the IHDR length check', () => {
    expect(outcome(() => readPngInfo(png(chunk('IHDR', ihdrData(), { length: 0x80000000 }))))).toEqual(err('CHUNK', 8));
    expect(outcome(() => readPngInfo(png(chunk('IHDR', ihdrData(), { length: 0xffffffff }))))).toEqual(err('CHUNK', 8));
    expect(outcome(() => readPngInfo(png(chunk('IHDR', ihdrData(), { length: 0x7fffffff }))))).toEqual(err('IHDR', 8));
  });
  it('a first chunk that is not IHDR, or an IHDR whose length is not 13, is IHDR at 8', () => {
    expect(outcome(() => readPngInfo(png(chunk('IDAT', ihdrData()))))).toEqual(err('IHDR', 8));
    expect(outcome(() => readPngInfo(png(chunk('IHDX', ihdrData()))))).toEqual(err('IHDR', 8));
    expect(outcome(() => readPngInfo(png(chunk('ihdr', ihdrData()))))).toEqual(err('IHDR', 8));
    for (const n of [0, 12, 14, 40]) {
      expect(outcome(() => readPngInfo(png(chunk('IHDR', new Uint8Array(n)))))).toEqual(err('IHDR', 8));
    }
  });
  it('a flipped bit in any IHDR CRC byte or data byte is CRC at 8', () => {
    for (let i = 8 + 8; i < 8 + 25; i++) {
      const bad = full.slice();
      bad[i] ^= 0x10;
      const result = outcome(() => readPngInfo(bad));
      // A flipped data byte is a CRC error; the CRC bytes themselves too.
      expect(result).toEqual(err('CRC', 8));
    }
  });
});

describe('IHDR fields, one at a time, in both readers', () => {
  const both = (o: IhdrOptions | { raw: Uint8Array }): Outcome[] => {
    const data = 'raw' in o ? o.raw : ihdrData(o);
    const first = png(chunk('IHDR', data));
    const whole = png(chunk('IHDR', data), PLTE(), IDAT(), IEND());
    return [outcome(() => readPngInfo(first)), outcome(() => validatePng(whole))];
  };
  const expectBoth = (o: IhdrOptions, expected: Outcome): void => {
    const [a, b] = both(o);
    expect({ readPngInfo: a, validatePng: b }).toEqual({ readPngInfo: expected, validatePng: expected });
  };
  it('zero width or height is IHDR at 8', () => {
    expectBoth({ w: 0 }, err('IHDR', 8));
    expectBoth({ h: 0 }, err('IHDR', 8));
    expectBoth({ w: 0, h: 0 }, err('IHDR', 8));
  });
  it('compression, filter and interlace are judged on their own bytes', () => {
    expectBoth({ comp: 1 }, err('IHDR', 8));
    expectBoth({ filter: 1 }, err('IHDR', 8));
    expectBoth({ interlace: 2 }, err('IHDR', 8));
    expectBoth({ interlace: 255 }, err('IHDR', 8));
    expectBoth({ comp: 255 }, err('IHDR', 8));
    expectBoth({ filter: 255 }, err('IHDR', 8));
  });
  it('interlace 0 and 1 are accepted by readPngInfo and carried through', () => {
    expect(readPngInfo(png(IHDR({ interlace: 0 }))).interlace).toBe(0);
    expect(readPngInfo(png(IHDR({ interlace: 1 }))).interlace).toBe(1);
    expect(validatePng(minimal({ interlace: 1 })).interlace).toBe(1);
  });
  it('the (colour type, bit depth) table is exactly the card', () => {
    const legal = new Set(['0:1', '0:2', '0:4', '0:8', '0:16', '2:8', '2:16', '3:1', '3:2', '3:4', '3:8', '4:8', '4:16', '6:8', '6:16']);
    for (const color of [0, 1, 2, 3, 4, 5, 6, 7, 255]) {
      for (const depth of [0, 1, 2, 3, 4, 8, 15, 16, 32, 255]) {
        const expected = legal.has(`${color}:${depth}`) ? 'ok' : err('IHDR', 8);
        expect({ color, depth, result: outcome(() => readPngInfo(png(IHDR({ color, depth })))) }).toEqual({ color, depth, result: expected });
      }
    }
  });
  it('width and height limits sit exactly at 16384, and the pixel limit at 134,217,728', () => {
    const at = (w: number, h: number): Outcome => outcome(() => readPngInfo(png(IHDR({ w, h }))));
    expect(at(16384, 1)).toBe('ok');
    expect(at(1, 16384)).toBe('ok');
    expect(at(16385, 1)).toEqual(err('LIMIT', 8));
    expect(at(1, 16385)).toEqual(err('LIMIT', 8));
    expect(at(0xffffffff, 1)).toEqual(err('LIMIT', 8));
    expect(at(16384, 8192)).toBe('ok');
    expect(at(8192, 16384)).toBe('ok');
    expect(at(16384, 8193)).toEqual(err('LIMIT', 8));
    expect(at(8193, 16384)).toEqual(err('LIMIT', 8));
    expect(at(16384, 16384)).toEqual(err('LIMIT', 8));
    expect(PNG_LIMITS).toEqual({ maxDimension: 16384, maxPixels: 134_217_728, maxChunks: 100_000 });
  });
  it('zero is judged before the limits and the limits after the pair check', () => {
    expect(outcome(() => readPngInfo(png(IHDR({ w: 0, h: 99999 }))))).toEqual(err('IHDR', 8));
    expect(outcome(() => readPngInfo(png(IHDR({ w: 99999, depth: 3 }))))).toEqual(err('IHDR', 8));
    expect(outcome(() => readPngInfo(png(IHDR({ w: 99999, interlace: 2 }))))).toEqual(err('IHDR', 8));
  });
  it('validatePng reports the same defects at the start of the IHDR chunk, and honours custom limits exactly', () => {
    expect(outcome(() => validatePng(minimal({ w: 10, h: 5 }), { maxDimension: 10, maxPixels: 50 }))).toBe('ok');
    expect(outcome(() => validatePng(minimal({ w: 11, h: 1 }), { maxDimension: 10, maxPixels: 50 }))).toEqual(err('LIMIT', 8));
    expect(outcome(() => validatePng(minimal({ w: 1, h: 11 }), { maxDimension: 10, maxPixels: 50 }))).toEqual(err('LIMIT', 8));
    expect(outcome(() => validatePng(minimal({ w: 10, h: 6 }), { maxDimension: 10, maxPixels: 50 }))).toEqual(err('LIMIT', 8));
    expect(outcome(() => validatePng(minimal({ w: 7, h: 7 }), { maxPixels: 49 }))).toBe('ok');
    expect(outcome(() => validatePng(minimal({ w: 7, h: 7 }), { maxPixels: 48 }))).toEqual(err('LIMIT', 8));
    expect(outcome(() => validatePng(minimal({ w: 20, h: 1 }), { maxDimension: 20 }))).toBe('ok');
    expect(outcome(() => validatePng(minimal({ w: 21, h: 1 }), { maxDimension: 20 }))).toEqual(err('LIMIT', 8));
    // Default limits are used for the fields that are left out.
    expect(outcome(() => validatePng(minimal({ w: 16385, h: 1 }), { maxPixels: 1e9 }))).toEqual(err('LIMIT', 8));
  });
});

describe('exact-length edges: the smallest inputs that reach a check', () => {
  const letters = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  /** Signature plus exactly eight header bytes: 16 bytes. */
  const sixteen = (length: number, type: number[]): Uint8Array => png(cat(be32(length), Uint8Array.from(type)));

  it('eight bytes that are not a signature are SIGNATURE at 0; seven bytes are TRUNCATED at 7', () => {
    for (const bytes of [new Uint8Array(8), Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 11), Uint8Array.of(136, 80, 78, 71, 13, 10, 26, 10), Uint8Array.of(137, 80, 78, 71, 13, 10, 27, 10)]) {
      expect(outcome(() => validatePng(bytes))).toEqual(err('SIGNATURE', 0));
      expect(outcome(() => readPngInfo(bytes))).toEqual(err('SIGNATURE', 0));
    }
    expect(outcome(() => validatePng(SIG.subarray(0, 7)))).toEqual(err('TRUNCATED', 7));
    expect(outcome(() => readPngInfo(SIG.subarray(0, 7)))).toEqual(err('TRUNCATED', 7));
  });
  it('sixteen bytes: a header that is bad on its own is reported as such, a good-looking one is truncated', () => {
    const bad: Array<[string, Uint8Array]> = [
      ['a length above 0x7fffffff', sixteen(0x80000000, letters('IHDR'))],
      ['a length of 0xffffffff', sixteen(0xffffffff, letters('IHDR'))],
      ['a type with a digit', sixteen(13, letters('IHD1'))],
      ['a type with a space', sixteen(13, [73, 72, 68, 32])],
    ];
    for (const [name, bytes] of bad) {
      expect(bytes.length).toBe(16);
      expect({ name, validate: outcome(() => validatePng(bytes)), info: outcome(() => readPngInfo(bytes)) }).toEqual({
        name,
        validate: err('CHUNK', 8),
        info: err('CHUNK', 8),
      });
    }
    // Looks fine but names no IHDR of length 13: readPngInfo can tell at once, validatePng has to see the whole chunk first.
    expect(outcome(() => readPngInfo(sixteen(13, letters('IDAT'))))).toEqual(err('IHDR', 8));
    expect(outcome(() => validatePng(sixteen(13, letters('IDAT'))))).toEqual(err('TRUNCATED', 16));
    expect(outcome(() => readPngInfo(sixteen(5, letters('IHDR'))))).toEqual(err('IHDR', 8));
    expect(outcome(() => validatePng(sixteen(5, letters('IHDR'))))).toEqual(err('TRUNCATED', 16));
    expect(outcome(() => readPngInfo(sixteen(13, letters('IHDR'))))).toEqual(err('TRUNCATED', 16));
    expect(outcome(() => validatePng(sixteen(13, letters('IHDR'))))).toEqual(err('TRUNCATED', 16));
  });
  it('exactly eight bytes where the next chunk header should start: a bad header is CHUNK there, a good one is truncated', () => {
    const base = png(IHDR());
    expect(base.length).toBe(33);
    const eight = (length: number, type: number[]): Uint8Array => cat(base, be32(length), Uint8Array.from(type));
    expect(outcome(() => validatePng(cat(base, new Uint8Array(8).fill(0xff))))).toEqual(err('CHUNK', 33));
    expect(outcome(() => validatePng(cat(base, new Uint8Array(9).fill(0xff))))).toEqual(err('CHUNK', 33));
    expect(outcome(() => validatePng(eight(0, letters('tEX1'))))).toEqual(err('CHUNK', 33));
    expect(outcome(() => validatePng(eight(0x80000000, letters('tEXt'))))).toEqual(err('CHUNK', 33));
    expect(outcome(() => validatePng(eight(0, letters('tEXt'))))).toEqual(err('TRUNCATED', 41));
    expect(outcome(() => validatePng(eight(1, letters('tEXt'))))).toEqual(err('TRUNCATED', 41));
  });
});

describe('chunk type letters', () => {
  const withType = (type: number[]): Uint8Array => png(IHDR(), chunk(type, [1, 2, 3]), IDAT(), IEND());
  const letters = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const ihdrEnd = 8 + 25;
  it('every ASCII letter class is a valid type: A, Z, a, z at every position', () => {
    for (const t of ['AAAA', 'ZZZZ', 'aaaa', 'zzzz', 'AZaz', 'zaZA', 'tEXt', 'zTXt']) {
      expect({ t, result: outcome(() => validatePng(withType(letters(t)))) }).toEqual({ t, result: 'ok' });
    }
  });
  it('the characters just outside the letter ranges are CHUNK at the chunk start, at every position', () => {
    // '@' (64) and '[' (91) bracket A-Z; '`' (96) and '{' (123) bracket a-z; also a digit, a space, NUL, DEL and 0xC1.
    for (const bad of [64, 91, 96, 123, 48, 32, 0, 127, 0xc1, 255]) {
      for (let pos = 0; pos < 4; pos++) {
        const type = letters('tEXt');
        type[pos] = bad;
        expect({ bad, pos, result: outcome(() => validatePng(withType(type))) }).toEqual({ bad, pos, result: err('CHUNK', ihdrEnd) });
      }
    }
  });
  it('the same boundaries hold for the first chunk of readPngInfo (reported at 8)', () => {
    for (const bad of [64, 91, 96, 123, 48, 32, 0]) {
      for (let pos = 0; pos < 4; pos++) {
        const type = letters('IHDR');
        type[pos] = bad;
        expect({ bad, pos, result: outcome(() => readPngInfo(png(chunk(type, ihdrData())))) }).toEqual({ bad, pos, result: err('CHUNK', 8) });
      }
    }
    // Four valid letters that do not spell IHDR reach the IHDR check, not the letter check.
    expect(outcome(() => readPngInfo(png(chunk('AAAA', ihdrData()))))).toEqual(err('IHDR', 8));
    expect(outcome(() => readPngInfo(png(chunk('zzzz', ihdrData()))))).toEqual(err('IHDR', 8));
  });
});

describe('chunk structure: ordering rules and offsets', () => {
  const ihdrEnd = 33; // 8 + 25
  const idatEnd = ihdrEnd + 15; // IDAT(3) = 15 bytes
  const iendEnd = idatEnd + 12;

  it('a minimal PNG reports its counts', () => {
    expect(validatePng(minimal({ w: 5, h: 6 }))).toEqual({ width: 5, height: 6, bitDepth: 8, colorType: 6, interlace: 0, idatBytes: 3, chunkCount: 3 });
  });
  it('several IDAT chunks (one empty) and a leading ancillary chunk are counted', () => {
    const bytes = png(IHDR({ color: 2, depth: 16, interlace: 1 }), chunk('tEXt', [65, 0, 66]), chunk('IDAT', [1, 2, 3]), chunk('IDAT', [4, 5, 6, 7, 8]), chunk('IDAT', []), IEND());
    expect(validatePng(bytes)).toEqual({ width: 2, height: 2, bitDepth: 16, colorType: 2, interlace: 1, idatBytes: 8, chunkCount: 6 });
  });
  it('missing IEND is CHUNK at the end of the input; missing IDAT is CHUNK at the end of IEND', () => {
    expect(outcome(() => validatePng(png(IHDR(), IDAT())))).toEqual(err('CHUNK', idatEnd));
    expect(outcome(() => validatePng(png(IHDR(), IEND())))).toEqual(err('CHUNK', iendEnd - 15));
  });
  it('IEND must be empty; a second IEND is CHUNK at the second chunk', () => {
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), chunk('IEND', [0]))))).toEqual(err('CHUNK', idatEnd));
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IEND(), IEND())))).toEqual(err('CHUNK', iendEnd));
  });
  it('a chunk after IEND makes IEND "not last", reported at that chunk', () => {
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IEND(), chunk('tEXt', [1]))))).toEqual(err('CHUNK', iendEnd));
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IEND(), IDAT())))).toEqual(err('CHUNK', iendEnd));
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IEND(), chunk('tEXt', [1]), IDAT())))).toEqual(err('CHUNK', iendEnd));
  });
  it('fewer than 8 bytes after IEND are TRAILING at the end of IEND; so is a chunk that claims more than remains', () => {
    for (const n of [1, 4, 7]) {
      expect({ n, result: outcome(() => validatePng(cat(png(IHDR(), IDAT(), IEND()), new Uint8Array(n)))) }).toEqual({ n, result: err('TRAILING', iendEnd) });
    }
    const claimsMore = cat(png(IHDR(), IDAT(), IEND()), be32(100), Uint8Array.from([116, 69, 88, 116, 1, 2]));
    expect(outcome(() => validatePng(claimsMore))).toEqual(err('TRAILING', iendEnd));
  });
  it('bytes after IEND that do not form a chunk are TRAILING at the end of IEND (card N5: any byte after its CRC)', () => {
    const garbage: Array<[string, Uint8Array]> = [
      ['8 zero bytes', new Uint8Array(8)],
      ['40 bytes of 0xff', new Uint8Array(40).fill(0xff)],
      ['33 mixed bytes', Uint8Array.from({ length: 33 }, (_, i) => (i * 7) & 255)],
      ['a length above 0x7fffffff with four letters', cat(be32(0x80000000), Uint8Array.from([116, 69, 88, 116]))],
      ['a length of 0xffffffff with four letters', cat(be32(0xffffffff), Uint8Array.from([116, 69, 88, 116]))],
      ['a valid length and a type with a digit', cat(be32(0), Uint8Array.from([116, 69, 88, 49]))],
      ['a valid length and a type with a space', cat(be32(0), Uint8Array.from([116, 69, 88, 32]))],
      ['a valid length and a type that starts with NUL', cat(be32(0), Uint8Array.from([0, 69, 88, 116]))],
    ];
    for (const [name, bytes] of garbage) {
      expect({ name, result: outcome(() => validatePng(cat(png(IHDR(), IDAT(), IEND()), bytes))) }).toEqual({ name, result: err('TRAILING', iendEnd) });
    }
  });
  it('a well-formed chunk after IEND keeps its own codes: CHUNK when its CRC is right, CRC when it is wrong', () => {
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IEND(), chunk('tEXt', [1, 2, 3]))))).toEqual(err('CHUNK', iendEnd));
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IEND(), chunk('tEXt', [1, 2, 3], { crc: 0 }))))).toEqual(err('CRC', iendEnd));
  });
  it('IDAT chunks must be consecutive: another chunk between two is CHUNK at the second IDAT', () => {
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), chunk('tEXt', [1]), IDAT(), IEND())))).toEqual(err('CHUNK', idatEnd + 13));
    expect(outcome(() => validatePng(png(IHDR(), IDAT(), IDAT(), chunk('tEXt', [1]), IEND())))).toBe('ok');
    expect(outcome(() => validatePng(png(IHDR(), chunk('tEXt', [1]), IDAT(), IDAT(), IEND())))).toBe('ok');
  });
  it('a second IHDR is CHUNK at that chunk', () => {
    expect(outcome(() => validatePng(png(IHDR(), IHDR(), IDAT(), IEND())))).toEqual(err('CHUNK', ihdrEnd));
  });
  it('the first chunk must be an IHDR of length 13: reported at 8', () => {
    expect(outcome(() => validatePng(png(IDAT(), IEND())))).toEqual(err('IHDR', 8));
    expect(outcome(() => validatePng(png(chunk('IHDR', new Uint8Array(12)), IDAT(), IEND())))).toEqual(err('IHDR', 8));
    expect(outcome(() => validatePng(png(chunk('IHDR', new Uint8Array(14)), IDAT(), IEND())))).toEqual(err('IHDR', 8));
  });
  it('PLTE: required before IDAT for colour type 3, forbidden for 0 and 4, optional for 2 and 6', () => {
    expect(outcome(() => validatePng(png(IHDR({ color: 3, depth: 8 }), IDAT(), IEND())))).toEqual(err('CHUNK', ihdrEnd));
    expect(outcome(() => validatePng(png(IHDR({ color: 3, depth: 8 }), PLTE(), IDAT(), IEND())))).toBe('ok');
    expect(outcome(() => validatePng(png(IHDR({ color: 3, depth: 8 }), IDAT(), PLTE(), IEND())))).toEqual(err('CHUNK', idatEnd));
    for (const color of [0, 4]) {
      expect(outcome(() => validatePng(png(IHDR({ color, depth: 8 }), PLTE(), IDAT(), IEND())))).toEqual(err('CHUNK', ihdrEnd));
      expect(outcome(() => validatePng(png(IHDR({ color, depth: 8 }), IDAT(), IEND())))).toBe('ok');
    }
    for (const color of [2, 6]) {
      expect(outcome(() => validatePng(png(IHDR({ color, depth: 8 }), PLTE(), IDAT(), IEND())))).toBe('ok');
      expect(outcome(() => validatePng(png(IHDR({ color, depth: 8 }), IDAT(), IEND())))).toBe('ok');
    }
  });
});

describe('chunk framing: truncation, CRC, lengths, count', () => {
  const ihdrEnd = 33;
  const idatEnd = ihdrEnd + 15;
  it('fewer than 8 bytes left where a chunk header should start is TRUNCATED at the end of the input', () => {
    for (const n of [1, 4, 7]) {
      const bytes = cat(png(IHDR()), new Uint8Array(n));
      expect({ n, result: outcome(() => validatePng(bytes)) }).toEqual({ n, result: err('TRUNCATED', bytes.length) });
    }
  });
  it('a chunk that claims more bytes than remain is TRUNCATED at the end of the input; exactly enough parses', () => {
    const claims = cat(png(IHDR()), be32(100), Uint8Array.from([73, 68, 65, 84, 1, 2, 3]));
    expect(outcome(() => validatePng(claims))).toEqual(err('TRUNCATED', claims.length));
    const exact = png(IHDR(), IDAT(), IEND());
    for (let cut = exact.length - 1; cut > idatEnd; cut--) {
      const result = outcome(() => validatePng(exact.subarray(0, cut)));
      expect(result).not.toBe('ok');
      expect(['TRUNCATED', 'CHUNK']).toContain((result as { code: string }).code);
    }
    expect(outcome(() => validatePng(exact))).toBe('ok');
  });
  it('a chunk length above 0x7fffffff is CHUNK at the chunk start; 0x7fffffff that does not fit is TRUNCATED', () => {
    expect(outcome(() => validatePng(png(IHDR(), chunk('IDAT', [1], { length: 0x80000000 }), IEND())))).toEqual(err('CHUNK', ihdrEnd));
    expect(outcome(() => validatePng(png(IHDR(), chunk('IDAT', [1], { length: 0xffffffff }), IEND())))).toEqual(err('CHUNK', ihdrEnd));
    const huge = png(IHDR(), chunk('IDAT', [1, 2, 3], { length: 0x7fffffff }));
    expect(outcome(() => validatePng(huge))).toEqual(err('TRUNCATED', huge.length));
  });
  it('a CRC error in any chunk is CRC at that chunk start, whichever byte is flipped (type, data or CRC)', () => {
    const good = png(IHDR(), IDAT(), IEND());
    const idatStart = idatEnd - 15;
    for (let i = idatStart + 4; i < idatEnd; i++) {
      const bad = good.slice();
      // A type byte flips case (still a letter, so the framing accepts it and the CRC catches it); other bytes flip a bit.
      bad[i] ^= i < idatStart + 8 ? 0x20 : 0x01;
      expect({ i, result: outcome(() => validatePng(bad)) }).toEqual({ i, result: err('CRC', ihdrEnd) });
    }
    // The IEND CRC.
    const badEnd = good.slice();
    badEnd[good.length - 1] ^= 0x01;
    expect(outcome(() => validatePng(badEnd))).toEqual(err('CRC', idatEnd));
    // The IHDR CRC.
    const badHeader = good.slice();
    badHeader[8 + 25 - 1] ^= 0x01;
    expect(outcome(() => validatePng(badHeader))).toEqual(err('CRC', 8));
  });
  it('the chunk count limit is exact: 5 chunks pass a limit of 5, 6 do not', () => {
    const five = png(IHDR(), IDAT(), IDAT(), IDAT(), IEND());
    expect(outcome(() => validatePng(five, { maxChunks: 5 }))).toBe('ok');
    expect(outcome(() => validatePng(five, { maxChunks: 4 }))).toEqual(err('LIMIT', 8 + 25 + 15 * 3));
    const six = png(IHDR(), IDAT(), IDAT(), IDAT(), IDAT(), IEND());
    expect(outcome(() => validatePng(six, { maxChunks: 5 }))).toEqual(err('LIMIT', 8 + 25 + 15 * 4));
    expect(outcome(() => validatePng(six, { maxChunks: 6 }))).toBe('ok');
  });
  it('the chunk count is judged before the CRC of the chunk that crosses the limit', () => {
    const bad = png(IHDR(), IDAT(), chunk('IDAT', [1], { crc: 0 }), IEND());
    expect(outcome(() => validatePng(bad, { maxChunks: 2 }))).toEqual(err('LIMIT', idatEnd));
    expect(outcome(() => validatePng(bad, { maxChunks: 3 }))).toEqual(err('CRC', idatEnd));
  });
});
