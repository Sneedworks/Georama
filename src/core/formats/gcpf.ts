/**
 * Godot 3.0 GCPF / FastLZ-1. Ports of core/io/file_access_compressed.cpp,
 * core/io/compression.cpp and thirdparty/misc/fastlz.c from:
 * https://github.com/godotengine/godot/tree/3.0
 *
 * Copyright (C) 2005-2007 Ariya Hidayat (ariya@kde.org)
 * Copyright (c) 2007-2019 Juan Linietsky, Ariel Manzur.
 * Copyright (c) 2014-2019 Godot Engine contributors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

export type GcpfErrorCode = 'MAGIC' | 'MODE' | 'HEADER' | 'TRUNCATED' | 'LIMIT' | 'BLOCK' | 'FASTLZ';

export class GcpfError extends Error {
  readonly code: GcpfErrorCode;
  readonly offset: number | undefined;

  constructor(code: GcpfErrorCode, message: string, offset?: number) {
    super(message);
    this.name = 'GcpfError';
    this.code = code;
    this.offset = offset;
  }
}

export interface GcpfLimits {
  maxTotalSize?: number;
  maxBlockSize?: number;
}

export interface GcpfHeader {
  mode: 0;
  blockSize: number;
  totalSize: number;
  blockCount: number;
  compressedSizes: Uint32Array;
  /** Absolute offsets relative to the supplied file view, not its backing buffer. */
  blockOffsets: number[];
  dataEnd: number;
}

export interface GcpfDecoded {
  payload: Uint8Array;
  header: GcpfHeader;
  footerOk: boolean;
  /** Includes the footer itself, if present. */
  trailingBytes: number;
}

const UINT32_MAX = 0xffffffff;
const MAGIC = [71, 67, 80, 70];
const HASH_SIZE = 8192;

function integer(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

function bytes(value: Uint8Array, code: GcpfErrorCode): void {
  if (!(value instanceof Uint8Array)) throw new GcpfError(code, 'Expected Uint8Array');
}

function allocate(length: number): Uint8Array<ArrayBuffer> {
  try { return new Uint8Array(length); }
  catch { throw new GcpfError('LIMIT', `Cannot allocate ${length} bytes`); }
}

function hasMagic(file: Uint8Array, offset: number): boolean {
  return file[offset] === 71 && file[offset + 1] === 67 && file[offset + 2] === 80 && file[offset + 3] === 70;
}

export function readGcpfHeader(file: Uint8Array, limits: GcpfLimits = {}): GcpfHeader {
  bytes(file, 'HEADER');
  if (file.length < 16) throw new GcpfError('TRUNCATED', 'GCPF header needs 16 bytes', file.length);
  if (!hasMagic(file, 0)) throw new GcpfError('MAGIC', 'Expected GCPF magic', 0);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint32(4, true) !== 0) throw new GcpfError('MODE', 'Only FastLZ mode 0 is supported', 4);
  const blockSize = view.getUint32(8, true);
  const maxBlockSize = limits.maxBlockSize ?? (1 << 24);
  if (!integer(maxBlockSize) || maxBlockSize > UINT32_MAX || blockSize === 0 || blockSize > maxBlockSize) {
    throw new GcpfError('HEADER', 'Invalid block size or maxBlockSize', 8);
  }
  const totalSize = view.getUint32(12, true);
  const maxTotalSize = limits.maxTotalSize ?? 2_147_483_647;
  if (!integer(maxTotalSize) || maxTotalSize > UINT32_MAX || totalSize > maxTotalSize) {
    throw new GcpfError('LIMIT', 'Total size exceeds maxTotalSize or limit is invalid', 12);
  }
  const blockCount = Math.floor(totalSize / blockSize) + 1;
  let offset = 16 + 4 * blockCount;
  // At most 2^32 entries, so this arithmetic is exact. Check before allocating.
  if (offset > file.length) throw new GcpfError('TRUNCATED', 'Truncated compressed-size table', 16);
  let compressedSizes: Uint32Array;
  let blockOffsets: number[];
  try {
    compressedSizes = new Uint32Array(blockCount);
    blockOffsets = new Array<number>(blockCount);
  } catch { throw new GcpfError('LIMIT', 'Cannot allocate the validated block table', 16); }
  for (let i = 0; i < blockCount; i++) {
    const size = view.getUint32(16 + 4 * i, true);
    const expected = i === blockCount - 1 ? totalSize - blockSize * i : blockSize;
    if (size > file.length - offset) throw new GcpfError('TRUNCATED', `Block ${i} extends past input at ${offset}`, offset);
    if ((size === 0 && expected > 0) || expected > 88 * size) {
      throw new GcpfError('BLOCK', `Block ${i} at ${offset} exceeds the FastLZ-1 expansion bound`, offset);
    }
    compressedSizes[i] = size;
    blockOffsets[i] = offset;
    offset += size;
  }
  return { mode: 0, blockSize, totalSize, blockCount, compressedSizes, blockOffsets, dataEnd: offset };
}

