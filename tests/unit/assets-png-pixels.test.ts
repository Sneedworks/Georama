import { crc32 as nodeCrc32, deflateSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePngRgba8, PngPixelError } from '../../src/core/assets/png-pixels.ts';
import type { PngPixelErrorCode } from '../../src/core/assets/png-pixels.ts';

function channelsOf(colorType: number): number {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  return 4;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, nodeCrc32(out.subarray(4, 8 + data.length)) >>> 0, false);
  return out;
}

interface TestPngOptions {
  width: number;
  height: number;
  colorType: number;
  raw: Uint8Array;
  level?: number;
  plte?: Uint8Array;
  trns?: Uint8Array;
  beforeIdat?: Array<{ type: string; data: Uint8Array }>;
  idatSplit?: number;
}

function testPng(opts: TestPngOptions): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, opts.width, false);
  view.setUint32(4, opts.height, false);
  ihdr[8] = 8;
  ihdr[9] = opts.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunkBytes('IHDR', ihdr),
  ];
  if (opts.plte) parts.push(chunkBytes('PLTE', opts.plte));
  for (const extra of opts.beforeIdat ?? []) parts.push(chunkBytes(extra.type, extra.data));
  if (opts.trns) parts.push(chunkBytes('tRNS', opts.trns));
  const compressed = new Uint8Array(deflateSync(opts.raw, { level: opts.level ?? 9 }));
  const splits = opts.idatSplit ?? 1;
  if (splits > 1) {
    let pos = 0;
    const base = Math.floor(compressed.length / splits);
    let rest = compressed.length % splits;
    for (let i = 0; i < splits; i++) {
      const size = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      parts.push(chunkBytes('IDAT', compressed.subarray(pos, pos + size)));
      pos += size;
    }
  } else {
    parts.push(chunkBytes('IDAT', compressed));
  }
  parts.push(chunkBytes('IEND', new Uint8Array(0)));
  return concat(parts);
}

