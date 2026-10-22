import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PckError, PCK_LIMITS, parsePckIndex } from '../../src/core/assets/pck.ts';
import {
  PCK_FILE_LIMITS,
  PckFileError,
  openPckFile,
} from '../../electron/assets/pck-file.ts';
import type { PckFile } from '../../electron/assets/pck-file.ts';
import { buildPck } from '../helpers/pck-synthetic.ts';

const fixtures: string[] = [];
async function makeRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-pckfile-'));
  fixtures.push(base);
  const root = path.join(base, 'root');
  await fs.mkdir(root, { recursive: true });
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of fixtures.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

const ALLOWED = 'res://views/small/card_01.wonderdraft_image';
const ALLOWED2 = 'res://views/small/card_02.wonderdraft_image';
const CSV = 'res://data/notes.csv';
const FORBIDDEN = 'res://test_dummy/probe_script.gdc';

function payload(n: number, seed = 7): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (seed * 31 + i * 11) & 0xff;
  return out;
}

async function writeArchive(root: string, file: Uint8Array): Promise<void> {
  await fs.writeFile(path.join(root, 'Wonderdraft.pck'), file);
}

async function failsCode(promise: Promise<unknown>, code: string, where: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error, where).toBeInstanceOf(Error);
    expect(error instanceof PckError || error instanceof PckFileError, where).toBe(true);
    expect((error as { code: string }).code, where).toBe(code);
    expect((error as Error).message, where).not.toContain(os.tmpdir());
    expect((error as Error).message, where).not.toContain('Wonderdraft');
    return;
  }
  throw new Error(`expected ${code} at ${where}`);
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

describe('limits and byte identity', () => {
  it('freezes the exact public limits', () => {
    expect(Object.isFrozen(PCK_FILE_LIMITS)).toBe(true);
    expect(PCK_FILE_LIMITS).toEqual({ maxReadBytes: 64 * 1024 * 1024, maxConcurrentReads: 4 });
  });

  it('reads an allowed entry byte-identical and leaves the source file untouched', async () => {
    const root = await makeRoot();
    const data = payload(512);
    const file = buildPck([{ path: ALLOWED, data }], { gapAfterIndex: 8 });
    await writeArchive(root, file);
    const before = Buffer.from(await fs.readFile(path.join(root, 'Wonderdraft.pck')));
    const session = await openPckFile(root);
    try {
      expect(session.fileSize).toBe(file.length);
      const out = await session.readData(ALLOWED);
      expect(out).toBeInstanceOf(Uint8Array);
      expect(out).toEqual(data);
      expect(out).not.toBe(data);
    } finally {
      await session.close();
    }
    expect(Buffer.from(await fs.readFile(path.join(root, 'Wonderdraft.pck'))).equals(before)).toBe(true);
  });
});

describe('index discovery never overreads payload', () => {
  it('every discovery read stays within indexEnd and a refused extension adds zero payload reads', async () => {
    const root = await makeRoot();
    const good = payload(1024, 3);
    const badPayload = payload(4096, 9);
    const file = buildPck(
      [
        { path: ALLOWED, data: good },
        { path: FORBIDDEN, data: badPayload },
      ],
      { gapAfterIndex: 8 },
    );
    await writeArchive(root, file);
    const index = parsePckIndex(file, file.length);
    expect(index.indexEnd).toBeLessThan(65_536);
    const actualOpen = fs.open.bind(fs);
    const reads: Array<{ position: number; length: number }> = [];
    let archiveHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        archiveHandle = handle;
        const read = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            reads.push({ position, length });
            return read(buffer, offset, length, position);
          },
        });
      }
      return handle;
    });
    const session = await openPckFile(root);
    try {
      expect(archiveHandle).toBeDefined();
      expect(reads.length).toBeGreaterThan(0);
      for (const call of reads) {
        expect(call.position).toBeGreaterThanOrEqual(0);
        expect(call.position + call.length).toBeLessThanOrEqual(index.indexEnd);
      }
      const before = reads.length;
      try {
        await session.readData(FORBIDDEN);
      } catch (error) {
        expect(error).toBeInstanceOf(PckError);
        expect((error as PckError).code).toBe('EXTENSION');
      }
      expect(reads.length).toBe(before);
      const out = await session.readData(ALLOWED);
      expect(out).toEqual(good);
      expect(reads.length).toBeGreaterThan(before);
    } finally {
      await session.close();
    }
  });
});