export function decodeGcpf(file: Uint8Array, limits?: GcpfLimits): GcpfDecoded {
  const header = readGcpfHeader(file, limits);
  // The complete table and every block's 88:1 bound have now been checked.
  const payload = allocate(header.totalSize);
  let scratch: Uint8Array | undefined;
  for (let i = 0; i < header.blockCount; i++) {
    const start = i * header.blockSize;
    const expected = i === header.blockCount - 1 ? header.totalSize - start : header.blockSize;
    const offset = header.blockOffsets[i];
    if (expected === 0) continue;
    const padded = expected < 16;
    if (padded && !scratch) scratch = allocate(16);
    const target = padded ? scratch! : payload;
    const count = fastlzDecompress(file, offset, offset + header.compressedSizes[i], target, padded ? 0 : start, padded ? 16 : expected);
    if (count !== (padded ? 16 : expected)) {
      throw new GcpfError('BLOCK', `Block ${i} at ${offset}: decoded ${count}, expected ${padded ? 16 : expected}`, offset);
    }
    if (padded) payload.set(target.subarray(0, expected), start);
  }
  return { payload, header, footerOk: hasMagic(file, header.dataEnd), trailingBytes: file.length - header.dataEnd };
}

/** Decode one independent level-1 stream; all limits are relative to the supplied views. */
export function fastlzDecompress(src: Uint8Array, srcStart: number, srcEnd: number, dst: Uint8Array, dstStart: number, maxOut: number): number {
  bytes(src, 'FASTLZ');
  bytes(dst, 'FASTLZ');
  if (!integer(srcStart) || !integer(srcEnd) || srcStart >= srcEnd || srcEnd > src.length
    || !integer(dstStart) || dstStart > dst.length || !integer(maxOut) || maxOut > dst.length - dstStart) {
    throw new GcpfError('FASTLZ', 'Invalid FastLZ source/destination range', srcStart);
  }
  let ip = srcStart;
  let op = dstStart;
  const opLimit = dstStart + maxOut;
  if ((src[ip] >>> 5) !== 0) throw new GcpfError('FASTLZ', 'Only FastLZ level 1 is supported', ip);
  let ctrl = src[ip++] & 31;
  for (;;) {
    const instruction = ip - 1;
    if (ctrl >= 32) {
      let len = (ctrl >>> 5) - 1;
      if (len === 6) {
        if (ip >= srcEnd) throw new GcpfError('FASTLZ', 'Truncated extended length', ip);
        len += src[ip++];
      }
      if (ip >= srcEnd) throw new GcpfError('FASTLZ', 'Truncated match distance', ip);
      let ref = op - ((ctrl & 31) << 8) - src[ip++] - 1;
      const count = len + 3;
      if (count > opLimit - op) throw new GcpfError('FASTLZ', 'Match exceeds output limit', instruction);
      if (ref < dstStart) throw new GcpfError('FASTLZ', 'Back-reference before block start', instruction);
      if (ref === op - 1) {
        const value = dst[ref];
        for (let k = 0; k < count; k++) dst[op++] = value;
      } else {
        // Byte-wise copying is essential: references can overlap their output.
        for (let k = 0; k < count; k++) dst[op++] = dst[ref++];
      }
    } else {
      const count = ctrl + 1;
      if (count > srcEnd - ip) throw new GcpfError('FASTLZ', 'Literal exceeds input limit', instruction);
      if (count > opLimit - op) throw new GcpfError('FASTLZ', 'Literal exceeds output limit', instruction);
      for (let k = 0; k < count; k++) dst[op++] = src[ip++];
    }
    if (ip === srcEnd) return op - dstStart;
    ctrl = src[ip++];
  }
}

