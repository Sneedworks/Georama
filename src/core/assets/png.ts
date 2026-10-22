export type PngErrorCode =
  | 'TRUNCATED'
  | 'SIGNATURE'
  | 'IHDR'
  | 'CHUNK'
  | 'CRC'
  | 'LIMIT'
  | 'TRAILING';

export class PngError extends Error {
  readonly code: PngErrorCode;
  readonly offset: number;

  constructor(code: PngErrorCode, message: string, offset: number) {
    super(message);
    this.name = 'PngError';
    this.code = code;
    this.offset = offset;
  }
}

export interface PngInfo {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
  readonly idatBytes: number;
  readonly chunkCount: number;
}

export const PNG_LIMITS: Readonly<{
  maxDimension: number;
  maxPixels: number;
  maxChunks: number;
}> = Object.freeze({
  maxDimension: 16384,
  maxPixels: 134_217_728,
  maxChunks: 100_000,
});

const TABLE: Uint32Array = buildTable();

function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

export function crc32(bytes: Uint8Array, start = 0, end?: number): number {
  // `end` has no default expression on purpose: a default of `bytes.length` would run before the argument check
  // below and let a TypeError escape for a null or undefined `bytes`.
  if (!(bytes instanceof Uint8Array)) throw new PngError('CHUNK', 'Expected Uint8Array', 0);
  const stop = end === undefined ? bytes.length : end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || start < 0 || stop < start || stop > bytes.length) {
    throw new PngError('CHUNK', 'Bad crc range', 0);
  }
  let crc = 0xffffffff;
  for (let i = start; i < stop; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function fail(code: PngErrorCode, message: string, offset: number): never {
  throw new PngError(code, message, offset);
}

function u32be(bytes: Uint8Array, pos: number): number {
  return ((bytes[pos] * 0x1000000 + (bytes[pos + 1] << 16) + (bytes[pos + 2] << 8) + bytes[pos + 3]) >>> 0);
}

function isLetter(byte: number): boolean {
  return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
}

function typeName(bytes: Uint8Array, pos: number): string {
  return String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
}

function checkSignature(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) fail('TRUNCATED', 'Expected Uint8Array', 0);
  if (bytes.length < 8) fail('TRUNCATED', `PNG signature needs 8 bytes, have ${bytes.length}`, bytes.length);
  if (
    bytes[0] !== 137 ||
    bytes[1] !== 80 ||
    bytes[2] !== 78 ||
    bytes[3] !== 71 ||
    bytes[4] !== 13 ||
    bytes[5] !== 10 ||
    bytes[6] !== 26 ||
    bytes[7] !== 10
  ) {
    fail('SIGNATURE', 'Bad PNG signature', 0);
  }
}