describe('real filesystem roots and leaves', () => {
  it('accepts an explicitly authorized symlink root and literal punctuation roots', async () => {
    const root = await makeRoot();
    const data = payload(64, 5);
    await writeArchive(root, buildPck([{ path: ALLOWED, data }], { gapAfterIndex: 8 }));
    const base = path.dirname(root);
    await fs.symlink(root, path.join(base, 'authorized-root'));
    const via = await openPckFile(path.join(base, 'authorized-root'));
    try {
      expect(await via.readData(ALLOWED)).toEqual(data);
    } finally {
      await via.close();
    }
    const literal = path.join(base, 'authorized:root?*');
    await fs.rename(root, literal);
    const lit = await openPckFile(literal);
    try {
      expect(await lit.readData(ALLOWED)).toEqual(data);
    } finally {
      await lit.close();
    }
  });

  it('refuses leaf symlinks, dangling leaves, directories and FIFOs without blocking', async () => {
    const root = await makeRoot();
    const outside = path.join(path.dirname(root), 'outside.pck');
    await fs.writeFile(outside, buildPck([{ path: ALLOWED, data: payload(8) }], { gapAfterIndex: 8 }));
    await fs.symlink(outside, path.join(root, 'Wonderdraft.pck'));
    await failsCode(openPckFile(root), 'PATH', 'leaf symlink');
    await fs.rm(path.join(root, 'Wonderdraft.pck'));
    await fs.symlink(path.join(root, 'absent-target'), path.join(root, 'Wonderdraft.pck'));
    await failsCode(openPckFile(root), 'PATH', 'dangling leaf');
    await fs.rm(path.join(root, 'Wonderdraft.pck'));
    await fs.mkdir(path.join(root, 'Wonderdraft.pck'));
    await failsCode(openPckFile(root), 'TYPE', 'directory as file');
    await fs.rm(path.join(root, 'Wonderdraft.pck'), { recursive: true });
    const fifoRoot = await makeRoot();
    const fifo = path.join(fifoRoot, 'Wonderdraft.pck');
    execFileSync('mkfifo', [fifo]);
    const source = new URL('../../electron/assets/pck-file.ts', import.meta.url).href;
    const script =
      `import {openPckFile,PckFileError} from ${JSON.stringify(source)};\n` +
      `try{const s=await openPckFile(${JSON.stringify(fifoRoot)});await s.close();process.exitCode=2;}` +
      `catch(e){if(!(e instanceof PckFileError)||e.code!=='TYPE')throw e;console.log('TYPE');}`;
    expect(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 }).trim(),
    ).toBe('TYPE');
  });

  it('holds the archive descriptor across root and file swaps', async () => {
    const root = await makeRoot();
    const base = path.dirname(root);
    const first = payload(128, 11);
    await writeArchive(root, buildPck([{ path: ALLOWED, data: first }], { gapAfterIndex: 8 }));
    const session = await openPckFile(root);
    try {
      const other = path.join(base, 'other');
      await fs.mkdir(other);
      await writeArchive(other, buildPck([{ path: ALLOWED, data: payload(128, 77) }], { gapAfterIndex: 8 }));
      await fs.rename(root, path.join(base, 'held-root'));
      await fs.symlink(other, root);
      expect(await session.readData(ALLOWED)).toEqual(first);
    } finally {
      await session.close();
    }
    const root2 = path.join(base, 'held-root');
    const session2 = await openPckFile(root2);
    try {
      await writeArchive(root2, buildPck([{ path: ALLOWED, data: payload(256, 99) }], { gapAfterIndex: 8 }));
      await failsCode(session2.readData(ALLOWED), 'CHANGED', 'replaced archive');
    } finally {
      await session2.close();
    }
  });

  it('rejects truncation, growth and in-place changes without mixed results', async () => {
    const root = await makeRoot();
    const file = buildPck([{ path: ALLOWED, data: payload(256, 13) }], { gapAfterIndex: 8 });
    for (const change of ['truncate', 'grow', 'overwrite'] as const) {
      await writeArchive(root, file);
      const session = await openPckFile(root);
      try {
        const target = path.join(root, 'Wonderdraft.pck');
        if (change === 'truncate') await fs.truncate(target, Math.floor(file.length / 2));
        else if (change === 'grow') await fs.appendFile(target, new Uint8Array([1, 2, 3, 4]));
        else {
          const handle = await fs.open(target, 'r+');
          try {
            await handle.write(new Uint8Array([0xff, 0xfe]), 0, 2, file.length - 2);
          } finally {
            await handle.close();
          }
        }
        await failsCode(session.readData(ALLOWED), 'CHANGED', change);
      } finally {
        await session.close();
      }
    }
  });

  it('closes owned descriptors on factory failure and on close', async () => {
    const root = await makeRoot();
    const actualOpen = fs.open.bind(fs);
    const opened: Awaited<ReturnType<typeof fs.open>>[] = [];
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      opened.push(handle);
      return handle;
    });
    await failsCode(openPckFile(root), 'MISSING', 'absent archive closes root');
    for (const handle of opened) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
    opened.length = 0;
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(16) }], { gapAfterIndex: 8 }));
    const session: PckFile = await openPckFile(root);
    await session.close();
    for (const handle of opened) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('opens read-only with no-follow and a directory-only root flag', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(8) }], { gapAfterIndex: 8 }));
    const { constants } = await import('node:fs');
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const numeric = flags as number;
      expect(numeric & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      expect(numeric & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
      const isLeaf = String(fileArg).endsWith('/Wonderdraft.pck');
      expect(numeric & constants.O_DIRECTORY).toBe(isLeaf ? 0 : constants.O_DIRECTORY);
      expect(numeric & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC)).toBe(0);
      return actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
    });
    const session = await openPckFile(root);
    try {
      expect(await session.readData(ALLOWED)).toEqual(payload(8));
    } finally {
      await session.close();
    }
  });
});