export function fastlzMaxCompressedSize(n: number): number {
  if (!integer(n) || n > UINT32_MAX) throw new GcpfError('LIMIT', 'Invalid FastLZ input length');
  return Math.max(66, n + Math.floor(n * 6 / 100));
}

function hash(src: Uint8Array, ip: number): number {
  const value = src[ip] | (src[ip + 1] << 8);
  return (value ^ (src[ip + 1] | (src[ip + 2] << 8)) ^ (value >>> 3)) & (HASH_SIZE - 1);
}

/**
 * Faithful fastlz1_compress port. The caller supplies worst-case destination
 * capacity. Table entries are block-relative, allowing source views/offsets.
 */
function compressInto(src: Uint8Array, srcStart: number, length: number, dst: Uint8Array, dstStart: number, table: Uint32Array): number {
  let ip = srcStart;
  const ipBound = srcStart + length - 2;
  const ipLimit = srcStart + length - 12;
  let op = dstStart;
  if (length < 4) {
    if (length === 0) return 0;
    dst[op++] = length - 1;
    for (let i = 0; i < length; i++) dst[op++] = src[ip++];
    return op - dstStart;
  }
  table.fill(0);
  let copy = 2;
  dst[op++] = 31;
  dst[op++] = src[ip++];
  dst[op++] = src[ip++];
  while (ip < ipLimit) {
    const anchor = ip;
    const slot = hash(src, ip);
    let ref = srcStart + table[slot];
    let distance = anchor - ref;
    table[slot] = anchor - srcStart;
    if (distance === 0 || distance >= 8192 || src[ref++] !== src[ip++] || src[ref++] !== src[ip++] || src[ref++] !== src[ip++]) {
      // Rewind after the short-circuit comparison, exactly as Godot's literal label.
      dst[op++] = src[anchor];
      ip = anchor + 1;
      if (++copy === 32) { copy = 0; dst[op++] = 31; }
      continue;
    }
    ip = anchor + 3;
    distance--;
    if (distance === 0) {
      const value = src[ip - 1];
      while (ip < ipBound) {
        if (src[ref++] !== value) break;
        ip++;
      }
    } else {
      // The first eight comparisons are deliberately unconditional (ip_limit
      // reserves twelve bytes). Their post-increments, even on mismatch, matter.
      for (let k = 0; k < 8; k++) {
        if (src[ref++] !== src[ip++]) break;
        if (k === 7) {
          while (ip < ipBound) { if (src[ref++] !== src[ip++]) break; }
        }
      }
    }
    if (copy !== 0) dst[op - copy - 1] = copy - 1;
    else op--;
    copy = 0;
    ip -= 3;
    let len = ip - anchor;
    while (len > 262) {
      dst[op++] = 0xe0 + (distance >>> 8);
      dst[op++] = 253;
      dst[op++] = distance & 255;
      len -= 262;
    }
    if (len < 7) {
      dst[op++] = (len << 5) + (distance >>> 8);
      dst[op++] = distance & 255;
    } else {
      dst[op++] = 0xe0 + (distance >>> 8);
      dst[op++] = len - 7;
      dst[op++] = distance & 255;
    }
    table[hash(src, ip)] = ip - srcStart; ip++;
    table[hash(src, ip)] = ip - srcStart; ip++;
    dst[op++] = 31;
  }
  while (ip <= ipBound + 1) {
    dst[op++] = src[ip++];
    if (++copy === 32) { copy = 0; dst[op++] = 31; }
  }
  if (copy !== 0) dst[op - copy - 1] = copy - 1;
  else op--;
  return op - dstStart;
}

