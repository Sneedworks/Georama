// Strength round for src/core/assets/pck.ts, written from the card (T0.6a) and from a mutation table of the
// module (171 operator mutants; 99 were killed by the implementer's tests). Every case below pins a behaviour
// that no earlier test pinned: error OFFSETS (the card fixes them only for TRUNCATED; the others are
// characterised here, so a change must be deliberate), single header bytes, limit boundaries, the loader's
// error propagation and read pattern, and the guards of readPckEntry against a forged index.
//
// Mutants that are provably equivalent and stay alive on purpose (reasoning, not a test gap):
//  - isLetter-style dead guards of checkPath (`path.length <= PREFIX.length`, `for i = 0`, `i <= length`): an
//    empty remainder or a first character that is always 'r' reaches the same FORMAT error through the segment check.
//  - the NUL scan (`nul = -1` start, `k = 0`, `k <= length`, `nul < 0`, `nul >= 0`, `nul + 1`): a field that starts with
//    a NUL decodes to an empty path, which checkPath rejects with the same code and offset as the junk check does.
//  - `pathLen === 0`: a path of length 0 or 1 can never be a valid `res://x` path, so FORMAT at the same offset follows.
//  - changing the offset/size disjunction to a conjunction is masked by the exact bigint sum check on valid file sizes;
//    the size comparison at SAFE_MAX itself IS observable for offset 0 (FORMAT versus RANGE) and has a regression below.
//  - `acc.length >= cap` against `want <= acc.length`: two guards for one condition; each hides the other.
// These are equivalence arguments, supported by the recorded differential run, not a claim about every possible mutation.
import { describe, expect, it } from 'vitest';
import {
  PCK_DATA_EXTENSIONS,
  PCK_LIMITS,
  PckError,
  isPckDataPath,
  loadPckIndex,
  parsePckIndex,
  readPckEntry,
} from '../../src/core/assets/pck.ts';
import type { ByteSource, PckIndex } from '../../src/core/assets/pck.ts';
import { buildPck, memorySource } from '../helpers/pck-synthetic.ts';

const enc = new TextEncoder();

function header(fileCount: number, o: { magic?: number[]; version?: number; major?: number; minor?: number; rev?: number } = {}): Uint8Array {
  const h = new Uint8Array(88);
  h.set(o.magic ?? [0x47, 0x44, 0x50, 0x43], 0);
  const v = new DataView(h.buffer);
  v.setUint32(4, o.version ?? 1, true);
  v.setUint32(8, o.major ?? 3, true);
  v.setUint32(12, o.minor ?? 0, true);
  v.setUint32(16, o.rev ?? 0, true);
  v.setUint32(84, fileCount, true);
  return h;
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function padded(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + ((4 - (bytes.length % 4)) % 4));
  out.set(bytes, 0);
  return out;
}

/** One raw index entry: the path field is written exactly as given (the caller pads it). */
function entry(field: Uint8Array, offset: bigint, size: bigint, pathLen: number = field.length): Uint8Array {
  const out = new Uint8Array(4 + field.length + 32);
  const v = new DataView(out.buffer);
  v.setUint32(0, pathLen, true);
  out.set(field, 4);
  v.setBigUint64(4 + field.length, offset, true);
  v.setBigUint64(12 + field.length, size, true);
  return out;
}

/** A one-entry archive whose entry is valid when `path` is: offset = indexEnd, size 0. Returns prefix and fileSize. */
function oneEntry(path: string): { bytes: Uint8Array; fileSize: number } {
  const field = padded(enc.encode(path));
  const indexEnd = 88 + 4 + field.length + 32;
  return { bytes: cat(header(1), entry(field, BigInt(indexEnd), 0n)), fileSize: indexEnd };
}

type Outcome = 'ok' | { code: string; offset: number };

function outcome(fn: () => unknown): Outcome {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (!(error instanceof PckError)) throw error;
    return { code: error.code, offset: error.offset };
  }
}

async function outcomeAsync(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn();
    return 'ok';
  } catch (error) {
    if (!(error instanceof PckError)) throw error;
    return { code: error.code, offset: error.offset };
  }
}

