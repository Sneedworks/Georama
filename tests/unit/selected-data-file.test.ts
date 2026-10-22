import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants } from 'node:fs';
import { SELECTED_FILE_LIMITS, SelectedFileError, readSelectedDataFile } from '../../electron/data/selected-file.ts';

const roots: string[] = [];
async function mkroot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sel-data-'));
  roots.push(base);
  return base;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of roots.splice(0)) await fs.rm(d, { recursive: true, force: true });
});
async function fails(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SelectedFileError);
    expect((error as SelectedFileError).code).toBe(code);
    expect((error as Error).message).not.toContain(os.tmpdir());
    expect((error as Error).name).toBe('SelectedFileError');
    return;
  }
  throw new Error(`expected SelectedFileError/${code}`);
}

describe('selected-data-file setup', () => {
  it('reads exact invented payload with safe flags, bigint stat and awaited close', async () => {
    expect(Object.isFrozen(SELECTED_FILE_LIMITS)).toBe(true);
    expect(SELECTED_FILE_LIMITS).toEqual({ maxReadBytes: 512 * 1024 * 1024, maxPathChars: 4096 });
    const base = await mkroot();
    const file = path.join(base, 'invented.json');
    const payload = new TextEncoder().encode('{"hello":"world"}');
    await fs.writeFile(file, payload);
    const expectedFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    const actualOpen = fs.open.bind(fs);
    const statOpts: unknown[] = [];
    const observed: { closed: boolean } = { closed: false };
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const origStat = h.stat.bind(h);
        Object.defineProperty(h, 'stat', {
          value: async (o: unknown) => {
            statOpts.push(o);
            return origStat(o as never);
          },
          configurable: true,
        });
        const origClose = h.close.bind(h);
        Object.defineProperty(h, 'close', {
          value: async () => {
            observed.closed = true;
            return origClose();
          },
          configurable: true,
        });
      }
      return h;
    });
    const data = await readSelectedDataFile(file, 1024);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual(Array.from(payload));
    expect(statOpts.length).toBeGreaterThan(0);
    for (const o of statOpts) expect(o).toEqual({ bigint: true });
    expect(observed.closed).toBe(true);
  });
});

describe('caps, coercion and order', () => {
  it.each([-1, 0.5, NaN, Infinity, '8', null, undefined, {}, [], true, 536870913])(
    'rejects malformed or raised cap %j before I/O',
    async (cap) => {
      const open = vi.spyOn(fs, 'open');
      await fails(readSelectedDataFile('/unused.json', cap as number), 'LIMIT');
      expect(open).not.toHaveBeenCalled();
    },
  );
  it('rejects Number-object, Symbol and throwing caps without coercion', async () => {
    const open = vi.spyOn(fs, 'open');
    await fails(readSelectedDataFile('/unused.json', new Number(8) as unknown as number), 'LIMIT');
    await fails(readSelectedDataFile('/unused.json', Symbol('8') as unknown as number), 'LIMIT');
    const evil = { valueOf() { throw new Error('evil-value'); }, toString() { throw new Error('evil-str'); } };
    await fails(readSelectedDataFile('/unused.json', evil as unknown as number), 'LIMIT');
    expect(open).not.toHaveBeenCalled();
  });
  it('checks cap before bad filename, extension and missing source', async () => {
    const open = vi.spyOn(fs, 'open');
    await fails(readSelectedDataFile('/bad\0.json', -1), 'LIMIT');
    await fails(readSelectedDataFile(42 as unknown as string, -1), 'LIMIT');
    await fails(readSelectedDataFile('/unused.gdc', 536870913), 'LIMIT');
    await fails(readSelectedDataFile('/definitely-missing-sel-12345.json', 536870913), 'LIMIT');
    expect(open).not.toHaveBeenCalled();
  });
  it('admits the hard cap on tiny and empty files without huge allocation', async () => {
    const base = await mkroot();
    const tiny = path.join(base, 'tiny.json');
    await fs.writeFile(tiny, 'hi');
    expect((await readSelectedDataFile(tiny, 536870912)).length).toBe(2);
    const empty = path.join(base, 'empty.json');
    await fs.writeFile(empty, '');
    expect((await readSelectedDataFile(empty, 536870912)).length).toBe(0);
    expect((await readSelectedDataFile(empty, 0)).length).toBe(0);
    await fails(readSelectedDataFile(tiny, 1), 'LIMIT');
    expect((await readSelectedDataFile(tiny, 2)).length).toBe(2);
    expect((await readSelectedDataFile(tiny, 3)).length).toBe(2);
  });
  it('refuses sparse over-cap without allocating', async () => {
    const base = await mkroot();
    const big = path.join(base, 'big.json');
    const h = await fs.open(big, 'w');
    try {
      await h.truncate(536870913);
    } finally {
      await h.close();
    }
    await fails(readSelectedDataFile(big, 536870912), 'LIMIT');
  });
});