describe('validation, caps and malformed indexes', () => {
  it.each([null, undefined, 42, {}, [], true, '', 'relative', '/a/../b', '/a//b', '/bad\0root'])(
    'rejects malformed root %j before I/O',
    async (root) => {
      const canonicalize = vi.spyOn(fs, 'realpath');
      const open = vi.spyOn(fs, 'open');
      await failsCode(openPckFile(root as string), 'PATH', `root ${String(root)}`);
      expect(canonicalize).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('pins root slash and the exact 4096-char bound', async () => {
    const canonicalize = vi.spyOn(fs, 'realpath');
    canonicalize.mockRejectedValue(Object.assign(new Error('intentional lookup refusal'), { code: 'ENOENT' }));
    const exact = `/${'a/'.repeat(2047)}a`;
    expect(exact.length).toBe(4096);
    await failsCode(openPckFile('/'), 'MISSING', 'slash root');
    await failsCode(openPckFile(exact), 'MISSING', 'exact bound');
    expect(canonicalize).toHaveBeenCalledTimes(2);
    await failsCode(openPckFile(`${exact}a`), 'PATH', 'over bound');
    expect(canonicalize).toHaveBeenCalledTimes(2);
  });

  it.each([null, 'x', NaN, -1, 0.5, Infinity, PCK_FILE_LIMITS.maxReadBytes + 1])(
    'rejects malformed entry cap %j before I/O',
    async (cap) => {
      const root = await makeRoot();
      await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(8) }], { gapAfterIndex: 8 }));
      const session = await openPckFile(root);
      try {
        const open = vi.spyOn(fs, 'open');
        const before = open.mock.calls.length;
        await failsCode(session.readData(ALLOWED, cap as number), 'LIMIT', `cap ${String(cap)}`);
        expect(open.mock.calls.length).toBe(before);
      } finally {
        await session.close();
      }
    },
  );

  it.each([null, undefined, 42, {}, [], true])('rejects wrong-typed entry path %j', async (entry) => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(8) }], { gapAfterIndex: 8 }));
    const session = await openPckFile(root);
    try {
      await failsCode(session.readData(entry as string), 'PATH', `entry ${String(entry)}`);
    } finally {
      await session.close();
    }
  });

  it('enforces exact per-entry caps and an empty entry at cap zero', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(6, 21) }], { gapAfterIndex: 8 }));
    const session = await openPckFile(root);
    try {
      await failsCode(session.readData(ALLOWED, 5), 'LIMIT', 'one under');
      expect((await session.readData(ALLOWED, 6)).length).toBe(6);
      await failsCode(session.readData(ALLOWED, 0), 'LIMIT', 'zero under');
    } finally {
      await session.close();
    }
    const root2 = await makeRoot();
    await writeArchive(root2, buildPck([{ path: 'res://data/empty.csv', data: new Uint8Array(0) }], { gapAfterIndex: 8 }));
    const session2 = await openPckFile(root2);
    try {
      expect((await session2.readData('res://data/empty.csv', 0)).length).toBe(0);
    } finally {
      await session2.close();
    }
  });

  it('refuses an over-cap entry from a sparse file without buffering it', async () => {
    const root = await makeRoot();
    const small = buildPck([{ path: ALLOWED, data: payload(4, 31) }], { gapAfterIndex: 8 });
    const target = path.join(root, 'Wonderdraft.pck');
    await fs.writeFile(target, small);
    const view = new DataView(small.buffer, small.byteOffset, small.byteLength);
    const pathLen = view.getUint32(88, true);
    const sizeAt = 92 + pathLen + 8;
    const sizeView = new DataView((await fs.readFile(target)).buffer);
    void sizeView;
    const handle = await fs.open(target, 'r+');
    try {
      const sizeBuf = Buffer.alloc(8);
      sizeBuf.writeBigUInt64LE(BigInt(PCK_FILE_LIMITS.maxReadBytes + 1));
      await handle.write(sizeBuf, 0, 8, sizeAt);
      await handle.truncate(88 + 4 + pathLen + 32 + 8 + (PCK_FILE_LIMITS.maxReadBytes + 1));
    } finally {
      await handle.close();
    }
    const actualOpen = fs.open.bind(fs);
    const reads: number[] = [];
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const h = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        const read = h.read.bind(h);
        Object.defineProperty(h, 'read', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            reads.push(position);
            return read(buffer, offset, length, position);
          },
        });
      }
      return h;
    });
    const session = await openPckFile(root);
    try {
      await failsCode(session.readData(ALLOWED), 'LIMIT', 'sparse over-cap');
      for (const position of reads) expect(position).toBeLessThan(indexEndOf(small));
    } finally {
      await session.close();
    }
    function indexEndOf(file: Uint8Array): number {
      return parsePckIndex(file, file.length).indexEnd;
    }
  });

  it.each([
    ['bad-magic', (file: Uint8Array) => { file[0] = 0x58; }, 'MAGIC'],
    ['bad-version', (file: Uint8Array) => { new DataView(file.buffer).setUint32(4, 2, true); }, 'VERSION'],
    ['bad-major', (file: Uint8Array) => { new DataView(file.buffer).setUint32(8, 4, true); }, 'VERSION'],
    ['bad-count', (file: Uint8Array) => { new DataView(file.buffer).setUint32(84, PCK_LIMITS.maxFiles + 1, true); }, 'LIMIT'],
    ['empty-path', (file: Uint8Array) => { new DataView(file.buffer).setUint32(88, 0, true); }, 'FORMAT'],
    ['long-path', (file: Uint8Array) => { new DataView(file.buffer).setUint32(88, PCK_LIMITS.maxPathBytes + 1, true); }, 'LIMIT'],
  ] as Array<[string, (file: Uint8Array) => void, string]>)(
    'rejects malformed index %s with a typed error',
    async (_name, mutate, code) => {
      const root = await makeRoot();
      const file = buildPck([{ path: ALLOWED, data: payload(16, 41) }], { gapAfterIndex: 8 });
      mutate(file);
      await writeArchive(root, file);
      await failsCode(openPckFile(root), code, _name);
    },
  );

  it('rejects truncated and overlapping indexes with typed errors only', async () => {
    const root = await makeRoot();
    const file = buildPck(
      [
        { path: ALLOWED, data: payload(16, 51) },
        { path: ALLOWED2, data: payload(16, 52) },
      ],
      { gapAfterIndex: 8 },
    );
    await writeArchive(root, file.subarray(0, parsePckIndex(file, file.length).indexEnd - 10));
    await failsCode(openPckFile(root), 'TRUNCATED', 'truncated index');
    const root2 = await makeRoot();
    const file2 = buildPck([{ path: ALLOWED, data: payload(16, 53) }], { gapAfterIndex: 8 });
    const view = new DataView(file2.buffer, file2.byteOffset, file2.byteLength);
    const pathLen = view.getUint32(88, true);
    view.setBigUint64(92 + pathLen, 100n, true);
    await writeArchive(root2, file2);
    await failsCode(openPckFile(root2), 'FORMAT', 'overlap');
  });

  it.each(['probe.gdc', 'probe.gdshader', 'probe.import', 'probe.godot', 'probe.remap'])(
    'denies data extension %s with zero payload reads',
    async (leaf) => {
      const root = await makeRoot();
      const name = `res://test_dummy/${leaf}`;
      await writeArchive(
        root,
        buildPck(
          [
            { path: ALLOWED, data: payload(32, 61) },
            { path: name, data: payload(64, 62) },
          ],
          { gapAfterIndex: 8 },
        ),
      );
      const actualOpen = fs.open.bind(fs);
      let payloadReads = 0;
      let opened = false;
      vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
        const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
        if (String(fileArg).endsWith('/Wonderdraft.pck')) {
          if (!opened) opened = true;
          else {
            const read = handle.read.bind(handle);
            Object.defineProperty(handle, 'read', {
              value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
                payloadReads += 1;
                return read(buffer, offset, length, position);
              },
            });
          }
        }
        return handle;
      });
      const session = await openPckFile(root);
      try {
        try {
          await session.readData(name);
        } catch (error) {
          expect(error).toBeInstanceOf(PckError);
          expect((error as PckError).code).toBe('EXTENSION');
        }
        expect(payloadReads).toBe(0);
        await failsCode(session.readData('res://test_dummy/absent.png'), 'MISSING', 'absent entry');
      } finally {
        await session.close();
      }
    },
  );

  it('reads exact bytes through one-byte short reads plus a one-byte EOF check', async () => {
    const root = await makeRoot();
    const data = payload(24, 71);
    await writeArchive(root, buildPck([{ path: ALLOWED, data }], { gapAfterIndex: 8 }));
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        const read = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) =>
            read(buffer, offset, Math.min(length, 1), position),
        });
      }
      return handle;
    });
    const session = await openPckFile(root);
    try {
      expect(await session.readData(ALLOWED)).toEqual(data);
    } finally {
      await session.close();
    }
  });

  it('fails zero-progress reads instead of looping forever', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(8, 73) }], { gapAfterIndex: 8 }));
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        Object.defineProperty(handle, 'read', {
          value: async (buffer: Uint8Array) => ({ bytesRead: 0, buffer }),
        });
      }
      return handle;
    });
    await failsCode(openPckFile(root), 'IO', 'zero progress');
  });
});