describe('parsePckIndex: argument and header boundaries with exact (code, offset)', () => {
  const one = oneEntry('res://a');
  const cases: Array<[string, () => unknown, Outcome]> = [
    ['prefix is not a Uint8Array', () => parsePckIndex(null as unknown as Uint8Array, 100), { code: 'TRUNCATED', offset: 0 }],
    ['prefix is a plain array', () => parsePckIndex([1, 2, 3] as unknown as Uint8Array, 100), { code: 'TRUNCATED', offset: 0 }],
    ['fileSize NaN', () => parsePckIndex(header(0), Number.NaN), { code: 'RANGE', offset: 0 }],
    ['fileSize -1', () => parsePckIndex(header(0), -1), { code: 'RANGE', offset: 0 }],
    ['fileSize 1.5', () => parsePckIndex(header(0), 1.5), { code: 'RANGE', offset: 0 }],
    ['fileSize 2^53', () => parsePckIndex(header(0), 2 ** 53), { code: 'RANGE', offset: 0 }],
    ['fileSize Infinity', () => parsePckIndex(header(0), Number.POSITIVE_INFINITY), { code: 'RANGE', offset: 0 }],
    ['fileSize is a string', () => parsePckIndex(header(0), '88' as unknown as number), { code: 'RANGE', offset: 0 }],
    ['empty prefix', () => parsePckIndex(new Uint8Array(0), 0), { code: 'TRUNCATED', offset: 0 }],
    ['87 bytes', () => parsePckIndex(header(0).subarray(0, 87), 87), { code: 'TRUNCATED', offset: 87 }],
    ['magic byte 0 wrong', () => parsePckIndex(header(0, { magic: [0x48, 0x44, 0x50, 0x43] }), 88), { code: 'MAGIC', offset: 0 }],
    ['magic byte 1 wrong', () => parsePckIndex(header(0, { magic: [0x47, 0x45, 0x50, 0x43] }), 88), { code: 'MAGIC', offset: 0 }],
    ['magic byte 2 wrong', () => parsePckIndex(header(0, { magic: [0x47, 0x44, 0x51, 0x43] }), 88), { code: 'MAGIC', offset: 0 }],
    ['magic byte 3 wrong', () => parsePckIndex(header(0, { magic: [0x47, 0x44, 0x50, 0x44] }), 88), { code: 'MAGIC', offset: 0 }],
    ['magic is judged before the version', () => parsePckIndex(header(0, { magic: [0, 0, 0, 0], version: 2 }), 88), { code: 'MAGIC', offset: 0 }],
    ['pack version 0', () => parsePckIndex(header(0, { version: 0 }), 88), { code: 'VERSION', offset: 4 }],
    ['pack version 2', () => parsePckIndex(header(0, { version: 2 }), 88), { code: 'VERSION', offset: 4 }],
    ['pack version 0xffffffff', () => parsePckIndex(header(0, { version: 0xffffffff }), 88), { code: 'VERSION', offset: 4 }],
    ['the pack version is judged before the Godot major', () => parsePckIndex(header(0, { version: 2, major: 4 }), 88), { code: 'VERSION', offset: 4 }],
    ['Godot major 0', () => parsePckIndex(header(0, { major: 0 }), 88), { code: 'VERSION', offset: 8 }],
    ['Godot major 2', () => parsePckIndex(header(0, { major: 2 }), 88), { code: 'VERSION', offset: 8 }],
    ['Godot major 4', () => parsePckIndex(header(0, { major: 4 }), 88), { code: 'VERSION', offset: 8 }],
    ['Godot major 0xffffffff', () => parsePckIndex(header(0, { major: 0xffffffff }), 88), { code: 'VERSION', offset: 8 }],
    ['200,001 files', () => parsePckIndex(header(PCK_LIMITS.maxFiles + 1), 88), { code: 'LIMIT', offset: 84 }],
    ['0xffffffff files', () => parsePckIndex(header(0xffffffff), 88), { code: 'LIMIT', offset: 84 }],
    ['exactly 200,000 files is within the limit (the index is then simply cut)', () => parsePckIndex(header(PCK_LIMITS.maxFiles), 88), { code: 'TRUNCATED', offset: 88 }],
    ['one file and no entry bytes', () => parsePckIndex(header(1), 88), { code: 'TRUNCATED', offset: 88 }],
    ['one file and three entry bytes', () => parsePckIndex(cat(header(1), new Uint8Array(3)), 91), { code: 'TRUNCATED', offset: 91 }],
    ['exactly four bytes left reads the path length: 0 is FORMAT', () => parsePckIndex(cat(header(1), new Uint8Array(4)), 92), { code: 'FORMAT', offset: 88 }],
    ['path length 1025 is LIMIT even with nothing after it', () => parsePckIndex(cat(header(1), Uint8Array.of(0x01, 0x04, 0, 0)), 92), { code: 'LIMIT', offset: 88 }],
    ['one byte short of path_len + 32 is TRUNCATED', () => parsePckIndex(one.bytes.subarray(0, one.bytes.length - 1), one.fileSize), { code: 'TRUNCATED', offset: one.bytes.length - 1 }],
    ['exactly path_len + 32 bytes parses', () => parsePckIndex(one.bytes, one.fileSize), 'ok'],
  ];
  it.each(cases)('%s', (_name, run, expected) => {
    expect(outcome(run)).toEqual(expected);
  });

  it('reports the Godot version fields from their own offsets (distinct values)', () => {
    const index = parsePckIndex(header(0, { major: 3, minor: 5, rev: 7 }), 88);
    expect(index.godotVersion).toEqual([3, 5, 7]);
    expect(index.indexEnd).toBe(88);
    expect(index.fileSize).toBe(88);
    expect(index.entries.size).toBe(0);
  });

  it('an 88-byte prefix with zero files is a complete, empty index', () => {
    const index = parsePckIndex(header(0), 88);
    expect(index.entries.size).toBe(0);
    expect(index.indexEnd).toBe(88);
  });
});