/** Filter type 0 scanlines around hand-written samples. */
function rawNone(width: number, height: number, colorType: number, samples: number[]): Uint8Array {
  const stride = width * channelsOf(colorType);
  const out = new Uint8Array(height * (1 + stride));
  let s = 0;
  for (let y = 0; y < height; y++) {
    out[y * (1 + stride)] = 0;
    for (let i = 0; i < stride; i++) out[y * (1 + stride) + 1 + i] = samples[s++];
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rewrite the IHDR data byte at the given index, fixing the CRC. */
function patchIhdr(png: Uint8Array, index: number, value: number): Uint8Array {
  const out = png.slice();
  out[16 + index] = value;
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(
    29,
    nodeCrc32(out.subarray(12, 29)) >>> 0,
    false,
  );
  return out;
}

/** Rebuild the file with the IDAT payload replaced, fixing chunk framing. */
function replaceIdat(png: Uint8Array, payload: Uint8Array, splits = 1): Uint8Array {
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let pos = 8;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let replaced = false;
  while (pos + 12 <= png.length) {
    const length = view.getUint32(pos, false);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    if (type === 'IDAT') {
      if (!replaced) {
        let at = 0;
        const base = Math.floor(payload.length / splits);
        let rest = payload.length % splits;
        for (let i = 0; i < splits; i++) {
          const size = base + (rest > 0 ? 1 : 0);
          if (rest > 0) rest -= 1;
          parts.push(chunkBytes('IDAT', payload.subarray(at, at + size)));
          at += size;
        }
        replaced = true;
      }
    } else {
      parts.push(png.subarray(pos, pos + 12 + length));
    }
    pos += 12 + length;
  }
  return concat(parts);
}

function idatPayload(png: Uint8Array): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Uint8Array[] = [];
  let pos = 8;
  while (pos + 12 <= png.length) {
    const length = view.getUint32(pos, false);
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    if (type === 'IDAT') found.push(png.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  return concat(found);
}

function expectPixelCode(bytes: Uint8Array, code: PngPixelErrorCode): void {
  try {
    decodePngRgba8(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(PngPixelError);
    expect((error as PngPixelError).code).toBe(code);
    return;
  }
  throw new Error(`expected PngPixelError ${code}, but nothing was thrown`);
}

describe('png pixel decoder', () => {
  it('decodes stored-block RGBA with mixed alpha', () => {
    const raw = rawNone(2, 2, 6, [
      10, 20, 30, 0, 40, 50, 60, 255,
      70, 80, 90, 128, 100, 110, 120, 255,
    ]);
    const decoded = decodePngRgba8(testPng({ width: 2, height: 2, colorType: 6, raw, level: 0 }));
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.rgba)).toEqual([
      10, 20, 30, 0, 40, 50, 60, 255,
      70, 80, 90, 128, 100, 110, 120, 255,
    ]);
  });

  it('decodes compressed RGB exactly', () => {
    const raw = rawNone(3, 1, 2, [5, 15, 25, 35, 45, 55, 65, 75, 85]);
    const decoded = decodePngRgba8(testPng({ width: 3, height: 1, colorType: 2, raw, level: 9 }));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([
      5, 15, 25, 255, 35, 45, 55, 255, 65, 75, 85, 255,
    ]);
  });

  it('expands gray to opaque RGBA and honours a colour key', () => {
    const raw = rawNone(4, 1, 0, [7, 42, 200, 250]);
    const plain = decodePngRgba8(testPng({ width: 4, height: 1, colorType: 0, raw }));
    expect(Array.from(plain.rgba)).toEqual([
      7, 7, 7, 255, 42, 42, 42, 255, 200, 200, 200, 255, 250, 250, 250, 255,
    ]);
    const keyed = decodePngRgba8(testPng({
      width: 4,
      height: 1,
      colorType: 0,
      raw,
      trns: new Uint8Array([0, 42]),
    }));
    expect(Array.from(keyed.rgba)).toEqual([
      7, 7, 7, 255, 42, 42, 42, 0, 200, 200, 200, 255, 250, 250, 250, 255,
    ]);
  });

  it('decodes gray with per-pixel alpha exactly', () => {
    const raw = rawNone(2, 1, 4, [9, 17, 200, 33]);
    const decoded = decodePngRgba8(testPng({ width: 2, height: 1, colorType: 4, raw }));
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([9, 9, 9, 17, 200, 200, 200, 33]);
  });

  it('maps palette entries with partial transparency and rejects a stray index', () => {
    const plte = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88, 99]);
    const trns = new Uint8Array([255, 0]);
    const raw = rawNone(2, 2, 3, [0, 1, 2, 0]);
    const decoded = decodePngRgba8(testPng({ width: 2, height: 2, colorType: 3, raw, plte, trns }));
    expect(Array.from(decoded.rgba)).toEqual([
      11, 22, 33, 255, 44, 55, 66, 0,
      77, 88, 99, 255, 11, 22, 33, 255,
    ]);
    const bad = rawNone(2, 2, 3, [3, 0, 0, 0]);
    expectPixelCode(
      testPng({ width: 2, height: 2, colorType: 3, raw: bad, plte, trns }),
      'header',
    );
  });

  it('reverses every filter type across five rows', () => {
    const rows: number[][] = [
      [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
      [5, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115],
      [200, 10, 30, 40, 200, 60, 70, 80, 200, 100, 110, 120],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      [250, 251, 252, 240, 241, 242, 230, 231, 232, 220, 221, 222],
    ];
    const channels = 3;
    const filtered = new Uint8Array(5 * (1 + 12));
    let prev: Uint8Array | null = null;
    for (let y = 0; y < 5; y++) {
      const samples = new Uint8Array(rows[y]);
      const out = new Uint8Array(12);
      for (let i = 0; i < 12; i++) {
        const left = i >= channels ? samples[i - channels] : 0;
        const up = prev ? prev[i] : 0;
        const upLeft = i >= channels && prev ? prev[i - channels] : 0;
        let value: number;
        if (y === 0) value = samples[i];
        else if (y === 1) value = samples[i] - left;
        else if (y === 2) value = samples[i] - up;
        else if (y === 3) value = samples[i] - ((left + up) >> 1);
        else {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = samples[i] - (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        }
        out[i] = value & 255;
      }
      filtered[y * 13] = y;
      filtered.set(out, y * 13 + 1);
      prev = samples;
    }
    const decoded = decodePngRgba8(testPng({ width: 4, height: 5, colorType: 2, raw: filtered }));
    const expected: number[] = [];
    for (const row of rows) {
      for (let p = 0; p < 4; p++) expected.push(row[p * 3], row[p * 3 + 1], row[p * 3 + 2], 255);
    }
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(5);
    expect(Array.from(decoded.rgba)).toEqual(expected);
  });

  it('round-trips compressible pseudo-random RGBA through dynamic Huffman blocks', () => {
    const rand = mulberry32(0x9e3779b9);
    const samples = new Uint8Array(64 * 64 * 4);
    for (let i = 0; i < samples.length; i++) {
      const base = (i * 31) & 255;
      samples[i] = rand() < 0.9 ? base : (rand() * 256) | 0;
    }
    const raw = rawNone(64, 64, 6, Array.from(samples));
    const png = testPng({ width: 64, height: 64, colorType: 6, raw, level: 9 });
    const payload = idatPayload(png);
    expect((payload[2] >> 1) & 3).toBe(2);
    const decoded = decodePngRgba8(png);
    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(64);
    expect(decoded.rgba.length).toBe(samples.length);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(samples));
  });

  it('decodes a hand-written fixed-Huffman stream', () => {
    // One block, final, fixed Huffman. Literals 0 and 65 then end-of-block 256.
    // Fixed codes: 0 -> 00110000, 65 -> 01110001 (8 bits each, most
    // significant bit first), 256 -> 0000000 (7 bits). Bit order below is
    // first-emitted first, packed least significant bit first per byte:
    // [1,1,0] block header, [0,0,1,1,0,0,0,0] literal 0,
    // [0,1,1,1,0,0,0,1] literal 65, [0,0,0,0,0,0,0] end, six zero pad bits.
    // Packed: 0x63, 0x70, 0x04, 0x00.
    const deflate = new Uint8Array([0x63, 0x70, 0x04, 0x00]);
    expect(Array.from(new Uint8Array(inflateRawSync(deflate)))).toEqual([0, 65]);
    const stream = new Uint8Array([0x78, 0x01, 0x63, 0x70, 0x04, 0x00, 0x00, 0x43, 0x00, 0x42]);
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, 1, false);
    view.setUint32(4, 1, false);
    ihdr[8] = 8;
    ihdr[9] = 0;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const png = concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunkBytes('IHDR', ihdr),
      chunkBytes('IDAT', stream),
      chunkBytes('IEND', new Uint8Array(0)),
    ]);
    const decoded = decodePngRgba8(png);
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.rgba)).toEqual([65, 65, 65, 255]);
  });

  it('rejects length symbols 286 and 287 in a fixed block', () => {
    const buildPayload = (lengthCode: number): Uint8Array => {
      const bits: number[] = [];
      const pushLsb = (value: number, n: number): void => {
        for (let i = 0; i < n; i++) bits.push((value >> i) & 1);
      };
      const pushMsb = (value: number, n: number): void => {
        for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
      };
      pushLsb(1, 1);
      pushLsb(1, 2);
      for (let v = 0; v < 5; v++) pushMsb(0x30 + v, 8);
      pushMsb(lengthCode, 8);
      pushMsb(0x00, 5);
      pushMsb(0x00, 7);
      const out = new Uint8Array(Math.ceil(bits.length / 8));
      for (let i = 0; i < bits.length; i++) {
        if (bits[i] === 1) out[i >> 3] |= 1 << (i & 7);
      }
      return out;
    };
    const buildPng = (payload: Uint8Array): Uint8Array => {
      const plain = new Uint8Array([0, 1, 2, 3, 4]);
      let s1 = 1;
      let s2 = 0;
      for (let i = 0; i < plain.length; i++) {
        s1 += plain[i];
        s2 += s1;
      }
      s1 %= 65521;
      s2 %= 65521;
      const adler = ((s2 * 65536 + s1) >>> 0);
      const stream = new Uint8Array(2 + payload.length + 4);
      stream[0] = 0x78;
      stream[1] = 0x01;
      stream.set(payload, 2);
      stream[2 + payload.length] = (adler >>> 24) & 255;
      stream[3 + payload.length] = (adler >>> 16) & 255;
      stream[4 + payload.length] = (adler >>> 8) & 255;
      stream[5 + payload.length] = adler & 255;
      const ihdr = new Uint8Array(13);
      const view = new DataView(ihdr.buffer);
      view.setUint32(0, 4, false);
      view.setUint32(4, 1, false);
      ihdr[8] = 8;
      ihdr[9] = 0;
      ihdr[10] = 0;
      ihdr[11] = 0;
      ihdr[12] = 0;
      return concat([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        chunkBytes('IHDR', ihdr),
        chunkBytes('IDAT', stream),
        chunkBytes('IEND', new Uint8Array(0)),
      ]);
    };
    for (const lengthCode of [0xc6, 0xc7]) {
      const payload = buildPayload(lengthCode);
      expect(() => inflateRawSync(payload)).toThrow();
      let code: string | null = null;
      try {
        decodePngRgba8(buildPng(payload));
      } catch (error) {
        code = (error as PngPixelError).code;
      }
      expect(code).toBe('inflate');
    }
  });

  it('decodes a dynamic block with an empty distance table', () => {
    const bits: number[] = [];
    const pushLsb = (value: number, n: number): void => {
      for (let i = 0; i < n; i++) bits.push((value >> i) & 1);
    };
    const pushMsb = (value: number, n: number): void => {
      for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };
    pushLsb(1, 1);
    pushLsb(2, 2);
    pushLsb(0, 5);
    pushLsb(0, 5);
    pushLsb(14, 4);
    const clValues = [0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2];
    for (const v of clValues) pushLsb(v, 3);
    pushMsb(0x01, 2);
    pushMsb(0x03, 2);
    pushLsb(53, 7);
    pushMsb(0x02, 2);
    pushMsb(0x03, 2);
    pushLsb(127, 7);
    pushMsb(0x03, 2);
    pushLsb(41, 7);
    pushMsb(0x02, 2);
    pushMsb(0x00, 2);
    pushMsb(0x00, 1);
    pushMsb(0x02, 2);
    pushMsb(0x03, 2);
    const payload = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === 1) payload[i >> 3] |= 1 << (i & 7);
    }
    expect(Array.from(new Uint8Array(inflateRawSync(payload)))).toEqual([0, 65]);
    const plain = new Uint8Array([0, 65]);
    let s1 = 1;
    let s2 = 0;
    for (let i = 0; i < plain.length; i++) {
      s1 += plain[i];
      s2 += s1;
    }
    s1 %= 65521;
    s2 %= 65521;
    const adler = ((s2 * 65536 + s1) >>> 0);
    const stream = new Uint8Array(2 + payload.length + 4);
    stream[0] = 0x78;
    stream[1] = 0x01;
    stream.set(payload, 2);
    stream[2 + payload.length] = (adler >>> 24) & 255;
    stream[3 + payload.length] = (adler >>> 16) & 255;
    stream[4 + payload.length] = (adler >>> 8) & 255;
    stream[5 + payload.length] = adler & 255;
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, 1, false);
    view.setUint32(4, 1, false);
    ihdr[8] = 8;
    ihdr[9] = 0;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const png = concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunkBytes('IHDR', ihdr),
      chunkBytes('IDAT', stream),
      chunkBytes('IEND', new Uint8Array(0)),
    ]);
    let decoded: { width: number; height: number; rgba: Uint8Array } | null = null;
    let failure: unknown = null;
    try {
      decoded = decodePngRgba8(png);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeNull();
    expect(decoded?.width).toBe(1);
    expect(decoded?.height).toBe(1);
    expect(Array.from(decoded?.rgba ?? new Uint8Array(0))).toEqual([65, 65, 65, 255]);
  });

  it('rejects malformed and unsupported input with typed codes', () => {
    const valid = testPng({
      width: 2,
      height: 2,
      colorType: 6,
      raw: rawNone(2, 2, 6, [
        10, 20, 30, 40, 50, 60, 70, 80,
        90, 100, 110, 120, 130, 140, 150, 160,
      ]),
    });
    const badSignature = valid.slice();
    badSignature[0] = 0;
    expectPixelCode(badSignature, 'signature');
    const badCrc = valid.slice();
    badCrc[badCrc.length - 1] ^= 1;
    expectPixelCode(badCrc, 'crc');
    const ihdrLate = concat([
      valid.subarray(0, 8),
      chunkBytes('tEXt', new Uint8Array([1, 2, 3])),
      valid.subarray(8),
    ]);
    expectPixelCode(ihdrLate, 'header');
    expectPixelCode(valid.subarray(0, valid.length - 12), 'chunk');
    expectPixelCode(patchIhdr(valid, 8, 16), 'unsupported');
    expectPixelCode(patchIhdr(valid, 12, 1), 'unsupported');
    expectPixelCode(patchIhdr(valid, 9, 5), 'header');
    const badFilter = rawNone(2, 2, 6, [
      10, 20, 30, 40, 50, 60, 70, 80,
      90, 100, 110, 120, 130, 140, 150, 160,
    ]);
    badFilter[0] = 5;
    expectPixelCode(
      testPng({ width: 2, height: 2, colorType: 6, raw: badFilter }),
      'filter',
    );
    const payload = idatPayload(valid);
    const badAdler = payload.slice();
    badAdler[badAdler.length - 1] ^= 1;
    expectPixelCode(replaceIdat(valid, badAdler), 'adler');
    expectPixelCode(replaceIdat(valid, payload.subarray(0, payload.length - 5)), 'inflate');
    const oversize = new Uint8Array(deflateSync(new Uint8Array([0, 5, 5, 5, 5, 5, 0, 6, 6, 6])));
    const tiny = testPng({ width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [9]) });
    expectPixelCode(replaceIdat(tiny, new Uint8Array(oversize)), 'size');
    const wide = patchIhdr(valid, 0, 0);
    const wideView = new DataView(wide.buffer, wide.byteOffset, wide.byteLength);
    wideView.setUint32(16, 20000, false);
    wideView.setUint32(29, nodeCrc32(wide.subarray(12, 29)) >>> 0, false);
    expectPixelCode(wide, 'limit');
  });

  it('fails fast on random bytes after a valid header', () => {
    const rand = mulberry32(7);
    const noise = new Uint8Array(10000);
    for (let i = 0; i < noise.length; i++) noise[i] = (rand() * 256) | 0;
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, 8, false);
    view.setUint32(4, 8, false);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const png = concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunkBytes('IHDR', ihdr),
      chunkBytes('IDAT', noise),
      chunkBytes('IEND', new Uint8Array(0)),
    ]);
    expect(() => decodePngRgba8(png)).toThrow(PngPixelError);
  });
});