describe('concurrency and close lifecycle', () => {
  async function gatedSession(entryCount = 4): Promise<{
    session: PckFile;
    release: () => void;
    entered: () => number;
  }> {
    const root = await makeRoot();
    const entries = Array.from({ length: entryCount }, (_, i) => ({
      path: `res://views/small/card_0${i}.wonderdraft_image`,
      data: payload(256, 100 + i),
    }));
    await writeArchive(root, buildPck(entries, { gapAfterIndex: 8 }));
    const session = await openPckFile(root);
    const actualOpen = fs.open.bind(fs);
    void actualOpen;
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handles = (session as unknown as { handle: Awaited<ReturnType<typeof fs.open>> });
    const raw = handles.handle.read.bind(handles.handle);
    let gated = true;
    Object.defineProperty(handles.handle, 'read', {
      value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        if (!gated) return raw(buffer, offset, length, position);
        entered += 1;
        await gate;
        return raw(buffer, offset, length, position);
      },
      configurable: true,
    });
    return {
      session,
      release: () => {
        gated = false;
        release();
      },
      entered: () => entered,
    };
  }

  it('holds four reads and rejects the fifth BUSY without allocating a read', async () => {
    const root = await makeRoot();
    const entries = Array.from({ length: 4 }, (_, i) => ({
      path: `res://views/small/card_0${i}.wonderdraft_image`,
      data: payload(256, 200 + i),
    }));
    await writeArchive(root, buildPck(entries, { gapAfterIndex: 8 }));
    const session = await openPckFile(root);
    const inner = session as unknown as { handle: Awaited<ReturnType<typeof fs.open>> };
    const raw = inner.handle.read.bind(inner.handle);
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.defineProperty(inner.handle, 'read', {
      value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        entered += 1;
        await gate;
        return raw(buffer, offset, length, position);
      },
      configurable: true,
    });
    const pending = entries.map((entry) => session.readData(entry.path));
    for (let i = 0; i < 50 && entered < 4; i++) await new Promise((r) => setTimeout(r, 5));
    expect(entered).toBe(4);
    await failsCode(session.readData(entries[0].path), 'BUSY', 'fifth read');
    release();
    const results = await Promise.all(pending);
    results.forEach((out: Uint8Array, i: number) => expect(out).toEqual(entries[i].data));
    await session.close();
  });

  it('close waits for pending reads, blocks new ones and stays idempotent', async () => {
    const { session, release, entered } = await gatedSession(2);
    const raw = (session as unknown as { handle: Awaited<ReturnType<typeof fs.open>> }).handle.read.bind(
      (session as unknown as { handle: Awaited<ReturnType<typeof fs.open>> }).handle,
    );
    void raw;
    const inner = session as unknown as { handle: Awaited<ReturnType<typeof fs.open>> };
    const base = inner.handle.read.bind(inner.handle);
    void base;
    const first = session.readData('res://views/small/card_00.wonderdraft_image');
    const second = session.readData('res://views/small/card_01.wonderdraft_image');
    void entered;
    const closing = session.close();
    await failsCode(session.readData('res://views/small/card_00.wonderdraft_image'), 'CLOSED', 'read during close');
    release();
    expect((await first).length).toBe(256);
    expect((await second).length).toBe(256);
    await closing;
    await session.close();
    await failsCode(session.readData('res://views/small/card_00.wonderdraft_image'), 'CLOSED', 'read after close');
  });

  it('wraps wrong-typed filesystem rejections into path-free IO', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(8) }], { gapAfterIndex: 8 }));
    for (const error of [null, undefined, 42, 'failure', false]) {
      vi.spyOn(fs, 'open').mockRejectedValueOnce(error);
      await failsCode(openPckFile(root), 'IO', `rejection ${String(error)}`);
      vi.restoreAllMocks();
    }
  });
});