describe('parsePckIndex: path field boundaries', () => {
  const okPath = (path: string): Outcome => {
    const { bytes, fileSize } = oneEntry(path);
    return outcome(() => parsePckIndex(bytes, fileSize));
  };

  it('a path of exactly 1024 bytes is accepted, 1025 is LIMIT', () => {
    const path = 'res://' + 'a'.repeat(1018);
    expect(enc.encode(path).length).toBe(1024);
    expect(okPath(path)).toBe('ok');
    const field = new Uint8Array(1025).fill(0x61);
    expect(outcome(() => parsePckIndex(cat(header(1), entry(field, 2000n, 0n)), 2000))).toEqual({ code: 'LIMIT', offset: 88 });
  });

  it('control characters: U+001F is refused, U+0020 and U+007E are fine, U+007F is refused, U+0080 is fine', () => {
    expect(okPath('res://a\u001fb')).toEqual({ code: 'FORMAT', offset: 88 });
    expect(okPath('res://a b')).toBe('ok');
    expect(okPath('res://a~b')).toBe('ok');
    expect(okPath('res://a\u007fb')).toEqual({ code: 'FORMAT', offset: 88 });
    expect(okPath('res://a\u0080b')).toBe('ok');
  });

  it('every FORMAT path defect names the start of its own entry', () => {
    // Two entries: the first valid, the second defective; the defect is reported at the second entry's start.
    const first = padded(enc.encode('res://ok'));
    const firstEntry = entry(first, 0n, 0n);
    const second = (field: Uint8Array): Uint8Array => entry(field, 0n, 0n);
    const secondStart = 88 + firstEntry.length;
    const defects: Array<[string, Uint8Array]> = [
      ['no res:// prefix', padded(enc.encode('xes://a'))],
      ['res:// alone', padded(enc.encode('res://'))],
      ['a backslash', padded(enc.encode('res://a\\b'))],
      ['a dot segment', padded(enc.encode('res://a/./b'))],
      ['a dot-dot segment', padded(enc.encode('res://a/../b'))],
      ['an empty segment', padded(enc.encode('res://a//b'))],
      ['a trailing slash', padded(enc.encode('res://a/b/'))],
      ['invalid UTF-8', Uint8Array.of(0x72, 0x65, 0x73, 0x3a, 0x2f, 0x2f, 0xff, 0x00)],
      ['junk after the NUL', Uint8Array.of(0x72, 0x65, 0x73, 0x3a, 0x2f, 0x2f, 0x61, 0x00, 0x61, 0x00, 0x00, 0x00)],
      ['an empty path field', new Uint8Array(0)],
    ];
    for (const [name, field] of defects) {
      const dataStart = secondStart + 4 + field.length + 32;
      const bytes = cat(header(2), entry(first, BigInt(dataStart), 0n), second(field));
      expect({ name, result: outcome(() => parsePckIndex(bytes, dataStart)) }).toEqual({
        name,
        result: { code: 'FORMAT', offset: secondStart },
      });
    }
    // The same defect in the first entry is reported at offset 88.
    const bytes = cat(header(1), entry(padded(enc.encode('res://a//b')), 200n, 0n));
    expect(outcome(() => parsePckIndex(bytes, 200))).toEqual({ code: 'FORMAT', offset: 88 });
  });

  it('a duplicate path is reported at the second entry', () => {
    const field = padded(enc.encode('res://dup'));
    const e = entry(field, 0n, 0n);
    const dataStart = 88 + e.length * 2;
    const bytes = cat(header(2), entry(field, BigInt(dataStart), 0n), entry(field, BigInt(dataStart), 0n));
    expect(outcome(() => parsePckIndex(bytes, dataStart))).toEqual({ code: 'FORMAT', offset: 88 + e.length });
  });
});

