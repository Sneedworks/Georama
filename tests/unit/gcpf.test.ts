import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  GcpfError, decodeGcpf, encodeGcpf, fastlzCompress, fastlzDecompress,
  fastlzMaxCompressedSize, readGcpfHeader,
} from '../../src/core/formats/gcpf.ts';
import type { GcpfErrorCode } from '../../src/core/formats/gcpf.ts';

function random(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const text = new TextEncoder().encode('The river runs through the valley. Mountains, forests, villages.\n');
const lengths = [0, 1, 2, 15, 16, 17, 4095, 4096, 4097, 8191, 8192, 8193, 65_536, 1 << 20];
const patterns = ['zeros', 'random', 'pattern', 'text', 'rgba'] as const;
type Pattern = typeof patterns[number];

function data(length: number, pattern: Pattern): Uint8Array {
  const bytes = new Uint8Array(length);
  const next = random(0x12345678);
  for (let i = 0; i < length; i++) {
    switch (pattern) {
      case 'zeros': break;
      case 'random': bytes[i] = Math.floor(next() * 256); break;
      case 'pattern': bytes[i] = [3, 1, 4, 1, 5][i % 5]; break;
      case 'text': bytes[i] = text[i % text.length]; break;
      case 'rgba': {
        const pixel = Math.floor(i / 4);
        bytes[i] = [pixel % 256, Math.floor(pixel / 256) % 256, (pixel + Math.floor(pixel / 256)) % 256, 255][i % 4];
        break;
      }
    }
  }
  return bytes;
}

// Independent, intentionally unvalidated fixture writer (not the production encoder).
function container(total: number, blockSize: number, blocks: number[][], sizes = blocks.map((b) => b.length)): Uint8Array {
  const file = new Uint8Array(16 + sizes.length * 4 + blocks.reduce((n, b) => n + b.length, 0) + 4);
  file.set([71, 67, 80, 70]);
  const view = new DataView(file.buffer);
  view.setUint32(8, blockSize, true);
  view.setUint32(12, total, true);
  let off = 16 + sizes.length * 4;
  for (let i = 0; i < sizes.length; i++) view.setUint32(16 + i * 4, sizes[i], true);
  for (const block of blocks) { file.set(block, off); off += block.length; }
  file.set([71, 67, 80, 70], off);
  return file;
}

function expectCode(fn: () => unknown, code: GcpfErrorCode): GcpfError {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(GcpfError);
  expect((caught as GcpfError).code).toBe(code);
  return caught as GcpfError;
}

function setU32(file: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = file.slice();
  new DataView(copy.buffer).setUint32(offset, value, true);
  return copy;
}

describe('FastLZ level 1 instructions', () => {
  it.each([
    { name: 'literal only', stream: [2, 65, 66, 67], output: [65, 66, 67] },
    { name: 'distance-1 run', stream: [0, 7, 0x40, 0], output: [7, 7, 7, 7, 7] },
    { name: 'overlapping match', stream: [1, 65, 66, 0x80, 1], output: [65, 66, 65, 66, 65, 66, 65, 66] },
    { name: 'extended length', stream: [0, 120, 0xe0, 10, 0], output: Array<number>(20).fill(120) },
  ])('$name', ({ stream, output }) => {
    const dst = new Uint8Array(output.length);
    expect(fastlzDecompress(Uint8Array.from(stream), 0, stream.length, dst, 0, dst.length)).toBe(output.length);
    expect(Array.from(dst)).toEqual(output);
  });

  it('honors source/destination ranges and block-local history', () => {
    const src = Uint8Array.from([255, 1, 65, 66, 0x80, 1, 255]);
    const dst = new Uint8Array(12).fill(99);
    expect(fastlzDecompress(src, 1, 6, dst, 2, 8)).toBe(8);
    expect(Array.from(dst)).toEqual([99, 99, 65, 66, 65, 66, 65, 66, 65, 66, 99, 99]);
    expectCode(() => fastlzDecompress(Uint8Array.from([0, 7, 0x20, 1]), 0, 4, dst, 5, 7), 'FASTLZ');
  });

  it.each([
    [], [1, 7], [0, 7, 0x20], [0, 7, 0xe0], [0, 7, 0xe0, 3],
    [0, 7, 0x20, 1], [0x20, 7], [0x40, 7], [0xe0, 7],
  ])('rejects malformed stream %j with FASTLZ', (...stream: number[]) => {
    const src = Uint8Array.from(stream);
    expectCode(() => fastlzDecompress(src, 0, src.length, new Uint8Array(32), 0, 32), 'FASTLZ');
  });

  it('rejects literal and match output overruns', () => {
    expectCode(() => fastlzDecompress(Uint8Array.from([1, 1, 2]), 0, 3, new Uint8Array(1), 0, 1), 'FASTLZ');
    expectCode(() => fastlzDecompress(Uint8Array.from([0, 7, 0x40, 0]), 0, 4, new Uint8Array(4), 0, 4), 'FASTLZ');
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('validates public offsets and lengths: %s', (bad) => {
    const src = Uint8Array.from([0, 1]);
    const dst = new Uint8Array(100);
    expectCode(() => fastlzDecompress(src, bad, src.length, dst, 0, 10), 'FASTLZ');
    expectCode(() => fastlzDecompress(src, 0, bad, dst, 0, 10), 'FASTLZ');
    expectCode(() => fastlzDecompress(src, 0, src.length, dst, bad, 10), 'FASTLZ');
    expectCode(() => fastlzDecompress(src, 0, src.length, dst, 0, bad), 'FASTLZ');
    expectCode(() => fastlzCompress(src, bad, 1, dst, 0), 'FASTLZ');
    expectCode(() => fastlzCompress(src, 0, bad, dst, 0), 'FASTLZ');
    expectCode(() => fastlzCompress(src, 0, 1, dst, bad), 'FASTLZ');
    expectCode(() => fastlzMaxCompressedSize(bad), 'LIMIT');
  });

  it('ports Godot literal and run compression, including nonzero offsets', () => {
    const src = new Uint8Array(30).fill(9);
    src.fill(0, 4, 20);
    const dst = new Uint8Array(100).fill(255);
    const count = fastlzCompress(src, 4, 16, dst, 3);
    // Godot leaves the final three bytes as literals (ip_bound/ip_limit).
    expect(Array.from(dst.subarray(3, 3 + count))).toEqual([1, 0, 0, 0xe0, 2, 1, 2, 0, 0, 0]);
    expect(dst[2]).toBe(255);
    expect(dst[3 + count]).toBe(255);
    const out = new Uint8Array(16);
    expect(fastlzDecompress(dst, 3, 3 + count, out, 0, 16)).toBe(16);
    expect(out).toEqual(src.subarray(4, 20));
  });

  it('handles short raw inputs and destination capacity errors', () => {
    for (let length = 0; length < 16; length++) {
      const src = data(length, 'random');
      const dst = new Uint8Array(fastlzMaxCompressedSize(length));
      const n = fastlzCompress(src, 0, length, dst, 0);
      if (length === 0) expect(n).toBe(0);
      else {
        const out = new Uint8Array(length);
        expect(fastlzDecompress(dst, 0, n, out, 0, length)).toBe(length);
        expect(out).toEqual(src);
      }
    }
    expectCode(() => fastlzCompress(new Uint8Array(64), 0, 64, new Uint8Array(1), 0), 'FASTLZ');
    expectCode(() => fastlzCompress(new Uint8Array(4), 0, 5, new Uint8Array(100), 0), 'FASTLZ');
  });

  it('uses Godot worst-case capacity (6 percent, minimum 66)', () => {
    expect(fastlzMaxCompressedSize(0)).toBe(66);
    expect(fastlzMaxCompressedSize(16)).toBe(66);
    // Godot: size + size * 6 / 100 with INTEGER division (floor), at least 66. 101, 199 and 4096 tell floor from ceil.
    for (const [n, expected] of [[101, 107], [199, 210], [1000, 1060], [4096, 4341]] as const) expect(fastlzMaxCompressedSize(n)).toBe(expected);
    expect(fastlzMaxCompressedSize(1000)).toBe(1060);
  });
});

describe('FastLZ level 1 distance limit matches Godot 3.0 exactly', () => {
  // Each input is seeded filler with a 12-byte copy planted at exactly `distance` bytes, so the
  // only candidate match is that copy. The digests are of the bytes produced by Godot 3.0's own
  // public fastlz.c (MIT) for the same input, so a limit that is off by one in either direction
  // changes the stream: Godot accepts distance 8191 and refuses 8192 (distance >= MAX_DISTANCE).
  // For 8192 the same file with the limit raised to 16384 DOES match, proving the copy is findable.
  function plant(distance: number): Uint8Array {
    const next = random(0xd157 * 65536 + distance * 256);
    const bytes = new Uint8Array(distance + 12 + 40);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
    bytes.copyWithin(2 + distance, 2, 14);
    return bytes;
  }

  function matchDistances(stream: Uint8Array): number[] {
    const found: number[] = [];
    let ip = 0;
    while (ip < stream.length) {
      const ctrl = stream[ip++];
      if (ctrl < 32) { ip += ctrl + 1; continue; }
      if ((ctrl >>> 5) === 7) ip++;
      found.push(((ctrl & 31) << 8) + stream[ip++] + 1);
    }
    return found;
  }

  function compress(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(fastlzMaxCompressedSize(input.length));
    return out.slice(0, fastlzCompress(input, 0, input.length, out, 0));
  }

  it.each([
    [8190, 8491, '495de9a9af172dce866fc97b0bc44f46799168a4d0976347db7439f0ef84e5a1', true],
    [8191, 8495, '2a44e191d7ee7f07520cc5e17a061084bd212dc3f2ab5f163939ab2ad1103582', true],
    [8192, 8502, '2a4412ad77c4f8ca46e59f1f3c6c8bd4a1ceb2b6986c2fd17742443b64503ae8', false],
  ])('distance %i compresses to Godot\'s bytes (%i bytes, sha256 %s, match used: %s)', (distance, size, digest, matched) => {
    const input = plant(distance);
    const stream = compress(input);
    expect(stream.length).toBe(size);
    expect(createHash('sha256').update(stream).digest('hex')).toBe(digest);
    expect(matchDistances(stream).includes(distance)).toBe(matched);
    expect(Math.max(0, ...matchDistances(stream))).toBeLessThan(8192);
    const back = new Uint8Array(input.length);
    expect(fastlzDecompress(stream, 0, stream.length, back, 0, back.length)).toBe(input.length);
    expect(back).toEqual(input);
  });
});

describe('GCPF round trips', () => {
  for (const blockSize of [16, 1024, 4096, 65535]) {
    for (const pattern of patterns) {
      it.each(lengths)(`${pattern}, blockSize=${blockSize}, length=%i`, (length) => {
        const src = data(length, pattern);
        const encoded = encodeGcpf(src, { blockSize });
        const decoded = decodeGcpf(encoded);
        // Native equality avoids constructing huge per-byte assertion diffs.
        expect(Buffer.from(decoded.payload).equals(src)).toBe(true);
        expect(decoded.footerOk).toBe(true);
        expect(decoded.trailingBytes).toBe(4);
        expect(decoded.payload.byteOffset).toBe(0);
        expect(decoded.payload.buffer.byteLength).toBe(length);
        expect(encoded.byteOffset).toBe(0);
        expect(encoded.buffer.byteLength).toBe(encoded.length);
      });
    }
  }

  it('accepts payload and container views with nonzero byteOffset', () => {
    const storage = data(4500, 'random');
    const src = storage.subarray(13, 4110);
    const encoded = encodeGcpf(src);
    const backing = new Uint8Array(encoded.length + 23).fill(255);
    backing.set(encoded, 11);
    const view = backing.subarray(11, 11 + encoded.length);
    const decoded = decodeGcpf(view);
    expect(decoded.payload).toEqual(src);
    expect(readGcpfHeader(view)).toEqual(decoded.header);
  });
});

describe('GCPF structure and validation', () => {
  it.each([0, 1, 16, 4095, 4096, 4097, 8192])('writes a complete container for length %i', (length) => {
    const file = encodeGcpf(data(length, 'pattern'));
    const header = readGcpfHeader(file);
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(Array.from(file.subarray(0, 4))).toEqual([71, 67, 80, 70]);
    expect(view.getUint32(4, true)).toBe(0);
    expect(view.getUint32(8, true)).toBe(4096);
    expect(view.getUint32(12, true)).toBe(length);
    const count = Math.floor(length / 4096) + 1;
    expect(header.blockCount).toBe(count);
    expect(header.compressedSizes.length).toBe(count);
    expect(header.blockOffsets.length).toBe(count);
    let off = 16 + 4 * count;
    for (let i = 0; i < count; i++) {
      expect(header.blockOffsets[i]).toBe(off);
      expect(header.compressedSizes[i]).toBe(view.getUint32(16 + 4 * i, true));
      expect(header.compressedSizes[i]).toBeGreaterThan(0);
      off += header.compressedSizes[i];
    }
    expect(header.dataEnd).toBe(off);
    expect(file.length).toBe(off + 4);
    expect(Array.from(file.subarray(off))).toEqual([71, 67, 80, 70]);
    if (length % 4096 === 0) {
      const last = new Uint8Array(16);
      expect(fastlzDecompress(file, header.blockOffsets[count - 1], off, last, 0, 16)).toBe(16);
      expect(last).toEqual(new Uint8Array(16));
    }
  });

  it('allows a missing, bad, or followed footer without throwing', () => {
    const file = encodeGcpf(Uint8Array.from([1, 2, 3]));
    const end = readGcpfHeader(file).dataEnd;
    expect(decodeGcpf(file.subarray(0, end)).footerOk).toBe(false);
    expect(decodeGcpf(file.subarray(0, end + 3)).trailingBytes).toBe(3);
    const changed = file.slice();
    changed[end] = 0;
    expect(decodeGcpf(changed).footerOk).toBe(false);
    const extra = new Uint8Array(file.length + 7);
    extra.set(file);
    expect(decodeGcpf(extra).footerOk).toBe(true);
    expect(decodeGcpf(extra).trailingBytes).toBe(11);
  });

  it('skips empty blocks and handles padded short blocks', () => {
    expect(decodeGcpf(container(0, 4096, [[]])).payload.length).toBe(0);
    const file = container(2, 4096, [[15, 5, 9, ...Array<number>(14).fill(0)]]);
    expect(Array.from(decodeGcpf(file).payload)).toEqual([5, 9]);
  });

  it('checks header fields in the required order', () => {
    const file = encodeGcpf(new Uint8Array(16));
    expectCode(() => decodeGcpf(new Uint8Array(15)), 'TRUNCATED');
    const badMagic = file.slice(); badMagic[0] = 0;
    expectCode(() => decodeGcpf(setU32(badMagic, 4, 1)), 'MAGIC');
    expectCode(() => decodeGcpf(setU32(setU32(file, 4, 1), 8, 0)), 'MODE');
    expectCode(() => decodeGcpf(setU32(file, 8, 0)), 'HEADER');
    expectCode(() => decodeGcpf(setU32(file, 8, (1 << 24) + 1)), 'HEADER');
    expectCode(() => decodeGcpf(file, { maxTotalSize: 15 }), 'LIMIT');
    expectCode(() => decodeGcpf(file, { maxBlockSize: 16 }), 'HEADER');
    expectCode(() => decodeGcpf(file.subarray(0, 19)), 'TRUNCATED');
    expectCode(() => decodeGcpf(setU32(file, 16, file.length + 1)), 'TRUNCATED');
    expectCode(() => decodeGcpf(setU32(file, 16, 0)), 'BLOCK');
  });

  it('rejects a 16-byte header claiming 2 GiB before allocation, under 50 ms', () => {
    const file = new Uint8Array(16);
    file.set([71, 67, 80, 70]);
    const view = new DataView(file.buffer);
    view.setUint32(8, 4096, true);
    view.setUint32(12, 2 ** 31, true);
    const start = performance.now();
    expectCode(() => decodeGcpf(file), 'LIMIT');
    expect(performance.now() - start).toBeLessThan(50);
    expectCode(() => readGcpfHeader(file, { maxTotalSize: 2 ** 32 - 1 }), 'TRUNCATED');
  });

  it('rejects fitting tables claiming 16 MiB from a few bytes, under 50 ms', () => {
    const file = container(1 << 24, 1 << 24, [[0, 1], []]);
    const start = performance.now();
    // The header walk alone must refuse it. A later "decoded size mismatch" also reports BLOCK, so
    // the code by itself cannot tell the two apart: pin the header-level rejection and its reason,
    // because only the header-level check runs before the 16 MiB payload is allocated.
    const header = expectCode(() => readGcpfHeader(file), 'BLOCK');
    expect(header.message).toMatch(/expan/i);
    expectCode(() => decodeGcpf(file), 'BLOCK');
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('accepts a table exactly at the 88:1 expansion bound and refuses one byte beyond it', () => {
    // 1 compressed byte may stand for at most 88 output bytes (FastLZ-1: a 264-byte run costs 3 bytes).
    const atBound = container(88, 4096, [[0, 7]], [1]);
    expect(readGcpfHeader(atBound).totalSize).toBe(88);
    const beyond = container(89, 4096, [[0, 7]], [1]);
    const error = expectCode(() => readGcpfHeader(beyond), 'BLOCK');
    expect(error.message).toMatch(/expan/i);
  });

  it('reports exact decoded-size mismatch with block index and file offset', () => {
    const file = container(16, 4096, [[0, 7]]);
    const error = expectCode(() => decodeGcpf(file), 'BLOCK');
    expect(error.offset).toBe(20);
    expect(error.message).toMatch(/block 0/i);
    expect(error.message).toContain('20');
    expectCode(() => decodeGcpf(container(2, 4096, [[0, 7]])), 'BLOCK');
  });

  it.each([
    [0, 7, 0x20, 1], [15, 7], [0, 7, 0xe0, 255, 0], [0, 7, 0x20], [0x20, 7],
  ])('propagates FASTLZ for malformed container blocks %j', (...stream: number[]) => {
    expectCode(() => decodeGcpf(container(16, 4096, [stream])), 'FASTLZ');
  });

  it.each([0, 1, 15, 65536, -1, NaN, Infinity, 16.5])('rejects encoder block size %s', (blockSize) => {
    expectCode(() => encodeGcpf(new Uint8Array(1), { blockSize }), 'HEADER');
  });

  it.each([-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])('rejects invalid limits %s with typed errors', (bad) => {
    const file = encodeGcpf(new Uint8Array(16));
    expectCode(() => readGcpfHeader(file, { maxTotalSize: bad }), 'LIMIT');
    expectCode(() => readGcpfHeader(file, { maxBlockSize: bad }), 'HEADER');
  });
});

describe('boundaries pinned by the quality review', () => {
  it('accepts a footerless container whose size table ends exactly at the end of the file', () => {
    // 'GCPF', mode 0, block size 4096, total size 0, then the single size entry (0): 20 bytes and no footer.
    const file = new Uint8Array(20);
    file.set([71, 67, 80, 70]);
    new DataView(file.buffer).setUint32(8, 4096, true);
    const decoded = decodeGcpf(file);
    expect(decoded.payload.length).toBe(0);
    expect(decoded.footerOk).toBe(false);
    expectCode(() => decodeGcpf(file.subarray(0, 19)), 'TRUNCATED');
  });
});

describe('bounded malformed-input fuzzing', () => {
  it('2000 deterministic single/multi-byte mutations and truncations: success or GcpfError, each < 200 ms', () => {
    const bases = [encodeGcpf(data(8193, 'pattern')), encodeGcpf(data(4097, 'random')), encodeGcpf(new Uint8Array(0))];
    const next = random(0xc0decafe);
    for (let i = 0; i < 2000; i++) {
      const base = bases[i % bases.length];
      const input = base.slice(0, i % 3 === 0 ? Math.floor(next() * (base.length + 1)) : base.length);
      if (i % 3 !== 0) {
        const mutations = i % 3 === 1 ? 1 : 2 + Math.floor(next() * 7);
        for (let j = 0; j < mutations; j++) {
          const pos = Math.floor(next() * input.length);
          input[pos] ^= 1 + Math.floor(next() * 255);
        }
      }
      const start = performance.now();
      try { decodeGcpf(input); }
      catch (error) { expect(error, `mutation ${i}`).toBeInstanceOf(GcpfError); }
      expect(performance.now() - start, `mutation ${i}`).toBeLessThan(200);
    }
  });
});