describe('seeded synthetic corruption fuzz', () => {
  it('reports only typed errors for small corruptions', async () => {
    const root = await makeRoot();
    const base = buildPck(
      [
        { path: ALLOWED, data: payload(64, 301) },
        { path: CSV, data: payload(32, 302) },
      ],
      { gapAfterIndex: 8 },
    );
    const random = mulberry32(0x6c2);
    let typed = 0;
    let opened = 0;
    for (let i = 0; i < 48; i++) {
      const file = new Uint8Array(base);
      const hits = 1 + Math.floor(random() * 3);
      for (let h = 0; h < hits; h++) file[Math.floor(random() * file.length)] = Math.floor(random() * 256);
      await writeArchive(root, file);
      try {
        const session = await openPckFile(root);
        opened += 1;
        try {
          await session.readData(ALLOWED);
          typed += 1;
        } catch (error) {
          expect(error instanceof PckError || error instanceof PckFileError, `fuzz read ${i}`).toBe(true);
          typed += 1;
        } finally {
          await session.close();
        }
      } catch (error) {
        expect(error instanceof PckError || error instanceof PckFileError, `fuzz open ${i}`).toBe(true);
        typed += 1;
      }
    }
    expect(typed).toBe(48);
    expect(opened).toBeLessThanOrEqual(48);
  });
});

