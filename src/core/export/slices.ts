// Base64 slices, coverage and assembly for the chunked transfer (card 1.10, Stage B2).
// Pure: no globals, no Node or DOM imports. Errors carry static messages and indexes, never the content.
import { ExportError } from './errors.ts';
import type { ChunkRange } from './transfer.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CODE = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) CODE[ALPHABET.charCodeAt(i)] = i;

function sextet(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const value = code < 128 ? CODE[code] : -1;
  if (value < 0) throw new ExportError('param', `base64: invalid character at index ${index}`);
  return value;
}

// RFC 4648 standard alphabet with '=' padding. Length must be a multiple of 4; padding only at the end.
export function decodeBase64(text: string): Uint8Array {
  if (typeof text !== 'string') throw new ExportError('param', 'base64: text must be a string');
  const n = text.length;
  if (n % 4 !== 0) throw new ExportError('param', 'base64: length must be a multiple of 4');
  let pad = 0;
  if (n > 0 && text[n - 1] === '=') pad = text[n - 2] === '=' ? 2 : 1;
  const groups = n / 4;
  const out = new Uint8Array(groups * 3 - pad);
  let o = 0;
  for (let g = 0; g < groups; g++) {
    const i = g * 4;
    const last = g === groups - 1;
    const a = sextet(text, i);
    const b = sextet(text, i + 1);
    const c = last && pad === 2 ? 0 : sextet(text, i + 2);
    const d = last && pad >= 1 ? 0 : sextet(text, i + 3);
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (bits >> 16) & 0xff;
    if (o < out.length) out[o++] = (bits >> 8) & 0xff;
    if (o < out.length) out[o++] = bits & 0xff;
  }
  return out;
}

// Ranges must start at 0, be non-empty and contiguous, and end at total. Refusals use 'length'.
export function checkCoverage(total: number, ranges: readonly ChunkRange[]): void {
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 1) {
    throw new ExportError('param', 'coverage: total must be a safe integer >= 1');
  }
  let next = 0;
  for (let k = 0; k < ranges.length; k++) {
    const r = ranges[k];
    if (r.start !== next) throw new ExportError('length', `coverage: range ${k} starts at ${r.start}, expected ${next}`);
    if (!(r.end > r.start)) throw new ExportError('length', `coverage: range ${k} is empty or inverted`);
    next = r.end;
  }
  if (next !== total) throw new ExportError('length', `coverage: ranges end at ${next}, expected ${total}`);
}

// Decodes each slice into its range. Counts that differ are 'param'; a decoded size that differs is 'length'.
export function assembleSlices(total: number, ranges: readonly ChunkRange[], texts: readonly string[]): Uint8Array {
  if (texts.length !== ranges.length) throw new ExportError('param', 'assemble: texts and ranges differ in count');
  checkCoverage(total, ranges);
  const out = new Uint8Array(total);
  for (let k = 0; k < ranges.length; k++) {
    const r = ranges[k];
    const part = decodeBase64(texts[k]);
    if (part.length !== r.end - r.start) {
      throw new ExportError('length', `assemble: slice ${k} decodes to ${part.length} bytes, expected ${r.end - r.start}`);
    }
    out.set(part, r.start);
  }
  return out;
}