function pairOk(colorType: number, bitDepth: number): boolean {
  if (colorType === 0) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16;
  if (colorType === 2) return bitDepth === 8 || bitDepth === 16;
  if (colorType === 3) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
  if (colorType === 4) return bitDepth === 8 || bitDepth === 16;
  if (colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

function checkIhdrFields(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  compression: number,
  filter: number,
  interlace: number,
  at: number,
  limits: { maxDimension: number; maxPixels: number },
): void {
  if (width === 0 || height === 0) fail('IHDR', 'PNG width and height start at 1', at);
  if (!pairOk(colorType, bitDepth)) fail('IHDR', 'Bad colour type or bit depth', at);
  if (compression !== 0 || filter !== 0) fail('IHDR', 'Bad compression or filter method', at);
  if (interlace !== 0 && interlace !== 1) fail('IHDR', 'Bad interlace method', at);
  if (width > limits.maxDimension || height > limits.maxDimension) {
    fail('LIMIT', 'PNG dimension above the limit', at);
  }
  if (height > Math.floor(limits.maxPixels / width)) fail('LIMIT', 'PNG pixel count above the limit', at);
}

export function readPngInfo(bytes: Uint8Array): PngInfo {
  checkSignature(bytes);
  if (bytes.length < 16) fail('TRUNCATED', 'PNG first chunk header needs 8 bytes', bytes.length);
  const length = u32be(bytes, 8);
  if (length > 0x7fffffff) fail('CHUNK', 'Bad chunk length', 8);
  for (let k = 0; k < 4; k++) {
    if (!isLetter(bytes[12 + k])) fail('CHUNK', 'Bad chunk type', 8);
  }
  if (typeName(bytes, 12) !== 'IHDR') fail('IHDR', 'First chunk is not IHDR', 8);
  if (length !== 13) fail('IHDR', 'IHDR length is not 13', 8);
  if (bytes.length < 33) fail('TRUNCATED', 'IHDR needs 13 bytes plus CRC', bytes.length);
  if (crc32(bytes, 12, 29) !== u32be(bytes, 29)) fail('CRC', 'IHDR CRC mismatch', 8);
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  checkIhdrFields(width, height, bitDepth, colorType, bytes[26], bytes[27], bytes[28], 8, PNG_LIMITS);
  return { width, height, bitDepth, colorType, interlace: bytes[28], idatBytes: 0, chunkCount: 1 };
}

export function validatePng(bytes: Uint8Array, limits?: Partial<typeof PNG_LIMITS>): PngInfo {
  const effective = {
    maxDimension: limits?.maxDimension ?? PNG_LIMITS.maxDimension,
    maxPixels: limits?.maxPixels ?? PNG_LIMITS.maxPixels,
    maxChunks: limits?.maxChunks ?? PNG_LIMITS.maxChunks,
  };
  checkSignature(bytes);
  let pos = 8;
  let count = 0;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let seenIhdr = false;
  let idatCount = 0;
  let firstIdat = -1;
  let firstIdatStart = 0;
  let idatBytes = 0;
  let gapSinceIdat = false;
  let seenPlte = false;
  let plteStart = 0;
  let plteAfterIdat = false;
  let iendAt = -1;
  let iendEnd = 0;
  let afterIendStart = -1;
  while (pos < bytes.length) {
    if (bytes.length - pos < 8) {
      if (iendAt >= 0) fail('TRAILING', 'Trailing bytes after IEND', iendEnd);
      fail('TRUNCATED', 'Chunk header needs 8 bytes', bytes.length);
    }
    const start = pos;
    const length = u32be(bytes, pos);
    // After IEND, bytes that do not even form a chunk header are trailing bytes (card N5), not a malformed chunk.
    const framingCode: PngErrorCode = iendAt >= 0 ? 'TRAILING' : 'CHUNK';
    const framingAt = iendAt >= 0 ? iendEnd : start;
    if (length > 0x7fffffff) fail(framingCode, 'Bad chunk length', framingAt);
    for (let k = 0; k < 4; k++) {
      if (!isLetter(bytes[pos + 4 + k])) fail(framingCode, 'Bad chunk type', framingAt);
    }
    if (bytes.length - pos < 12 + length) {
      if (iendAt >= 0) fail('TRAILING', 'Trailing bytes after IEND', iendEnd);
      fail('TRUNCATED', 'Chunk runs past the input', bytes.length);
    }
    count += 1;
    if (count > effective.maxChunks) fail('LIMIT', 'Too many chunks', start);
    const name = typeName(bytes, pos + 4);
    if (crc32(bytes, pos + 4, pos + 8 + length) !== u32be(bytes, pos + 8 + length)) {
      fail('CRC', `CRC mismatch in ${name}`, start);
    }
    if (count === 1) {
      if (name !== 'IHDR') fail('IHDR', 'First chunk is not IHDR', start);
      if (length !== 13) fail('IHDR', 'IHDR length is not 13', start);
      width = u32be(bytes, pos + 8);
      height = u32be(bytes, pos + 12);
      bitDepth = bytes[pos + 16];
      colorType = bytes[pos + 17];
      interlace = bytes[pos + 20];
      checkIhdrFields(width, height, bitDepth, colorType, bytes[pos + 18], bytes[pos + 19], interlace, start, effective);
      seenIhdr = true;
    } else if (name === 'IHDR') {
      fail('CHUNK', 'Second IHDR', start);
    }
    if (name === 'PLTE') {
      seenPlte = true;
      plteStart = start;
      if (idatCount > 0) plteAfterIdat = true;
    }
    if (name === 'IDAT') {
      if (iendAt >= 0 && afterIendStart < 0) afterIendStart = start;
      if (gapSinceIdat && iendAt < 0) fail('CHUNK', 'IDAT chunks are not consecutive', start);
      idatCount += 1;
      if (firstIdat < 0) {
        firstIdat = count;
        firstIdatStart = start;
      }
      idatBytes += length;
      gapSinceIdat = false;
    } else if (name === 'IEND') {
      if (length !== 0) fail('CHUNK', 'IEND is not empty', start);
      if (iendAt >= 0) fail('CHUNK', 'Second IEND', start);
      iendAt = count;
      iendEnd = pos + 12;
    } else {
      if (iendAt >= 0 && afterIendStart < 0) afterIendStart = start;
      if (idatCount > 0 && iendAt < 0) gapSinceIdat = true;
    }
    pos += 12 + length;
  }
  if (!seenIhdr) fail('TRUNCATED', 'Missing IHDR', bytes.length);
  if (iendAt < 0) fail('CHUNK', 'Missing IEND', bytes.length);
  if (iendAt !== count) fail('CHUNK', 'IEND is not last', afterIendStart);
  if (idatCount === 0) fail('CHUNK', 'Missing IDAT', iendAt >= 0 ? iendEnd : bytes.length);
  if (colorType === 3) {
    if (!seenPlte || plteAfterIdat) fail('CHUNK', 'PLTE must come before IDAT', plteAfterIdat ? plteStart : firstIdatStart);
  }
  if ((colorType === 0 || colorType === 4) && seenPlte) fail('CHUNK', 'Unexpected PLTE', plteStart);
  return { width, height, bitDepth, colorType, interlace, idatBytes, chunkCount: count };
}