// ---- Pins (test-only) for surviving mutants. Expected values are written by hand. ----
const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CL_0_1_2_18 = [0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2];

function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return error instanceof PngPixelError ? error.code : 'other';
  }
  return null;
}

function ihdrBytes(width: number, height: number, colorType: number): Uint8Array {
  const out = new Uint8Array(13);
  const view = new DataView(out.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  out[8] = 8;
  out[9] = colorType;
  return out;
}

function adlerBytes(plain: Uint8Array): Uint8Array {
  let s1 = 1;
  let s2 = 0;
  for (const byte of plain) {
    s1 = (s1 + byte) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const value = (s2 * 65536 + s1) >>> 0;
  return Uint8Array.from([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function zlibFrom(deflate: Uint8Array, plain: Uint8Array): Uint8Array {
  return concat([Uint8Array.from([0x78, 0x01]), deflate, adlerBytes(plain)]);
}

class BitWriter {
  private readonly bits: number[] = [];

  lsb(value: number, count: number): this {
    for (let i = 0; i < count; i++) this.bits.push((value >> i) & 1);
    return this;
  }

  msb(code: number, count: number): this {
    for (let i = count - 1; i >= 0; i--) this.bits.push((code >> i) & 1);
    return this;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) out[i >> 3] |= 1 << (i & 7);
    });
    return out;
  }
}

/** Zlib stream with no Adler-32 trailer, for failures that occur before the trailer. */
function bareZlib(writer: BitWriter): Uint8Array {
  return concat([Uint8Array.from([0x78, 0x01]), writer.bytes()]);
}

/** BFINAL=1, BTYPE=2, then the HLIT, HDIST and HCLEN fields and the 3-bit code-length lengths. */
function dynamicHeader(hlitField: number, hdistField: number, hclenField: number, clOrder: number[]): BitWriter {
  const writer = new BitWriter().lsb(1, 1).lsb(2, 2).lsb(hlitField, 5).lsb(hdistField, 5).lsb(hclenField, 4);
  for (const value of clOrder) writer.lsb(value, 3);
  return writer;
}

/** Literal lengths for a 258-entry table: L0=1, 64 zeros, L65=2, 138 zeros, 52 zeros, L256=2. */
function literalPrefix(writer: BitWriter): BitWriter {
  return writer
    .msb(1, 2).msb(3, 2).lsb(53, 7)
    .msb(2, 2)
    .msb(3, 2).lsb(127, 7)
    .msb(3, 2).lsb(41, 7)
    .msb(2, 2);
}

describe('png pixel decoder pins', () => {
  const gray1 = testPng({ width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [9]) });
  const gray5 = testPng({ width: 1, height: 5, colorType: 0, raw: rawNone(1, 5, 0, [1, 2, 3, 4, 5]) });

  it('enforces the input-size limit at its exact boundary', () => {
    expect(() => decodePngRgba8(gray1, { maxInputBytes: gray1.length })).not.toThrow();
    expect(codeOf(() => decodePngRgba8(gray1, { maxInputBytes: gray1.length - 1 }))).toBe('limit');
  });

  it('accepts images exactly at the width, height and pixel limits', () => {
    expect(decodePngRgba8(gray1, { maxWidth: 1 }).rgba.length).toBe(4);
    expect(decodePngRgba8(gray1, { maxHeight: 1 }).rgba.length).toBe(4);
    expect(decodePngRgba8(gray1, { maxPixels: 1 }).rgba.length).toBe(4);
    const tall = testPng({ width: 1, height: 2, colorType: 0, raw: rawNone(1, 2, 0, [1, 2]) });
    expect(codeOf(() => decodePngRgba8(tall, { maxPixels: 1 }))).toBe('limit');
  });

  it('rejects a width of 2147483647 with the limit error', () => {
    const huge = testPng({ width: 2147483647, height: 1, colorType: 0, raw: Uint8Array.from([0, 0]) });
    expect(codeOf(() => decodePngRgba8(huge))).toBe('limit');
  });

  it('rejects a signature with no chunks as a missing header', () => {
    expect(codeOf(() => decodePngRgba8(SIGNATURE))).toBe('header');
  });

  it('rejects a chunk whose CRC is cut off by the end of the input', () => {
    expect(codeOf(() => decodePngRgba8(gray1.slice(0, gray1.length - 14)))).toBe('chunk');
  });

  it('rejects a duplicate IHDR and a duplicate PLTE', () => {
    const dupIhdr = testPng({
      width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [9]),
      beforeIdat: [{ type: 'IHDR', data: ihdrBytes(1, 1, 0) }],
    });
    expect(codeOf(() => decodePngRgba8(dupIhdr))).toBe('header');
    const palette = Uint8Array.from([1, 2, 3]);
    const dupPlte = testPng({
      width: 1, height: 1, colorType: 3, raw: rawNone(1, 1, 3, [0]), plte: palette,
      beforeIdat: [{ type: 'PLTE', data: palette }],
    });
    expect(codeOf(() => decodePngRgba8(dupPlte))).toBe('header');
  });

  it('rejects an IEND that is not the last chunk', () => {
    const trailing = concat([gray1, chunkBytes('tEXt', Uint8Array.from([0x41]))]);
    expect(codeOf(() => decodePngRgba8(trailing))).toBe('chunk');
  });

  it('skips an ancillary chunk whose name starts with a lowercase a', () => {
    const withAncillary = testPng({
      width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [9]),
      beforeIdat: [{ type: 'abcd', data: Uint8Array.from([1, 2]) }],
    });
    expect(Array.from(decodePngRgba8(withAncillary).rgba)).toEqual([9, 9, 9, 255]);
  });

  it('rejects an unknown critical chunk', () => {
    const critical = testPng({
      width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [9]),
      beforeIdat: [{ type: 'ZZZZ', data: new Uint8Array(0) }],
    });
    expect(codeOf(() => decodePngRgba8(critical))).toBe('unsupported');
  });

  it('rejects a file with no IDAT chunk', () => {
    const noIdat = concat([SIGNATURE, chunkBytes('IHDR', ihdrBytes(1, 1, 0)), chunkBytes('IEND', new Uint8Array(0))]);
    expect(codeOf(() => decodePngRgba8(noIdat))).toBe('chunk');
  });

  it('rejects a filter method other than zero', () => {
    expect(codeOf(() => decodePngRgba8(patchIhdr(gray1, 11, 1)))).toBe('header');
  });

  it('rejects a palette above 256 entries and transparency longer than the palette', () => {
    const big = testPng({ width: 1, height: 1, colorType: 3, raw: rawNone(1, 1, 3, [0]), plte: new Uint8Array(771) });
    expect(codeOf(() => decodePngRgba8(big))).toBe('header');
    const longTrns = testPng({
      width: 1, height: 1, colorType: 3, raw: rawNone(1, 1, 3, [0]),
      plte: Uint8Array.from([1, 2, 3, 4, 5, 6]), trns: Uint8Array.from([1, 2, 3]),
    });
    expect(codeOf(() => decodePngRgba8(longTrns))).toBe('header');
  });

  it('checks RGB transparency length and honours a complete six-byte key', () => {
    const pixels = rawNone(2, 1, 2, [1, 2, 3, 9, 9, 9]);
    const shortKey = testPng({ width: 2, height: 1, colorType: 2, raw: pixels, trns: Uint8Array.from([0, 1, 0, 2, 0]) });
    expect(codeOf(() => decodePngRgba8(shortKey))).toBe('header');
    const keyed = testPng({ width: 2, height: 1, colorType: 2, raw: pixels, trns: Uint8Array.from([0, 1, 0, 2, 0, 3]) });
    expect(Array.from(decodePngRgba8(keyed).rgba)).toEqual([1, 2, 3, 0, 9, 9, 9, 255]);
  });

  it('compares colour keys at full width and on every channel', () => {
    const grayHighByte = testPng({ width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [5]), trns: Uint8Array.from([1, 5]) });
    expect(Array.from(decodePngRgba8(grayHighByte).rgba)).toEqual([5, 5, 5, 255]);
    const grayNoKey = testPng({ width: 1, height: 1, colorType: 0, raw: rawNone(1, 1, 0, [0]) });
    expect(Array.from(decodePngRgba8(grayNoKey).rgba)).toEqual([0, 0, 0, 255]);
    const rgbHighBlue = testPng({
      width: 1, height: 1, colorType: 2, raw: rawNone(1, 1, 2, [1, 2, 5]), trns: Uint8Array.from([0, 1, 0, 2, 1, 5]),
    });
    expect(Array.from(decodePngRgba8(rgbHighBlue).rgba)).toEqual([1, 2, 5, 255]);
    const rgbBlueDiffers = testPng({
      width: 2, height: 1, colorType: 2, raw: rawNone(2, 1, 2, [1, 2, 9, 1, 2, 3]), trns: Uint8Array.from([0, 1, 0, 2, 0, 3]),
    });
    expect(Array.from(decodePngRgba8(rgbBlueDiffers).rgba)).toEqual([1, 2, 9, 255, 1, 2, 3, 0]);
  });

  it('maps palette indices above 127 without losing the high bit', () => {
    const palette = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      palette[3 * i] = i;
      palette[3 * i + 1] = 255 - i;
    }
    const png = testPng({ width: 1, height: 1, colorType: 3, raw: rawNone(1, 1, 3, [200]), plte: palette });
    expect(Array.from(decodePngRgba8(png).rgba)).toEqual([200, 55, 0, 255]);
  });

  it('rejects a zlib preset dictionary, a window above 32 KiB, and a stream with no block', () => {
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, Uint8Array.from([0x78, 0x20, 0, 0, 0, 0, 0]))))).toBe('zlib');
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, Uint8Array.from([0x88, 0x1c, 0, 0, 0, 0, 0]))))).toBe('zlib');
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, Uint8Array.from([0x78, 0x01]))))).toBe('inflate');
  });

  it('rejects bytes after the Adler-32 and an output shorter than the header implies', () => {
    const trailing = replaceIdat(gray1, concat([idatPayload(gray1), Uint8Array.from([0])]));
    expect(codeOf(() => decodePngRgba8(trailing))).toBe('zlib');
    const short = testPng({ width: 1, height: 2, colorType: 0, raw: rawNone(1, 1, 0, [9]) });
    expect(codeOf(() => decodePngRgba8(short))).toBe('size');
  });

  it('checks stored-block complements, lengths and truncation', () => {
    const badComplement = zlibFrom(Uint8Array.from([0x01, 2, 0, 0, 0, 0, 9]), Uint8Array.from([0, 9]));
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, badComplement)))).toBe('inflate');
    const overlong = zlibFrom(Uint8Array.from([0x01, 3, 0, 0xfc, 0xff, 0, 9, 9]), Uint8Array.from([0, 9, 9]));
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, overlong)))).toBe('size');
    const truncatedBody = Uint8Array.from([0x78, 0x01, 0x01, 2, 0, 0xfd, 0xff, 0]);
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, truncatedBody)))).toBe('inflate');
    const truncatedHeader = Uint8Array.from([0x78, 0x01, 0x01, 0, 0, 0xff, 0xff]);
    expect(codeOf(() => decodePngRgba8(replaceIdat(gray1, truncatedHeader)))).toBe('zlib');
  });

  it('rejects dynamic headers with more than 286 literal codes or more than 30 distance codes', () => {
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(dynamicHeader(30, 0, 0, []))))).toThrow('Bad dynamic header');
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(dynamicHeader(0, 30, 0, []))))).toThrow('Bad dynamic header');
  });

  it('rejects a repeat code before any length has been written', () => {
    const writer = dynamicHeader(0, 0, 14, [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).msb(1, 1);
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(writer)))).toThrow('Bad length repeat');
  });

  it('rejects a repeat that runs past the declared code lengths', () => {
    const writer = dynamicHeader(0, 0, 12, [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
      .msb(1, 1).lsb(127, 7)
      .msb(1, 1).lsb(104, 7)
      .msb(0, 1).lsb(3, 2);
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(writer)))).toThrow('Too many lengths');
  });

  it('rejects an incomplete literal/length code', () => {
    const writer = dynamicHeader(0, 0, 12, [0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2])
      .msb(2, 2)
      .msb(3, 2).lsb(127, 7)
      .msb(3, 2).lsb(106, 7)
      .msb(2, 2)
      .msb(0, 1)
      .msb(0, 2).msb(1, 2);
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(writer)))).toThrow('Incomplete Huffman code');
  });

  it('rejects an incomplete distance code and accepts one one-bit distance code', () => {
    const incomplete = literalPrefix(dynamicHeader(0, 0, 14, CL_0_1_2_18)).msb(2, 2).msb(0, 1).msb(2, 2).msb(3, 2);
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(incomplete)))).toThrow('Incomplete Huffman code');
    const oneBit = literalPrefix(dynamicHeader(0, 0, 14, CL_0_1_2_18)).msb(1, 2).msb(0, 1).msb(2, 2).msb(3, 2);
    const decoded = decodePngRgba8(replaceIdat(gray1, zlibFrom(oneBit.bytes(), Uint8Array.from([0, 65]))));
    expect(Array.from(decoded.rgba)).toEqual([65, 65, 65, 255]);
  });

  it('rejects an incomplete code-length code', () => {
    const writer = dynamicHeader(0, 0, 14, [0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]).msb(1, 2);
    for (let i = 0; i < 255; i++) writer.msb(0, 2);
    writer.msb(1, 2).msb(0, 2).msb(0, 1).msb(1, 1);
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(writer)))).toThrow('Incomplete Huffman code');
  });

  it('rejects a Huffman code that matches no symbol', () => {
    const writer = new BitWriter().lsb(1, 1).lsb(1, 2).msb(0x30, 8).msb(1, 7).msb(30, 5);
    expect(() => decodePngRgba8(replaceIdat(gray1, bareZlib(writer)))).toThrow('Bad Huffman code');
  });

  it('rejects a stream that ends in the middle of a code', () => {
    const writer = new BitWriter().lsb(1, 1).lsb(1, 2);
    for (let i = 0; i < 7; i++) writer.msb(0x190 + i, 9);
    writer.msb(0, 6);
    expect(() => decodePngRgba8(replaceIdat(gray5, bareZlib(writer)))).toThrow('Truncated DEFLATE stream');
  });

  it('rejects output past the expected size from literals and copies, and distances before the start', () => {
    const literalsOverflow = new BitWriter().lsb(1, 1).lsb(1, 2).msb(0x30, 8).msb(0x39, 8).msb(0x39, 8).msb(0, 7);
    expect(() => decodePngRgba8(replaceIdat(gray1, zlibFrom(literalsOverflow.bytes(), Uint8Array.from([0, 9, 9])))))
      .toThrow('Output past the expected size');
    const copyOverflow = new BitWriter().lsb(1, 1).lsb(1, 2).msb(0x30, 8).msb(0x39, 8).msb(1, 7).msb(0, 5).msb(0, 7);
    expect(() => decodePngRgba8(replaceIdat(gray1, zlibFrom(copyOverflow.bytes(), Uint8Array.from([0, 9])))))
      .toThrow('Output past the expected size');
    const farDistance = concat([bareZlib(new BitWriter().lsb(1, 1).lsb(1, 2).msb(0x30, 8).msb(1, 7).msb(1, 5)), new Uint8Array(4)]);
    expect(() => decodePngRgba8(replaceIdat(gray1, farDistance))).toThrow('Distance past the start');
  });

  it('reads the up neighbour as zero on the first row, for filter 2 and for Paeth', () => {
    const up = testPng({ width: 3, height: 1, colorType: 0, raw: Uint8Array.from([2, 10, 20, 30]) });
    expect(Array.from(decodePngRgba8(up).rgba)).toEqual([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255]);
    const paeth = testPng({ width: 2, height: 1, colorType: 0, raw: Uint8Array.from([4, 10, 10]) });
    expect(Array.from(decodePngRgba8(paeth).rgba)).toEqual([10, 10, 10, 255, 20, 20, 20, 255]);
  });

  it('applies the Paeth up-left term on later rows', () => {
    const png = testPng({ width: 2, height: 2, colorType: 0, raw: Uint8Array.from([0, 10, 10, 4, 246, 5]) });
    expect(Array.from(decodePngRgba8(png).rgba)).toEqual([10, 10, 10, 255, 10, 10, 10, 255, 0, 0, 0, 255, 5, 5, 5, 255]);
  });

  it('breaks Paeth ties toward up, not up-left', () => {
    const png = testPng({ width: 2, height: 2, colorType: 0, raw: Uint8Array.from([0, 1, 3, 4, 255, 7]) });
    expect(Array.from(decodePngRgba8(png).rgba)).toEqual([1, 1, 1, 255, 3, 3, 3, 255, 0, 0, 0, 255, 10, 10, 10, 255]);
  });

  it('keeps the Paeth distance signed when the up-left term is larger than the others', () => {
    const png = testPng({ width: 2, height: 2, colorType: 0, raw: Uint8Array.from([0, 10, 1, 4, 246, 5]) });
    expect(Array.from(decodePngRgba8(png).rgba)).toEqual([10, 10, 10, 255, 1, 1, 1, 255, 0, 0, 0, 255, 5, 5, 5, 255]);
  });

  it('decodes a dynamic block whose code lengths use run-length symbol 17', () => {
    const random = mulberry32(7);
    const alphabet = [1, 5, 9, 200];
    const samples: number[] = [];
    for (let i = 0; i < 64 * 64; i++) samples.push(alphabet[Math.floor(random() * alphabet.length)]);
    const png = testPng({ width: 64, height: 64, colorType: 0, raw: rawNone(64, 64, 0, samples) });
    const expected: number[] = [];
    for (const s of samples) expected.push(s, s, s, 255);
    expect(Array.from(decodePngRgba8(png).rgba)).toEqual(expected);
  });

  it('stops oversized images with the limit before any allocation', () => {
    const wide = testPng({ width: 2 ** 26, height: 2 ** 26, colorType: 0, raw: new Uint8Array(0) });
    expect(codeOf(() => decodePngRgba8(wide, { maxWidth: 2 ** 27, maxHeight: 2 ** 27, maxPixels: Number.MAX_SAFE_INTEGER })))
      .toBe('limit');
    const tallRgba = testPng({ width: 2 ** 24, height: 2 ** 27 - 1, colorType: 6, raw: new Uint8Array(0) });
    expect(codeOf(() => decodePngRgba8(tallRgba, { maxWidth: 2 ** 25, maxHeight: 2 ** 28, maxPixels: 2 ** 52 }))).toBe('limit');
  });
});