describe('path, suffix and zero I/O', () => {
  it.each([null, undefined, 42, {}, [], true])('rejects wrong-typed filename %j before I/O', async (v) => {
    const open = vi.spyOn(fs, 'open');
    await fails(readSelectedDataFile(v as unknown as string, 1024), 'PATH');
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects String-object, Symbol and throwing filenames without coercion', async () => {
    const open = vi.spyOn(fs, 'open');
    await fails(readSelectedDataFile(new String('/a.json') as unknown as string, 1024), 'PATH');
    await fails(readSelectedDataFile(Symbol('x') as unknown as string, 1024), 'PATH');
    const evil = { toString() { throw new Error('evil'); }, valueOf() { throw new Error('evil'); } };
    await fails(readSelectedDataFile(evil as unknown as string, 1024), 'PATH');
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    '',
    'relative.json',
    '/a/../b.json',
    '/a//b.json',
    '/a/./b.json',
    '/bad\x00.json',
    '/bad\n.json',
    '/bad\x7f.json',
    '/bad\x9f.json',
  ])('refuses hostile path %j without I/O', async (v) => {
    const open = vi.spyOn(fs, 'open');
    await fails(readSelectedDataFile(v, 1024), 'PATH');
    expect(open).not.toHaveBeenCalled();
  });
  it('refuses unpaired surrogates but allows paired astral', async () => {
    const open = vi.spyOn(fs, 'open');
    const lone1 = '/a' + String.fromCharCode(0xd800) + '.json';
    const lone2 = '/a' + String.fromCharCode(0xdc00) + '.json';
    await fails(readSelectedDataFile(lone1, 1024), 'PATH');
    await fails(readSelectedDataFile(lone2, 1024), 'PATH');
    expect(open).not.toHaveBeenCalled();
    const base = await mkroot();
    const paired = path.join(base, 'caf\u00e9 \ud83d\ude00.json');
    await fs.writeFile(paired, 'ok');
    expect(new TextDecoder().decode(await readSelectedDataFile(paired, 16))).toBe('ok');
  });
  it('allows literal punctuation, space, percent, backslash, colon and hidden dirs', async () => {
    const base = await mkroot();
    for (const name of ['sp ace.json', '%2e%2e.json', 'back\\slash.json', 'colon:name.json', '.hidden.json']) {
      const f = path.join(base, name);
      await fs.writeFile(f, 'd');
      expect(new TextDecoder().decode(await readSelectedDataFile(f, 16))).toBe('d');
    }
    const hiddenDir = path.join(base, '.hdir');
    await fs.mkdir(hiddenDir);
    const hf = path.join(hiddenDir, 'leaf.json');
    await fs.writeFile(hf, 'h');
    expect(new TextDecoder().decode(await readSelectedDataFile(hf, 16))).toBe('h');
  });
  it.each(['a', 'leaf.PNG', 'code.gdc', 'image.png.gdc', 'x.shader', 'x.js', 'x.png', 'x.JSON', 'x.json.bak', 'x.wonderdraft_map.bak', 'x.json?y', 'x.json/', '/trailing.json/'])(
    'denies unsupported suffix %j before I/O',
    async (v) => {
      const open = vi.spyOn(fs, 'open');
      await fails(readSelectedDataFile('/unused-' + v, 1024), 'EXTENSION');
      expect(open).not.toHaveBeenCalled();
    },
  );
  it('accepts exact .json and .wonderdraft_map suffixes', async () => {
    const base = await mkroot();
    const a = path.join(base, 'm.json');
    const b = path.join(base, 'm.wonderdraft_map');
    await fs.writeFile(a, '1');
    await fs.writeFile(b, '2');
    expect(new TextDecoder().decode(await readSelectedDataFile(a, 8))).toBe('1');
    expect(new TextDecoder().decode(await readSelectedDataFile(b, 8))).toBe('2');
  });
  it('checks path before extension', async () => {
    const open = vi.spyOn(fs, 'open');
    await fails(readSelectedDataFile('/bad\x00.gdc', 1024), 'PATH');
    await fails(readSelectedDataFile('relative.gdc', 1024), 'PATH');
    expect(open).not.toHaveBeenCalled();
  });
  it('pins 4095/4096 transit vs 4097 refusal', async () => {
    const open = vi.spyOn(fs, 'open');
    const mk = (len: number) => '/' + 'a'.repeat(len - 6) + '.json';
    const p4095 = mk(4095);
    const p4096 = mk(4096);
    const p4097 = mk(4097);
    expect(p4095.length).toBe(4095);
    expect(p4096.length).toBe(4096);
    expect(p4097.length).toBe(4097);
    await fails(readSelectedDataFile(p4095, 1024), 'IO');
    await fails(readSelectedDataFile(p4096, 1024), 'IO');
    expect(open).toHaveBeenCalledTimes(2);
    open.mockClear();
    await fails(readSelectedDataFile(p4097, 1024), 'PATH');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('regular, size, zero and partial reads', () => {
  it('reports missing short files without leaking paths', async () => {
    const base = await mkroot();
    const missing = path.join(base, 'absent.json');
    await fails(readSelectedDataFile(missing, 1024), 'MISSING');
  });
  it('refuses directories with TYPE and closes the handle', async () => {
    const base = await mkroot();
    const dir = path.join(base, 'dir.json');
    await fs.mkdir(dir);
    const actualOpen = fs.open.bind(fs);
    let closed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      const origClose = h.close.bind(h);
      Object.defineProperty(h, 'close', {
        value: async () => {
          closed = true;
          return origClose();
        },
        configurable: true,
      });
      return h;
    });
    await fails(readSelectedDataFile(dir, 1024), 'TYPE');
    expect(closed).toBe(true);
  });
  it('refuses leaf symlinks with PATH and leaves the target unchanged', async () => {
    const base = await mkroot();
    const target = path.join(base, 'target.json');
    await fs.writeFile(target, 'secret');
    const link = path.join(base, 'leaf.json');
    await fs.symlink(target, link);
    await fails(readSelectedDataFile(link, 1024), 'PATH');
    expect(await fs.readFile(target, 'utf8')).toBe('secret');
  });
  it('opens FIFOs nonblocking and rejects them with TYPE in a real child', async () => {
    const { execFileSync } = await import('node:child_process');
    const base = await mkroot();
    const fifo = path.join(base, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    const source = new URL('../../electron/data/selected-file.ts', import.meta.url).href;
    const script =
      `import {readSelectedDataFile as r,SelectedFileError as E} from ${JSON.stringify(source)};\n` +
      `try{await r(${JSON.stringify(fifo)},1024);process.exitCode=2;}` +
      `catch(e){if(!(e instanceof E)||e.code!=='TYPE')throw e;console.log('TYPE');}`;
    expect(
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 }).trim(),
    ).toBe('TYPE');
  });
  it('handles zero files and cap zero without allocation tricks', async () => {
    const base = await mkroot();
    const empty = path.join(base, 'z.json');
    await fs.writeFile(empty, '');
    const a = await readSelectedDataFile(empty, 0);
    expect(a.length).toBe(0);
    expect(a).toBeInstanceOf(Uint8Array);
    const b = await readSelectedDataFile(empty, 0);
    expect(b.length).toBe(0);
    expect(b).not.toBe(a);
    expect(b.buffer).not.toBe(a.buffer);
  });
  it('loops short reads with exact offsets and positions', async () => {
    const base = await mkroot();
    const file = path.join(base, 'short.json');
    await fs.writeFile(file, 'inside');
    const actualOpen = fs.open.bind(fs);
    const calls: number[][] = [];
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const read = h.read.bind(h);
        Object.defineProperty(h, 'read', {
          value: async (buf: Uint8Array, off: number, len: number, pos: number) => {
            calls.push([buf.length, off, len, pos]);
            return read(buf, off, Math.min(len, 1), pos);
          },
          configurable: true,
        });
      }
      return h;
    });
    expect(new TextDecoder().decode(await readSelectedDataFile(file, 1024))).toBe('inside');
    expect(calls).toEqual([
      [6, 0, 6, 0], [6, 1, 5, 1], [6, 2, 4, 2], [6, 3, 3, 3], [6, 4, 2, 4], [6, 5, 1, 5],
    ]);
  });
  it.each([
    ['zero', 0],
    ['negative', -2],
    ['over', 999],
    ['nonint', 1.5],
    ['nan', NaN],
  ])('rejects unstable %s counts with IO', async (_label, count) => {
    const base = await mkroot();
    const file = path.join(base, 'unstable.json');
    await fs.writeFile(file, 'abcdef');
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        Object.defineProperty(h, 'read', {
          value: async () => ({ bytesRead: count, buffer: new Uint8Array(0) }),
          configurable: true,
        });
      }
      return h;
    });
    await fails(readSelectedDataFile(file, 1024), 'IO');
  });
  it('returns fresh backing identity per call', async () => {
    const base = await mkroot();
    const file = path.join(base, 'id.json');
    await fs.writeFile(file, 'xy');
    const o1 = await readSelectedDataFile(file, 16);
    const o2 = await readSelectedDataFile(file, 16);
    expect(o1).not.toBe(o2);
    expect(o1.buffer).not.toBe(o2.buffer);
    expect(Array.from(o1)).toEqual([120, 121]);
    expect(o1.buffer.byteLength).toBe(2);
  });
});