describe('parsePckIndex: 64-bit offset and size boundaries', () => {
  const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const field = padded(enc.encode('res://big'));
  const indexEnd = 88 + 4 + field.length + 32;
  const parse = (offset: bigint, size: bigint, fileSize: number): Outcome =>
    outcome(() => parsePckIndex(cat(header(1), entry(field, offset, size)), fileSize));

  it('an offset of exactly 2^53 - 1 is representable and accepted when the file is that large', () => {
    expect(parse(SAFE, 0n, Number.MAX_SAFE_INTEGER)).toBe('ok');
  });
  it('an offset of 2^53 is RANGE', () => {
    expect(parse(SAFE + 1n, 0n, Number.MAX_SAFE_INTEGER)).toEqual({ code: 'RANGE', offset: 88 });
  });
  it('a size of 2^53 - 1 that still fits is accepted, one more byte is RANGE', () => {
    const size = SAFE - BigInt(indexEnd);
    expect(parse(BigInt(indexEnd), size, Number.MAX_SAFE_INTEGER)).toBe('ok');
    expect(parse(BigInt(indexEnd), size + 1n, Number.MAX_SAFE_INTEGER)).toEqual({ code: 'RANGE', offset: 88 });
    expect(parse(BigInt(indexEnd), SAFE + 1n, Number.MAX_SAFE_INTEGER)).toEqual({ code: 'RANGE', offset: 88 });
  });
  it('64-bit maxima are RANGE', () => {
    expect(parse(2n ** 64n - 1n, 0n, 1000)).toEqual({ code: 'RANGE', offset: 88 });
    expect(parse(BigInt(indexEnd), 2n ** 64n - 1n, 1000)).toEqual({ code: 'RANGE', offset: 88 });
  });
  it('a size of exactly 2^53 - 1 is representable: only the index rule judges it (offset 0 is inside the index)', () => {
    // A mutant that treats 2^53 - 1 as already too big would report RANGE at the entry (88) instead.
    expect(parse(0n, SAFE, Number.MAX_SAFE_INTEGER)).toEqual({ code: 'FORMAT', offset: 0 });
    expect(parse(0n, SAFE + 1n, Number.MAX_SAFE_INTEGER)).toEqual({ code: 'RANGE', offset: 88 });
  });
});

