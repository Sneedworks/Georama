import { PNG_LIMITS, crc32 } from '../assets/png.ts';
import { ExportError } from './errors.ts';

// Card 1.10, Stage A (detail v1): RGBA8 PNG encoder. Pure: no Node and no DOM imports.
// The caller supplies the deflate function; it must return a zlib-format stream (RFC 1950),
// because that stream goes into IDAT unchanged.

export type DeflateFn = (raw: Uint8Array) => Uint8Array;

export interface EncodePngOptions {
  readonly idatChunkBytes?: number;
}

const DEFAULT_IDAT_CHUNK_BYTES = 1048576;
const MAX_CHUNK_LENGTH = 2147483647;
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // CRC-32 over type plus data: bytes 4 up to, not including, 8 + data.length.
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length), false);
  return out;
}

// Check order (detail v1): dimensions, PNG reader limits, pixel buffer, deflate, chunk size, then encode.
export function encodePngRgba8(
  width: number,
  height: number,
  rgba: Uint8Array,
  deflate: DeflateFn,
  options?: EncodePngOptions,
): Uint8Array {
  if (!isCount(width) || !isCount(height)) {
    throw new ExportError('param', 'png: width and height must be safe integers >= 1');
  }
  if (width > PNG_LIMITS.maxDimension || height > PNG_LIMITS.maxDimension || width * height > PNG_LIMITS.maxPixels) {
    throw new ExportError('limit', 'png: size exceeds the PNG reader limits (PNG_LIMITS)');
  }
  if (!(rgba instanceof Uint8Array)) {
    throw new ExportError('param', 'png: rgba must be a Uint8Array');
  }
  if (rgba.length !== width * height * 4) {
    throw new ExportError('length', `png: rgba has ${rgba.length} bytes, expected ${width * height * 4}`);
  }
  if (typeof deflate !== 'function') {
    throw new ExportError('param', 'png: deflate must be a function');
  }
  const chunkBytes = options?.idatChunkBytes ?? DEFAULT_IDAT_CHUNK_BYTES;
  if (!isCount(chunkBytes) || chunkBytes > MAX_CHUNK_LENGTH) {
    throw new ExportError('param', 'png: idatChunkBytes must be an integer in [1, 2147483647]');
  }

  // Raw scanlines: each row starts with filter byte 0 (None).
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const compressed = deflate(raw);
  if (!(compressed instanceof Uint8Array) || compressed.length < 1) {
    throw new ExportError('deflate', 'png: deflate must return a non-empty Uint8Array');
  }

  // IHDR: width, height (big-endian u32), bit depth 8, colour type 6 (RGBA), compression 0, filter 0, interlace 0.
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const parts: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr)];
  for (let pos = 0; pos < compressed.length; pos += chunkBytes) {
    parts.push(chunk('IDAT', compressed.subarray(pos, Math.min(pos + chunkBytes, compressed.length))));
  }
  parts.push(chunk('IEND', new Uint8Array(0)));

  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
