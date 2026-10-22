import { describe, expect, it } from 'vitest';
import {
  PckError,
  PCK_DATA_EXTENSIONS,
  PCK_LIMITS,
  isPckDataPath,
  loadPckIndex,
  parsePckIndex,
  readPckEntry,
} from '../../src/core/assets/pck.ts';
import type { PckErrorCode } from '../../src/core/assets/pck.ts';
import { buildPck, memorySource } from '../helpers/pck-synthetic.ts';

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectCode(fn: () => unknown, code: PckErrorCode): PckError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PckError);
    expect((error as PckError).code).toBe(code);
    return error as PckError;
  }
  throw new Error(`expected PckError ${code}, but nothing was thrown`);
}

async function expectAsyncCode(fn: () => Promise<unknown>, code: PckErrorCode): Promise<PckError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PckError);
    expect((error as PckError).code).toBe(code);
    return error as PckError;
  }
  throw new Error(`expected PckError ${code}, but nothing was thrown`);
}

const A = new Uint8Array([1, 2, 3, 4]);
const B = new Uint8Array([5, 6, 7, 8, 9]);
const C = new Uint8Array([10, 11]);

function threeEntryArchive(gap = 8): Uint8Array {
  return buildPck(
    [
      { path: 'res://sprites/trees/test_set/tree_01.wonderdraft_image', data: A },
      { path: 'res://sprites/trees/test_set/tree_02.wonderdraft_image', data: B },
      { path: 'res://data/notes.csv', data: C },
    ],
    { gapAfterIndex: gap },
  );
}

function fieldView(file: Uint8Array): DataView {
  return new DataView(file.buffer, file.byteOffset, file.byteLength);
}

function firstEntryLayout(file: Uint8Array): { pathLen: number; pathAt: number; offsetAt: number; sizeAt: number } {
  const view = fieldView(file);
  const pathLen = view.getUint32(88, true);
  const pathAt = 92;
  const offsetAt = pathAt + pathLen;
  return { pathLen, pathAt, offsetAt, sizeAt: offsetAt + 8 };
}

describe('parse a small archive', () => {
  it('reports versions, fileSize, indexEnd and every entry', () => {
    const file = threeEntryArchive();
    const index = parsePckIndex(file, file.length);
    expect([...index.godotVersion]).toEqual([3, 0, 0]);
    expect(index.fileSize).toBe(file.length);
    const first = firstEntryLayout(file);
    const secondPath = 'res://sprites/trees/test_set/tree_02.wonderdraft_image';
    const secondLen = secondPath.length + ((4 - (secondPath.length % 4)) % 4);
    const thirdPath = 'res://data/notes.csv';
    const thirdLen = thirdPath.length + ((4 - (thirdPath.length % 4)) % 4);
    const indexEnd = 88 + (4 + first.pathLen + 32) + (4 + secondLen + 32) + (4 + thirdLen + 32);
    expect(index.indexEnd).toBe(indexEnd);
    const keys = [...index.entries.keys()];
    expect(keys).toEqual([
      'res://sprites/trees/test_set/tree_01.wonderdraft_image',
      'res://sprites/trees/test_set/tree_02.wonderdraft_image',
      'res://data/notes.csv',
    ]);
    const e0 = index.entries.get(keys[0])!;
    expect(e0.offset).toBe(indexEnd + 8);
    expect(e0.size).toBe(4);
    const e1 = index.entries.get(keys[1])!;
    expect(e1.offset).toBe(indexEnd + 8 + 4);
    expect(e1.size).toBe(5);
    const e2 = index.entries.get(keys[2])!;
    expect(e2.offset).toBe(indexEnd + 8 + 4 + 5);
    expect(e2.size).toBe(2);
  });

  it('reads back the exact bytes of every entry', async () => {
    const file = threeEntryArchive();
    const source = memorySource(file);
    const index = parsePckIndex(file, file.length);
    await expect(readPckEntry(source, index, 'res://sprites/trees/test_set/tree_01.wonderdraft_image')).resolves.toEqual(A);
    await expect(readPckEntry(source, index, 'res://sprites/trees/test_set/tree_02.wonderdraft_image')).resolves.toEqual(B);
    await expect(readPckEntry(source, index, 'res://data/notes.csv')).resolves.toEqual(C);
  });

  it.each([0, 8, 4096])('accepts a gap of %i bytes after the index', async (gap) => {
    const file = threeEntryArchive(gap);
    const index = parsePckIndex(file, file.length);
    for (const entry of index.entries.values()) {
      expect(entry.offset).toBeGreaterThanOrEqual(index.indexEnd);
      expect(entry.offset).toBeGreaterThanOrEqual(index.indexEnd + gap);
    }
    const source = memorySource(file);
    await expect(
      readPckEntry(source, index, 'res://sprites/trees/test_set/tree_01.wonderdraft_image'),
    ).resolves.toEqual(A);
  });

  it('accepts a path whose length needs no padding (no NUL in the field)', async () => {
    const path = 'res://ab.csv'; // 12 bytes: already a multiple of 4
    expect(path.length % 4).toBe(0);
    const file = buildPck([{ path, data: A }]);
    const index = parsePckIndex(file, file.length);
    expect([...index.entries.keys()]).toEqual([path]);
    await expect(readPckEntry(memorySource(file), index, path)).resolves.toEqual(A);
  });

  it('exposes the frozen limits and data extensions', () => {
    expect(PCK_LIMITS).toEqual({ maxFiles: 200_000, maxPathBytes: 1024, maxIndexBytes: 67_108_864, maxEntryBytes: 268_435_456 });
    expect(Object.isFrozen(PCK_LIMITS)).toBe(true);
    expect([...PCK_DATA_EXTENSIONS]).toEqual([
      '.wonderdraft_image',
      '.wonderdraft_symbols',
      '.wonderdraft_theme',
      '.wonderdraft_9patch',
      '.ttf',
      '.otf',
      '.csv',
      '.png',
    ]);
    expect(Object.isFrozen(PCK_DATA_EXTENSIONS)).toBe(true);
  });
});