describe('loadPckIndex: source and argument validation', () => {
  const reads = (bytes: Uint8Array): ReturnType<typeof memorySource> => memorySource(bytes);

  it.each([
    ['NaN', Number.NaN],
    ['-1', -1],
    ['1.5', 1.5],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['2^53', 2 ** 53],
  ])('a source size of %s is SOURCE at offset 0 and nothing is read', async (_name, size) => {
    let called = 0;
    const source: ByteSource = {
      size,
      async read() {
        called += 1;
        return new Uint8Array(0);
      },
    };
    expect(await outcomeAsync(() => loadPckIndex(source))).toEqual({ code: 'SOURCE', offset: 0 });
    expect(called).toBe(0);
  });

  it('a source size that is not a number at all is SOURCE', async () => {
    const source = { size: '88', read: async () => new Uint8Array(88) } as unknown as ByteSource;
    expect(await outcomeAsync(() => loadPckIndex(source))).toEqual({ code: 'SOURCE', offset: 0 });
  });

  it('sizes below the header are TRUNCATED at the size, with no read', async () => {
    for (const size of [0, 1, 87]) {
      const source = reads(new Uint8Array(size));
      expect(await outcomeAsync(() => loadPckIndex(source))).toEqual({ code: 'TRUNCATED', offset: size });
      expect(source.calls).toEqual([]);
    }
  });

  it('a header-only source of exactly 88 bytes loads with one read of 88 bytes; 89 bytes with one read of 89', async () => {
    const s88 = reads(header(0));
    const i88 = await loadPckIndex(s88);
    expect(i88.indexEnd).toBe(88);
    expect(s88.calls).toEqual([{ offset: 0, length: 88 }]);
    const s89 = reads(cat(header(0), Uint8Array.of(7)));
    const i89 = await loadPckIndex(s89);
    expect(i89.fileSize).toBe(89);
    expect(s89.calls).toEqual([{ offset: 0, length: 89 }]);
  });

  it.each([
    ['NaN', Number.NaN],
    ['-1', -1],
    ['1.5', 1.5],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['one above the global limit', PCK_LIMITS.maxIndexBytes + 1],
  ])('maxIndexBytes %s is LIMIT at offset 0 and nothing is read', async (_name, value) => {
    const source = reads(header(0));
    expect(await outcomeAsync(() => loadPckIndex(source, value))).toEqual({ code: 'LIMIT', offset: 0 });
    expect(source.calls).toEqual([]);
  });

  it('maxIndexBytes can be the global limit itself or zero', async () => {
    expect((await loadPckIndex(reads(header(0)), PCK_LIMITS.maxIndexBytes)).indexEnd).toBe(88);
    expect((await loadPckIndex(reads(header(0)), 0)).indexEnd).toBe(88);
  });
});

describe('loadPckIndex: the cap is exactly maxIndexBytes + 88 and growth is by doubling', () => {
  // Five small entries: index bytes = 5 * 52 = 260, so indexEnd = 348.
  const archive = buildPck(Array.from({ length: 5 }, (_, i) => ({ path: `res://t/${i}.png`, data: Uint8Array.of(i) })));
  const indexEnd = parsePckIndex(archive, archive.length).indexEnd;

  it('has the layout this block relies on', () => {
    expect(indexEnd).toBe(348);
    expect(archive.length).toBeGreaterThan(indexEnd);
  });

  it('an index of exactly the cap loads; one byte less allowed is LIMIT at the cap', async () => {
    const exact = memorySource(archive);
    expect((await loadPckIndex(exact, indexEnd - 88)).entries.size).toBe(5);
    expect(exact.calls).toEqual([{ offset: 0, length: indexEnd }]);
    const tight = memorySource(archive);
    expect(await outcomeAsync(() => loadPckIndex(tight, indexEnd - 89))).toEqual({ code: 'LIMIT', offset: indexEnd - 1 });
    expect(tight.calls).toEqual([{ offset: 0, length: indexEnd - 1 }]);
    const loose = memorySource(archive);
    expect((await loadPckIndex(loose, indexEnd - 87)).entries.size).toBe(5);
    expect(loose.calls).toEqual([{ offset: 0, length: indexEnd + 1 }]);
  });

  it('a zero allowance admits only an empty index', async () => {
    expect(await outcomeAsync(() => loadPckIndex(memorySource(archive), 0))).toEqual({ code: 'LIMIT', offset: 88 });
  });

  it('a file cut short inside the index is TRUNCATED, not LIMIT, when the file ends before the cap', async () => {
    // Two complete entries (offset 0, size 0: they fit any file), then a third whose path field is cut.
    const field = padded(enc.encode('res://t'));
    const cut = cat(header(3), entry(field, 0n, 0n), entry(padded(enc.encode('res://u')), 0n, 0n), Uint8Array.of(8, 0, 0, 0, 0x72, 0x65));
    expect(await outcomeAsync(() => loadPckIndex(memorySource(cut)))).toEqual({ code: 'TRUNCATED', offset: cut.length });
  });

  it('an archive cut inside its index, whose early entries then point past the new end, is RANGE', async () => {
    expect(await outcomeAsync(() => loadPckIndex(memorySource(archive.subarray(0, 300))))).toEqual({ code: 'RANGE', offset: 88 });
  });

  it('reads 65,536 bytes first, then doubles the amount read, clamped to the file size', async () => {
    const big = buildPck(Array.from({ length: 6000 }, (_, i) => ({ path: `res://t/${String(i).padStart(5, '0')}.png`, data: Uint8Array.of(i & 255) })));
    const need = parsePckIndex(big, big.length).indexEnd;
    expect(need).toBeGreaterThan(262_144);
    expect(need).toBeLessThan(big.length);
    const source = memorySource(big);
    const index = await loadPckIndex(source);
    expect(index.indexEnd).toBe(need);
    const totals: number[] = [];
    for (let want = Math.min(65_536, big.length); ; want = Math.min(want * 2, big.length)) {
      totals.push(want);
      if (want >= need) break;
    }
    const expected: Array<{ offset: number; length: number }> = [];
    let have = 0;
    for (const t of totals) {
      expected.push({ offset: have, length: t - have });
      have = t;
    }
    expect(expected.length).toBeGreaterThanOrEqual(4);
    expect(source.calls).toEqual(expected);
  });
});