describe('snapshots, failures and close', () => {
  async function statOf(p: string) {
    const h = await fs.open(p, 'r');
    try {
      return (await h.stat({ bigint: true })) as unknown as Record<string, bigint>;
    } finally {
      await h.close();
    }
  }
  it.each(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const)(
    'rejects a change in %s with CHANGED',
    async (field) => {
      const base = await mkroot();
      const file = path.join(base, 'snap.json');
      await fs.writeFile(file, 'abcdef');
      const real = await statOf(file);
      const actualOpen = fs.open.bind(fs);
      vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
        const h = await actualOpen(p as string, f as number, ...(rest as []));
        if (String(p) === file) {
          const origStat = h.stat.bind(h);
          let n = 0;
          Object.defineProperty(h, 'stat', {
            value: async (o: unknown) => {
              n += 1;
              const s = (await origStat(o as never)) as unknown as Record<string, unknown>;
              if (n >= 2) {
                return {
                  ...s,
                  [field]: (real[field] as bigint) + 1n,
                  isFile: () => true,
                };
              }
              return s;
            },
            configurable: true,
          });
        }
        return h;
      });
      try {
        await readSelectedDataFile(file, 1024);
      } catch (error) {
        expect(error).toBeInstanceOf(SelectedFileError);
        expect((error as SelectedFileError).code).toBe('CHANGED');
        return;
      }
      throw new Error(`expected CHANGED for ${field}`);
    },
  );
  it('ignores mode-only changes', async () => {
    const base = await mkroot();
    const file = path.join(base, 'mode.json');
    await fs.writeFile(file, 'hi');
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const origStat = h.stat.bind(h);
        let n = 0;
        Object.defineProperty(h, 'stat', {
          value: async (o: unknown) => {
            n += 1;
            const s = (await origStat(o as never)) as unknown as Record<string, unknown>;
            if (n >= 2) return { ...s, mode: 0o777 };
            return s;
          },
          configurable: true,
        });
      }
      return h;
    });
    expect((await readSelectedDataFile(file, 1024)).length).toBe(2);
  });
  it('validates the full requested range before a clamped count', async () => {
    const base = await mkroot();
    const file = path.join(base, 'range.json');
    await fs.writeFile(file, '0123456789');
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const read = h.read.bind(h);
        Object.defineProperty(h, 'read', {
          value: async (buf: Uint8Array, off: number, len: number, pos: number) => {
            expect(buf.length).toBe(10);
            expect(off + len + pos).toBeLessThanOrEqual(20);
            expect(off).toBe(pos);
            expect(len).toBe(10 - off);
            return read(buf, off, 1, pos);
          },
          configurable: true,
        });
      }
      return h;
    });
    expect(new TextDecoder().decode(await readSelectedDataFile(file, 64))).toBe('0123456789');
  });
  it('maps changed-plus-zero reads to CHANGED, not IO', async () => {
    const base = await mkroot();
    const file = path.join(base, 'cz.json');
    await fs.writeFile(file, 'abcdef');
    const real = await statOf(file);
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        Object.defineProperty(h, 'read', {
          value: async () => ({ bytesRead: 0, buffer: new Uint8Array(0) }),
          configurable: true,
        });
        const origStat = h.stat.bind(h);
        let n = 0;
        Object.defineProperty(h, 'stat', {
          value: async (o: unknown) => {
            n += 1;
            const s = (await origStat(o as never)) as unknown as Record<string, unknown>;
            if (n >= 2) return { ...s, size: (real['size'] as bigint) + 1n, isFile: () => true };
            return s;
          },
          configurable: true,
        });
      }
      return h;
    });
    await fails(readSelectedDataFile(file, 1024), 'CHANGED');
  });
  it('checks the final snapshot even for empty files', async () => {
    const base = await mkroot();
    const file = path.join(base, 'final.json');
    await fs.writeFile(file, '');
    const real = await statOf(file);
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const origStat = h.stat.bind(h);
        let n = 0;
        Object.defineProperty(h, 'stat', {
          value: async (o: unknown) => {
            n += 1;
            const s = (await origStat(o as never)) as unknown as Record<string, unknown>;
            if (n >= 2) return { ...s, mtimeNs: (real['mtimeNs'] as bigint) + 1n };
            return s;
          },
          configurable: true,
        });
      }
      return h;
    });
    await fails(readSelectedDataFile(file, 1024), 'CHANGED');
  });
  it.each([null, undefined, 42, 'x', false])('wraps wrong-typed open rejection %j into IO', async (e) => {
    const base = await mkroot();
    const file = path.join(base, 'w.json');
    await fs.writeFile(file, 'd');
    vi.spyOn(fs, 'open').mockRejectedValueOnce(e);
    await fails(readSelectedDataFile(file, 1024), 'IO');
  });
  it('maps native read rejection to IO and closes', async () => {
    const base = await mkroot();
    const file = path.join(base, 'rr.json');
    await fs.writeFile(file, 'data');
    const actualOpen = fs.open.bind(fs);
    let seen: { read(b: Uint8Array, o: number, l: number, q: number): Promise<unknown> } | undefined;
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        seen = h as never;
        const realRead = h.read.bind(h);
        let first = true;
        Object.defineProperty(h, 'read', {
          value: async (b: Uint8Array, o: number, l: number, q: number) => {
            if (first) {
              first = false;
              throw Object.assign(new Error('boom'), { code: 'EIO' });
            }
            return realRead(b as never, o as never, l as never, q as never);
          },
          configurable: true,
        });
      }
      return h;
    });
    await fails(readSelectedDataFile(file, 1024), 'IO');
    await expect(seen!.read(new Uint8Array(1), 0, 1, 0)).rejects.toMatchObject({ code: 'EBADF' });
  });
  it('maps stat failure to IO and read failure order over close', async () => {
    const base = await mkroot();
    const file = path.join(base, 'sf.json');
    await fs.writeFile(file, 'data');
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        Object.defineProperty(h, 'stat', {
          value: async () => {
            throw Object.assign(new Error('stat-boom'), { code: 'EIO' });
          },
          configurable: true,
        });
      }
      return h;
    });
    await fails(readSelectedDataFile(file, 1024), 'IO');
  });
  it('reports close-only failure as IO after real close', async () => {
    const base = await mkroot();
    const file = path.join(base, 'cc.json');
    await fs.writeFile(file, 'ok');
    const actualOpen = fs.open.bind(fs);
    let realClosed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const origClose = h.close.bind(h);
        Object.defineProperty(h, 'close', {
          value: async () => {
            await origClose();
            realClosed = true;
            throw Object.assign(new Error('close-boom'), { code: 'EIO' });
          },
          configurable: true,
        });
      }
      return h;
    });
    await fails(readSelectedDataFile(file, 1024), 'IO');
    expect(realClosed).toBe(true);
  });
  it('keeps the primary TYPE error when close also fails', async () => {
    const base = await mkroot();
    const dir = path.join(base, 'pdir.json');
    await fs.mkdir(dir);
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      const origClose = h.close.bind(h);
      Object.defineProperty(h, 'close', {
        value: async () => {
          await origClose();
          throw Object.assign(new Error('close-boom'), { code: 'EIO' });
        },
        configurable: true,
      });
      return h;
    });
    await fails(readSelectedDataFile(dir, 1024), 'TYPE');
  });
});