describe('hostile archives with exact codes', () => {
  const cases: Array<{ name: string; code: PckErrorCode; make: () => { prefix: Uint8Array; size: number } }> = [
    {
      name: 'wrong magic',
      code: 'MAGIC',
      make: () => {
        const file = threeEntryArchive().slice();
        file[0] = 0x58;
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'pack_version 2',
      code: 'VERSION',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(4, 2, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'godot major 2',
      code: 'VERSION',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(8, 2, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'godot major 4',
      code: 'VERSION',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(8, 4, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'file_count above the limit',
      code: 'LIMIT',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(84, 200_001, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'file_count larger than the data holds',
      code: 'TRUNCATED',
      make: () => {
        // An empty member with no gap ends exactly at indexEnd, so the next
        // header the inflated file_count promises is simply absent.
        const file = buildPck(
          [{ path: 'res://a/b.wonderdraft_image', data: new Uint8Array(0) }],
          { gapAfterIndex: 0 },
        ).slice();
        fieldView(file).setUint32(84, 50, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'path_len 0',
      code: 'FORMAT',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(88, 0, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'path_len above the limit',
      code: 'LIMIT',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(88, 1025, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'path_len running past the end',
      code: 'TRUNCATED',
      make: () => {
        const file = threeEntryArchive().slice();
        fieldView(file).setUint32(88, 1000, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'NUL followed by junk',
      code: 'FORMAT',
      make: () => {
        const file = threeEntryArchive().slice();
        const path = 'res://sprites/trees/test_set/tree_01.wonderdraft_image';
        file[92 + path.length + 1] = 0x41;
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'invalid UTF-8 in the path',
      code: 'FORMAT',
      make: () => {
        const file = threeEntryArchive().slice();
        file[92] = 0xff;
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'no res:// prefix',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'foo/bar.wonderdraft_image', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'path that is only res://',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'dotdot segment',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://a/../b.wonderdraft_image', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'dot segment',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://a/./b.wonderdraft_image', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'empty segment',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://a//b.wonderdraft_image', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'trailing slash',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://a/b/', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'backslash',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://a\\b.wonderdraft_image', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'control character',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([{ path: 'res://a/b\x01c.wonderdraft_image', data: A }]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'duplicate path',
      code: 'FORMAT',
      make: () => {
        const file = buildPck([
          { path: 'res://a/b.wonderdraft_image', data: A },
          { path: 'res://a/b.wonderdraft_image', data: B },
        ]);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'offset + size beyond the file',
      code: 'RANGE',
      make: () => {
        const file = threeEntryArchive().slice();
        const layout = firstEntryLayout(file);
        fieldView(file).setBigUint64(layout.sizeAt, BigInt(file.length), true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'offset above 2^53',
      code: 'RANGE',
      make: () => {
        const file = threeEntryArchive().slice();
        const layout = firstEntryLayout(file);
        fieldView(file).setBigUint64(layout.offsetAt, (1n << 53n) + 1n, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'size above 2^53',
      code: 'RANGE',
      make: () => {
        const file = threeEntryArchive().slice();
        const layout = firstEntryLayout(file);
        fieldView(file).setBigUint64(layout.sizeAt, (1n << 53n) + 1n, true);
        return { prefix: file, size: file.length };
      },
    },
    {
      name: 'offset inside the index',
      code: 'FORMAT',
      make: () => {
        const file = threeEntryArchive().slice();
        const layout = firstEntryLayout(file);
        fieldView(file).setBigUint64(layout.offsetAt, 88n, true);
        return { prefix: file, size: file.length };
      },
    },
  ];

  it.each(cases)('$name gives $code', ({ make, code }) => {
    const { prefix, size } = make();
    expectCode(() => parsePckIndex(prefix, size), code);
  });
});

describe('truncation sweep', () => {
  it('every short prefix is TRUNCATED and only the full index parses', () => {
    const file = buildPck([
      { path: 'res://a/first.wonderdraft_image', data: A },
      { path: 'res://b/second.csv', data: B },
    ]);
    const full = parsePckIndex(file, file.length);
    for (let len = 0; len <= full.indexEnd; len++) {
      if (len === full.indexEnd) {
        expect(parsePckIndex(file.subarray(0, len), file.length).indexEnd).toBe(full.indexEnd);
      } else {
        expectCode(() => parsePckIndex(file.subarray(0, len), file.length), 'TRUNCATED');
      }
    }
  });
});

function mutateArchive(base: Uint8Array, rnd: () => number): Uint8Array {
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
  it('1000 mutations throw only PckError and keep the invariants', () => {
    const base = buildPck([
      { path: 'res://sprites/trees/fuzz_set/oak_01.wonderdraft_image', data: new Uint8Array([9, 8, 7, 6, 5]) },
      { path: 'res://sprites/symbols/fuzz_set/town_01.wonderdraft_image', data: new Uint8Array([1, 1, 2, 3]) },
      { path: 'res://data/fuzz.csv', data: new Uint8Array([104, 105]) },
    ]);
    const rnd = mulberry32(0x1e55ed);
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      const mut = mutateArchive(base, rnd);
      let index;
      try {
        index = parsePckIndex(mut, mut.length);
      } catch (error) {
        expect(error).toBeInstanceOf(PckError);
        continue;
      }
      ok++;
      for (const entry of index.entries.values()) {
        expect(entry.offset).toBeGreaterThanOrEqual(index.indexEnd);
        expect(entry.offset + entry.size).toBeLessThanOrEqual(index.fileSize);
        expect(entry.path.startsWith('res://')).toBe(true);
        expect(entry.path.includes('\\')).toBe(false);
        expect(entry.path.endsWith('/')).toBe(false);
        const segments = entry.path.slice('res://'.length).split('/');
        for (const segment of segments) {
          expect(segment.length).toBeGreaterThan(0);
          expect(segment).not.toBe('.');
          expect(segment).not.toBe('..');
        }
      }
    }
    expect(ok).toBeGreaterThan(0);
  });
});

describe('loadPckIndex', () => {
  it('starts with a clamped chunk and never leaves [0, size]', async () => {
    const file = threeEntryArchive();
    const source = memorySource(file);
    const index = await loadPckIndex(source);
    expect(index.entries.size).toBe(3);
    expect(source.calls.length).toBeGreaterThan(0);
    expect(source.calls[0]).toEqual({ offset: 0, length: Math.min(65_536, file.length) });
    for (const call of source.calls) {
      expect(call.offset).toBeGreaterThanOrEqual(0);
      expect(call.offset + call.length).toBeLessThanOrEqual(source.size);
    }
  });

  it('loads a 50,000-entry index in under 1 s with a bounded number of reads', async () => {
    const entries = [];
    for (let i = 0; i < 50_000; i++) {
      entries.push({ path: `res://data/bulk/file_${String(i).padStart(5, '0')}.csv`, data: new Uint8Array([i & 0xff]) });
    }
    const file = buildPck(entries);
    const source = memorySource(file);
    const start = Date.now();
    const index = await loadPckIndex(source);
    const elapsed = Date.now() - start;
    expect(index.entries.size).toBe(50_000);
    expect(source.calls.length).toBeLessThanOrEqual(12);
    expect(elapsed).toBeLessThan(1000);
  });

  it('a short read gives SOURCE', async () => {
    const file = threeEntryArchive();
    const inner = memorySource(file);
    const short: typeof inner = {
      size: inner.size,
      calls: inner.calls,
      async read(offset: number, length: number): Promise<Uint8Array> {
        inner.calls.push({ offset, length });
        const full = await inner.read(offset, length);
        return full.subarray(0, full.length - 1);
      },
    };
    await expectAsyncCode(() => loadPckIndex(short), 'SOURCE');
  });

  it('a truncated file gives TRUNCATED', async () => {
    const file = threeEntryArchive();
    // Cut inside the first entry's path field: no complete entry points past
    // the cut yet, so the parser reports missing bytes, not RANGE.
    const cut = file.subarray(0, 100);
    await expectAsyncCode(() => loadPckIndex(memorySource(cut)), 'TRUNCATED');
  });

  it('a source smaller than the header gives TRUNCATED', async () => {
    await expectAsyncCode(() => loadPckIndex(memorySource(new Uint8Array(10))), 'TRUNCATED');
  });
});

describe('readPckEntry gate', () => {
  const denied = [
    'res://scripts/ai.gdc',
    'res://shaders/water.shader',
    'res://data/pack.remap',
    'res://data/pack.import',
    'res://textures/a.stex',
    'res://scenes/a.res',
    'res://materials/a.material',
    'res://sounds/a.sample',
    'res://data/key.pem',
    'res://data/blob.binary',
    'res://data/noextension',
  ];

  it.each(denied)('%s is refused with EXTENSION before any read', async (path) => {
    const file = buildPck([{ path, data: A }]);
    const source = memorySource(file);
    const index = parsePckIndex(file, file.length);
    expect(index.entries.has(path)).toBe(true);
    const before = source.calls.length;
    await expectAsyncCode(() => readPckEntry(source, index, path), 'EXTENSION');
    expect(source.calls.length).toBe(before);
  });

  it('every allowed extension reads', async () => {
    const entries = PCK_DATA_EXTENSIONS.map((ext: string, i: number) => ({
      path: ext === '.wonderdraft_symbols' ? `res://sprites/trees/set_${i}/.wonderdraft_symbols` : `res://data/file_${i}${ext}`,
      data: new Uint8Array([i, i + 1, i + 2]),
    }));
    const file = buildPck(entries);
    const source = memorySource(file);
    const index = parsePckIndex(file, file.length);
    for (const entry of entries) {
      await expect(readPckEntry(source, index, entry.path)).resolves.toEqual(entry.data);
    }
    expect(isPckDataPath('res://sprites/trees/oak/.wonderdraft_symbols')).toBe(true);
    expect(isPckDataPath('res://scripts/ai.gdc')).toBe(false);
  });

  it('missing paths give MISSING', async () => {
    const file = threeEntryArchive();
    const source = memorySource(file);
    const index = parsePckIndex(file, file.length);
    await expectAsyncCode(() => readPckEntry(source, index, 'res://nope/missing.wonderdraft_image'), 'MISSING');
  });

  it('oversize entries give LIMIT', async () => {
    const file = threeEntryArchive();
    const source = memorySource(file);
    const index = parsePckIndex(file, file.length);
    await expectAsyncCode(
      () => readPckEntry(source, index, 'res://sprites/trees/test_set/tree_02.wonderdraft_image', 2),
      'LIMIT',
    );
  });

  it('a stale index gives RANGE', async () => {
    const file = threeEntryArchive();
    const index = parsePckIndex(file, file.length);
    const other = memorySource(file.subarray(0, file.length - 4));
    await expectAsyncCode(
      () => readPckEntry(other, index, 'res://sprites/trees/test_set/tree_01.wonderdraft_image'),
      'RANGE',
    );
    const lying = {
      godotVersion: index.godotVersion,
      fileSize: file.length,
      indexEnd: index.indexEnd,
      entries: new Map([
        ['res://a/b.wonderdraft_image', { path: 'res://a/b.wonderdraft_image', offset: file.length - 5, size: 10 }],
      ]),
    };
    await expectAsyncCode(
      () => readPckEntry(memorySource(file), lying, 'res://a/b.wonderdraft_image'),
      'RANGE',
    );
  });
});