export function fastlzCompress(src: Uint8Array, srcStart: number, length: number, dst: Uint8Array, dstStart: number): number {
  bytes(src, 'FASTLZ');
  bytes(dst, 'FASTLZ');
  if (!integer(srcStart) || srcStart > src.length || !integer(length) || length > UINT32_MAX || length > src.length - srcStart
    || !integer(dstStart) || dstStart > dst.length) {
    throw new GcpfError('FASTLZ', 'Invalid FastLZ source/destination range', srcStart);
  }
  if (length === 0) return 0;
  const bound = fastlzMaxCompressedSize(length);
  const room = dst.length - dstStart;
  // With a smaller destination, compress into bounded scratch first, so a typed
  // array's silently ignored out-of-bounds writes cannot corrupt the result.
  const target = room >= bound ? dst : allocate(bound);
  const start = room >= bound ? dstStart : 0;
  let table: Uint32Array;
  try { table = new Uint32Array(HASH_SIZE); }
  catch { throw new GcpfError('LIMIT', 'Cannot allocate FastLZ hash table'); }
  const count = compressInto(src, srcStart, length, target, start, table);
  if (count > room) throw new GcpfError('FASTLZ', 'Compressed output exceeds destination', dstStart);
  if (target !== dst) dst.set(target.subarray(0, count), dstStart);
  return count;
}

export function encodeGcpf(payload: Uint8Array, opts: { blockSize?: number } = {}): Uint8Array {
  bytes(payload, 'HEADER');
  const blockSize = opts.blockSize ?? 4096;
  if (!integer(blockSize) || blockSize < 16 || blockSize > 65535) throw new GcpfError('HEADER', 'Encoder blockSize must be in [16, 65535]');
  const totalSize = payload.length;
  if (totalSize >= 2 ** 32) throw new GcpfError('LIMIT', 'GCPF totalSize must fit in u32');
  const fullBlocks = Math.floor(totalSize / blockSize);
  const blockCount = fullBlocks + 1;
  const lastSize = totalSize % blockSize;
  const tableEnd = 16 + 4 * blockCount;
  const capacity = tableEnd + fullBlocks * fastlzMaxCompressedSize(blockSize) + fastlzMaxCompressedSize(Math.max(16, lastSize)) + 4;
  const output = allocate(capacity);
  output.set(MAGIC);
  const view = new DataView(output.buffer);
  view.setUint32(4, 0, true);
  view.setUint32(8, blockSize, true);
  view.setUint32(12, totalSize, true);
  let table: Uint32Array;
  try { table = new Uint32Array(HASH_SIZE); }
  catch { throw new GcpfError('LIMIT', 'Cannot allocate FastLZ hash table'); }
  const padded = allocate(16);
  let offset = tableEnd;
  for (let i = 0; i < blockCount; i++) {
    const length = i === fullBlocks ? lastSize : blockSize;
    let count: number;
    if (length < 16) {
      padded.fill(0);
      for (let k = 0; k < length; k++) padded[k] = payload[i * blockSize + k];
      count = compressInto(padded, 0, 16, output, offset, table);
    } else {
      count = compressInto(payload, i * blockSize, length, output, offset, table);
    }
    view.setUint32(16 + 4 * i, count, true);
    offset += count;
  }
  output.set(MAGIC, offset);
  // Only one full compressed-output copy; the returned buffer is transferable.
  try { return output.slice(0, offset + 4); }
  catch { throw new GcpfError('LIMIT', 'Cannot allocate exact compressed output'); }
}