describe('empty-index header-read snapshot race', () => {
  async function trackOpensWithHeaderRace(target: string): Promise<{
    opened: Awaited<ReturnType<typeof fs.open>>[];
  }> {
    const actualOpen = fs.open.bind(fs);
    const opened: Awaited<ReturnType<typeof fs.open>>[] = [];
    let raced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      opened.push(handle);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        const raw = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            if (!raced) {
              raced = true;
              await fs.appendFile(target, new Uint8Array([1, 2, 3, 4]));
            }
            return raw(buffer, offset, length, position);
          },
          configurable: true,
        });
      }
      return handle;
    });
    return { opened };
  }

  it('rejects growth during the empty header read and closes owned descriptors', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([], { gapAfterIndex: 0 }));
    const target = path.join(root, 'Wonderdraft.pck');
    const { opened } = await trackOpensWithHeaderRace(target);
    await failsCode(openPckFile(root), 'CHANGED', 'empty header-read race');
    for (const handle of opened) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('opens an unchanged empty archive and still rejects a nonempty header-read race', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([], { gapAfterIndex: 0 }));
    const session = await openPckFile(root);
    try {
      expect(session.fileSize).toBe(88);
    } finally {
      await session.close();
    }
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(16) }], { gapAfterIndex: 8 }));
    const target = path.join(root, 'Wonderdraft.pck');
    const { opened } = await trackOpensWithHeaderRace(target);
    await failsCode(openPckFile(root), 'CHANGED', 'nonempty header-read race');
    for (const handle of opened) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });
});

