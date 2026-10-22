import { crc32 as nodeCrc32, deflateSync } from 'node:zlib';
import type { ByteSource } from '../../src/core/assets/pck.ts';

/** One archive member: Godot path plus its exact bytes. */
export interface SyntheticPckEntry {
  path: string;
  data: Uint8Array;
}

/** `godot` defaults to [3, 0, 0]; `gapAfterIndex` defaults to 8. Paths are zero-padded to a multiple of 4 exactly like the real file (no NUL when already aligned) unless `paddingBytes` is false, which appends a bare NUL. */
export interface BuildPckOptions {
  godot?: [number, number, number];
  gapAfterIndex?: number;
  paddingBytes?: boolean;
}

/**
 * Build a GDPC v1 archive with the exact layout of the real file: 88-byte
 * header, index entries, gap bytes, then member data at absolute offsets.
 */
export function buildPck(entries: Array<SyntheticPckEntry>, opts: BuildPckOptions = {}): Uint8Array {
  const godot = opts.godot ?? [3, 0, 0];
  const gap = opts.gapAfterIndex ?? 8;
  const pad = opts.paddingBytes ?? true;
  const encoder = new TextEncoder();
  const pathBytes = entries.map((entry) => encoder.encode(entry.path));
  const pathLens = pathBytes.map((bytes) => {
    if (!pad) return bytes.length + 1;
    return bytes.length + ((4 - (bytes.length % 4)) % 4);
  });
  let indexSize = 0;
  for (const len of pathLens) indexSize += 4 + len + 8 + 8 + 16;
  const indexEnd = 88 + indexSize;
  let total = indexEnd + gap;
  for (const entry of entries) total += entry.data.length;
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  file[0] = 0x47;
  file[1] = 0x44;
  file[2] = 0x50;
  file[3] = 0x43;
  view.setUint32(4, 1, true);
  view.setUint32(8, godot[0], true);
  view.setUint32(12, godot[1], true);
  view.setUint32(16, godot[2], true);
  view.setUint32(84, entries.length, true);
  let pos = 88;
  let dataOffset = indexEnd + gap;
  for (let i = 0; i < entries.length; i++) {
    view.setUint32(pos, pathLens[i], true);
    pos += 4;
    file.set(pathBytes[i], pos);
    pos = entryPathEnd(entries, pathLens, i); // the gap stays zero-filled
    view.setBigUint64(pos, BigInt(dataOffset), true);
    pos += 8;
    view.setBigUint64(pos, BigInt(entries[i].data.length), true);
    pos += 8;
    for (let k = 0; k < 16; k++) file[pos + k] = (i * 31 + k * 7) & 0xff;
    pos += 16;
    file.set(entries[i].data, dataOffset);
    dataOffset += entries[i].data.length;
  }
  return file;
}

function prefixSize(lens: number[], upto: number): number {
  let n = 0;
  for (let i = 0; i < upto; i++) n += 4 + lens[i] + 8 + 8 + 16;
  return n;
}

function entryPathEnd(entries: Array<SyntheticPckEntry>, lens: number[], i: number): number {
  void entries;
  return 88 + prefixSize(lens, i) + 4 + lens[i];
}

/** An ancillary chunk placed before the first IDAT. */
export interface SyntheticPngChunk {
  type: string;
  data: Uint8Array;
}

/** Defaults: 2x2 RGBA8, one IDAT, no extra chunks. */
export interface MakePngOptions {
  width?: number;
  height?: number;
  colorType?: number;
  bitDepth?: number;
  idatChunks?: number;
  extraChunksBeforeIdat?: Array<SyntheticPngChunk>;
}

function channelsFor(colorType: number): number {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  return 4;
}

/**
 * Produce a real decodable PNG: zero-filled scanlines, zlib-deflated with
 * node:zlib, CRCs from zlib.crc32 as an independent oracle. A PLTE is added
 * automatically for colour type 3 when the caller did not supply one.
 */
export function makePng(opts: MakePngOptions = {}): Uint8Array {
  const width = opts.width ?? 2;
  const height = opts.height ?? 2;
  const colorType = opts.colorType ?? 6;
  const bitDepth = opts.bitDepth ?? 8;
  const idatCount = opts.idatChunks ?? 1;
  const channels = channelsFor(colorType);
  let rowBytes: number;
  if (bitDepth === 16) rowBytes = width * channels * 2;
  else if (bitDepth === 8) rowBytes = width * channels;
  else rowBytes = Math.ceil((width * bitDepth * channels) / 8);
  const raw = new Uint8Array(height * (1 + rowBytes));
  const compressed = new Uint8Array(deflateSync(raw));
  const parts = splitEven(compressed, Math.max(1, idatCount));
  const chunks: Array<SyntheticPngChunk> = [];
  const ihdr = new Uint8Array(13);
  const iview = new DataView(ihdr.buffer);
  iview.setUint32(0, width, false);
  iview.setUint32(4, height, false);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  chunks.push({ type: 'IHDR', data: ihdr });
  const hasPlte = (opts.extraChunksBeforeIdat ?? []).some((c) => c.type === 'PLTE');
  if (colorType === 3 && !hasPlte) {
    const count = 1 << bitDepth;
    const plte = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = count === 1 ? 0 : Math.round((i * 255) / (count - 1));
      plte[i * 3] = v;
      plte[i * 3 + 1] = v;
      plte[i * 3 + 2] = v;
    }
    chunks.push({ type: 'PLTE', data: plte });
  }
  for (const extra of opts.extraChunksBeforeIdat ?? []) chunks.push(extra);
  for (const part of parts) chunks.push({ type: 'IDAT', data: part });
  chunks.push({ type: 'IEND', data: new Uint8Array(0) });
  let total = 8;
  for (const c of chunks) total += 12 + c.data.length;
  const out = new Uint8Array(total);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let pos = 8;
  const typeBytes = new Uint8Array(4);
  for (const c of chunks) {
    view.setUint32(pos, c.data.length, false);
    for (let i = 0; i < 4; i++) typeBytes[i] = c.type.charCodeAt(i);
    out.set(typeBytes, pos + 4);
    out.set(c.data, pos + 8);
    const check = new Uint8Array(4 + c.data.length);
    check.set(typeBytes, 0);
    check.set(c.data, 4);
    view.setUint32(pos + 8 + c.data.length, nodeCrc32(check) >>> 0, false);
    pos += 12 + c.data.length;
  }
  return out;
}

function splitEven(bytes: Uint8Array, n: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  const base = Math.floor(bytes.length / n);
  let rest = bytes.length % n;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    parts.push(bytes.subarray(pos, pos + size));
    pos += size;
  }
  return parts;
}

/** In-memory ByteSource that records every (offset, length) it is asked for. */
export function memorySource(
  bytes: Uint8Array,
): ByteSource & { calls: Array<{ offset: number; length: number }> } {
  const calls: Array<{ offset: number; length: number }> = [];
  return {
    size: bytes.length,
    calls,
    async read(offset: number, length: number): Promise<Uint8Array> {
      calls.push({ offset, length });
      return bytes.slice(offset, offset + length);
    },
  };
}