describe('loadPckIndex: errors other than TRUNCATED pass through after exactly one read', () => {
  const pad = (bytes: Uint8Array): Uint8Array => cat(bytes, new Uint8Array(200_000 - bytes.length));
  const goodEntry = (): Uint8Array => entry(padded(enc.encode('res://a')), 200_000n, 0n);
  const cases: Array<[string, Uint8Array, string, number]> = [
    ['bad magic', pad(header(0, { magic: [1, 2, 3, 4] })), 'MAGIC', 0],
    ['pack version 2', pad(header(0, { version: 2 })), 'VERSION', 4],
    ['Godot major 4', pad(header(0, { major: 4 })), 'VERSION', 8],
    ['too many files', pad(header(PCK_LIMITS.maxFiles + 1)), 'LIMIT', 84],
    ['empty path', pad(cat(header(1), new Uint8Array(4))), 'FORMAT', 88],
    ['path with a dot segment', pad(cat(header(1), entry(padded(enc.encode('res://a/../b')), 200_000n, 0n))), 'FORMAT', 88],
    ['entry past the end of the file', pad(cat(header(1), entry(padded(enc.encode('res://a')), 200_000n, 1n))), 'RANGE', 88],
    ['entry inside the index', pad(cat(header(1), entry(padded(enc.encode('res://a')), 90n, 0n))), 'FORMAT', 90],
  ];
  it.each(cases)('%s', async (_name, bytes, code, offset) => {
    const source = memorySource(bytes);
    expect(await outcomeAsync(() => loadPckIndex(source))).toEqual({ code, offset });
    expect(source.calls).toEqual([{ offset: 0, length: 65_536 }]);
  });

  it('a good entry in the same layout loads (control for the table above)', async () => {
    const source = memorySource(pad(cat(header(1), goodEntry())));
    expect((await loadPckIndex(source)).entries.size).toBe(1);
  });

  it('a short or throwing source is SOURCE with the offset already held', async () => {
    const lying: ByteSource = { size: 10_000_000_000, read: async () => new Uint8Array(10) };
    expect(await outcomeAsync(() => loadPckIndex(lying))).toEqual({ code: 'SOURCE', offset: 0 });
    const notBytes: ByteSource = { size: 1000, read: async () => [] as unknown as Uint8Array };
    expect(await outcomeAsync(() => loadPckIndex(notBytes))).toEqual({ code: 'SOURCE', offset: 0 });
  });
});