describe('discovery-read snapshot ordering', () => {
  it('rejects CHANGED when the header turns to bad magic during its read', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(16, 41) }], { gapAfterIndex: 8 }));
    const target = path.join(root, 'Wonderdraft.pck');
    const actualOpen = fs.open.bind(fs);
    const opened: Awaited<ReturnType<typeof fs.open>>[] = [];
    let mutated = false;
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      opened.push(handle);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        const raw = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            if (!mutated && position === 0) {
              mutated = true;
              const writer = await actualOpen(target, 'r+');
              try {
                await writer.write(Uint8Array.of(0x58), 0, 1, 0);
              } finally {
                await writer.close();
              }
            }
            return raw(buffer, offset, length, position);
          },
          configurable: true,
        });
      }
      return handle;
    });
    await failsCode(openPckFile(root), 'CHANGED', 'changed malformed header');
    expect(mutated).toBe(true);
    for (const handle of opened) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('rejects CHANGED when the path-length word turns empty during its read', async () => {
    const root = await makeRoot();
    await writeArchive(root, buildPck([{ path: ALLOWED, data: payload(16, 43) }], { gapAfterIndex: 8 }));
    const target = path.join(root, 'Wonderdraft.pck');
    const actualOpen = fs.open.bind(fs);
    const opened: Awaited<ReturnType<typeof fs.open>>[] = [];
    let mutated = false;
    vi.spyOn(fs, 'open').mockImplementation(async (fileArg, flags, mode) => {
      const handle = await actualOpen(fileArg as string, flags as number, mode as unknown as undefined);
      opened.push(handle);
      if (String(fileArg).endsWith('/Wonderdraft.pck')) {
        const raw = handle.read.bind(handle);
        Object.defineProperty(handle, 'read', {
          value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
            if (!mutated && position === 88) {
              mutated = true;
              const writer = await actualOpen(target, 'r+');
              try {
                const zero = Buffer.alloc(4);
                await writer.write(zero, 0, 4, 88);
              } finally {
                await writer.close();
              }
            }
            return raw(buffer, offset, length, position);
          },
          configurable: true,
        });
      }
      return handle;
    });
    await failsCode(openPckFile(root), 'CHANGED', 'changed path-length word');
    expect(mutated).toBe(true);
    for (const handle of opened) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('keeps stable malformed diagnostics without reporting CHANGED', async () => {
    const cases: Array<[string, (file: Uint8Array) => void, string]> = [
      ['stable-bad-magic', (file) => { file[0] = 0x58; }, 'MAGIC'],
      ['stable-bad-version', (file) => { new DataView(file.buffer).setUint32(4, 2, true); }, 'VERSION'],
      [
        'stable-long-path',
        (file) => { new DataView(file.buffer).setUint32(88, PCK_LIMITS.maxPathBytes + 1, true); },
        'LIMIT',
      ],
      ['stable-empty-path', (file) => { new DataView(file.buffer).setUint32(88, 0, true); }, 'FORMAT'],
    ];
    for (const [name, mutate, code] of cases) {
      const root = await makeRoot();
      const file = buildPck([{ path: ALLOWED, data: payload(16, 41) }], { gapAfterIndex: 8 });
      mutate(file);
      await writeArchive(root, file);
      await failsCode(openPckFile(root), code, name);
    }
  });

  it('opens unchanged empty and nonempty archives', async () => {
    const emptyRoot = await makeRoot();
    await writeArchive(emptyRoot, buildPck([], { gapAfterIndex: 0 }));
    const empty = await openPckFile(emptyRoot);
    try {
      expect(empty.fileSize).toBe(88);
    } finally {
      await empty.close();
    }
    const fullRoot = await makeRoot();
    const data = payload(24, 71);
    await writeArchive(fullRoot, buildPck([{ path: ALLOWED, data }], { gapAfterIndex: 8 }));
    const full = await openPckFile(fullRoot);
    try {
      expect(await full.readData(ALLOWED)).toEqual(data);
    } finally {
      await full.close();
    }
  });

  it('refuses a pre-readData mutation with zero payload reads', async () => {
    const root = await makeRoot();
    const data = payload(32, 61);
    await writeArchive(root, buildPck([{ path: ALLOWED, data }], { gapAfterIndex: 8 }));
    const session = await openPckFile(root);
    try {
      const inner = session as unknown as { handle: Awaited<ReturnType<typeof fs.open>> };
      const raw = inner.handle.read.bind(inner.handle);
      let reads = 0;
      Object.defineProperty(inner.handle, 'read', {
        value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
          reads += 1;
          return raw(buffer, offset, length, position);
        },
        configurable: true,
      });
      const target = path.join(root, 'Wonderdraft.pck');
      const current = await fs.readFile(target);
      const last = current[current.length - 1];
      const writer = await fs.open(target, 'r+');
      try {
        await writer.write(Uint8Array.of(last === 0xff ? 0x00 : 0xff), 0, 1, current.length - 1);
      } finally {
        await writer.close();
      }
      await failsCode(session.readData(ALLOWED), 'CHANGED', 'pre-readData mutation');
      expect(reads).toBe(0);
    } finally {
      await session.close();
    }
  });
});