describe('allocation failure', () => {
  it.each([
    ['alloc-a.json', 'hi'],
    ['alloc-b.json', 'inside'],
  ])('maps native allocation failure to LIMIT for %s without size matching', async (name, payload) => {
    const base = await mkroot();
    const file = path.join(base, name);
    await fs.writeFile(file, payload);
    const RealUint8Array = globalThis.Uint8Array;
    let allocCalls = 0;
    let readCalls = 0;
    let closeCalls = 0;
    let nativeRead: any;
    const actualOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        const savedRead = h.read.bind(h);
        nativeRead = savedRead as never;
        const origClose = h.close.bind(h);
        Object.defineProperty(h, 'read', {
          value: async (...args: never[]) => {
            readCalls += 1;
            return (savedRead as (...a: never[]) => Promise<unknown>)(...args);
          },
          configurable: true,
        });
        Object.defineProperty(h, 'close', {
          value: async () => {
            closeCalls += 1;
            return origClose();
          },
          configurable: true,
        });
        let calls = 0;
        function FailingAlloc(this: unknown, ...args: [number]) {
          calls += 1;
          allocCalls += 1;
          if (calls === 1) throw new RangeError('Array buffer allocation failed');
          return new RealUint8Array(...args);
        }
        (FailingAlloc as unknown as { prototype: unknown }).prototype = RealUint8Array.prototype;
        globalThis.Uint8Array = FailingAlloc as unknown as typeof Uint8Array;
      }
      return h;
    });
    let code: string | undefined;
    try {
      await readSelectedDataFile(file, 1024);
      throw new Error('expected SelectedFileError/LIMIT');
    } catch (error) {
      expect(error).toBeInstanceOf(SelectedFileError);
      expect((error as SelectedFileError).code).toBe('LIMIT');
      expect((error as Error).message).not.toContain(os.tmpdir());
      expect((error as Error).name).toBe('SelectedFileError');
      code = (error as SelectedFileError).code;
    } finally {
      globalThis.Uint8Array = RealUint8Array;
    }
    expect(code).toBe('LIMIT');
    expect(allocCalls).toBe(1);
    expect(readCalls).toBe(0);
    expect(closeCalls).toBe(1);
    await expect(nativeRead!(new RealUint8Array(1), 0, 1, 0)).rejects.toMatchObject({ code: 'EBADF' });
  });
});