describe('isPckDataPath and readPckEntry: the extension gate', () => {
  const archive = buildPck([
    { path: 'res://a/pic.wonderdraft_image', data: Uint8Array.of(1, 2, 3) },
    { path: 'res://a/empty.png', data: new Uint8Array(0) },
    { path: 'res://a/script.gdc', data: Uint8Array.of(9) },
  ]);
  const source = memorySource(archive);
  const indexPromise = loadPckIndex(source);

  it('every allowed extension passes and nothing else does', () => {
    for (const ext of PCK_DATA_EXTENSIONS) expect(isPckDataPath('res://x/y' + ext)).toBe(true);
    for (const bad of ['res://x.gdc', 'res://x.GDC', 'res://x.wonderdraft_imageX', 'res://x.png.gdc', 'res://x', '', '.png ', 'png']) {
      expect(isPckDataPath(bad)).toBe(false);
    }
  });

  it('a value that is not a string is not a data path', () => {
    for (const bad of [42, null, undefined, {}, ['a.png'], { endsWith: () => true }, true]) {
      expect(isPckDataPath(bad as unknown as string)).toBe(false);
    }
  });

  it('a path that is not a string is EXTENSION at offset 0 and nothing is read', async () => {
    const index = await indexPromise;
    const fresh = memorySource(archive);
    expect(await outcomeAsync(() => readPckEntry(fresh, index, 42 as unknown as string))).toEqual({ code: 'EXTENSION', offset: 0 });
    expect(fresh.calls).toEqual([]);
  });

  it('EXTENSION, MISSING, LIMIT and RANGE carry their documented offsets', async () => {
    const index = await indexPromise;
    const pic = index.entries.get('res://a/pic.wonderdraft_image');
    expect(pic).toBeDefined();
    const at = (pic as { offset: number }).offset;
    const s = memorySource(archive);
    expect(await outcomeAsync(() => readPckEntry(s, index, 'res://a/script.gdc'))).toEqual({ code: 'EXTENSION', offset: 0 });
    expect(await outcomeAsync(() => readPckEntry(s, index, 'res://a/none.png'))).toEqual({ code: 'MISSING', offset: 0 });
    expect(await outcomeAsync(() => readPckEntry(s, index, 'res://a/pic.wonderdraft_image', 2))).toEqual({ code: 'LIMIT', offset: at });
    const other = memorySource(new Uint8Array(archive.length + 1));
    expect(await outcomeAsync(() => readPckEntry(other, index, 'res://a/pic.wonderdraft_image'))).toEqual({ code: 'RANGE', offset: at });
    expect(s.calls).toEqual([]);
    expect(other.calls).toEqual([]);
  });

  it('maxBytes: an entry of exactly maxBytes reads, one more is LIMIT, zero reads an empty entry', async () => {
    const index = await indexPromise;
    const s = memorySource(archive);
    expect(await readPckEntry(s, index, 'res://a/pic.wonderdraft_image', 3)).toEqual(Uint8Array.of(1, 2, 3));
    expect(await outcomeAsync(() => readPckEntry(s, index, 'res://a/pic.wonderdraft_image', 2))).toMatchObject({ code: 'LIMIT' });
    expect((await readPckEntry(s, index, 'res://a/empty.png', 0)).length).toBe(0);
    expect(await outcomeAsync(() => readPckEntry(s, index, 'res://a/empty.png', 0))).toBe('ok');
  });

  it.each([
    ['NaN', Number.NaN],
    ['-1', -1],
    ['1.5', 1.5],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['2^53', 2 ** 53],
  ])('maxBytes %s is LIMIT at the entry offset and nothing is read', async (_name, value) => {
    const index = await indexPromise;
    const at = (index.entries.get('res://a/empty.png') as { offset: number }).offset;
    const s = memorySource(archive);
    expect(await outcomeAsync(() => readPckEntry(s, index, 'res://a/empty.png', value))).toEqual({ code: 'LIMIT', offset: at });
    expect(s.calls).toEqual([]);
  });
});

describe('readPckEntry: guards against a forged index', () => {
  const S = 100;
  const forged = (offset: number, size: number): PckIndex => ({
    godotVersion: [3, 0, 0],
    fileSize: S,
    indexEnd: 88,
    entries: new Map([['res://f.png', { path: 'res://f.png', offset, size }]]),
  });
  const bytes = Uint8Array.from({ length: S }, (_, i) => i);
  const run = (offset: number, size: number, maxBytes?: number): Promise<Outcome> => {
    const source = memorySource(bytes);
    return outcomeAsync(() => readPckEntry(source, forged(offset, size), 'res://f.png', maxBytes));
  };

  it.each([
    ['offset NaN', Number.NaN, 4],
    ['offset -1', -1, 4],
    ['offset 1.5', 1.5, 4],
    ['offset Infinity', Number.POSITIVE_INFINITY, 4],
    ['size NaN', 10, Number.NaN],
    ['size -1', 10, -1],
    ['size 1.5', 10, 1.5],
    ['size larger than the source', 10, S + 1],
    ['offset + size one past the end', S - 3, 4],
    ['offset past the end', S + 1, 0],
  ])('%s is RANGE at the entry offset', async (_name, offset, size) => {
    const result = await run(offset, size);
    expect(result).toEqual({ code: 'RANGE', offset });
  });

  it('exactly fitting entries read: offset + size == source size, size == source size, offset == source size with size 0', async () => {
    const source = memorySource(bytes);
    expect(await readPckEntry(source, forged(S - 4, 4), 'res://f.png')).toEqual(bytes.subarray(S - 4));
    expect(await readPckEntry(source, forged(0, S), 'res://f.png')).toEqual(bytes);
    expect((await readPckEntry(source, forged(S, 0), 'res://f.png')).length).toBe(0);
    expect((await readPckEntry(source, forged(0, 0), 'res://f.png')).length).toBe(0);
  });

  it('the size limit is judged before the range', async () => {
    expect(await run(S - 3, 4, 3)).toEqual({ code: 'LIMIT', offset: S - 3 });
  });
});

describe('readPckEntry: what the source returns must be exactly the requested bytes', () => {
  const archive = buildPck([{ path: 'res://s.png', data: Uint8Array.of(5, 6, 7, 8) }]);
  const indexOf = (): Promise<PckIndex> => loadPckIndex(memorySource(archive));
  const withRead = (read: ByteSource['read']): ByteSource => ({ size: archive.length, read });

  it('a plain array of the right length is SOURCE', async () => {
    const index = await indexOf();
    const at = (index.entries.get('res://s.png') as { offset: number }).offset;
    const source = withRead(async () => [5, 6, 7, 8] as unknown as Uint8Array);
    expect(await outcomeAsync(() => readPckEntry(source, index, 'res://s.png'))).toEqual({ code: 'SOURCE', offset: at });
  });
  it('an ArrayBuffer of the right length is SOURCE', async () => {
    const index = await indexOf();
    const source = withRead(async () => new ArrayBuffer(4) as unknown as Uint8Array);
    expect(await outcomeAsync(() => readPckEntry(source, index, 'res://s.png'))).toMatchObject({ code: 'SOURCE' });
  });
  it('a Uint8Array one byte short or one byte long is SOURCE', async () => {
    const index = await indexOf();
    for (const n of [3, 5]) {
      const source = withRead(async () => new Uint8Array(n));
      expect(await outcomeAsync(() => readPckEntry(source, index, 'res://s.png'))).toMatchObject({ code: 'SOURCE' });
    }
  });
  it('a Node Buffer (a Uint8Array subclass) of the right length is accepted', async () => {
    const index = await indexOf();
    const source = withRead(async () => Buffer.from([5, 6, 7, 8]));
    expect(Array.from(await readPckEntry(source, index, 'res://s.png'))).toEqual([5, 6, 7, 8]);
  });
  it('the request is exactly (entry.offset, entry.size)', async () => {
    const index = await indexOf();
    const source = memorySource(archive);
    await readPckEntry(source, index, 'res://s.png');
    const e = index.entries.get('res://s.png') as { offset: number; size: number };
    expect(source.calls).toEqual([{ offset: e.offset, length: e.size }]);
  });
});
