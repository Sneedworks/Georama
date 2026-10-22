import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { readSelectedDataFile, SelectedFileError } from '../../electron/data/selected-file.ts';

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'selected-strength-'));
  roots.push(root);
  const file = path.join(root, 'invented.json');
  await fs.writeFile(file, 'abcdefgh');
  return { root, file };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
function intercept(file: string, configure: (h: FileHandle) => void | Promise<void>) {
  const open = fs.open.bind(fs);
  return vi.spyOn(fs, 'open').mockImplementation(async (p, flags, ...rest) => {
    const h = await open(p as string, flags as number, ...(rest as []));
    if (p === file) await configure(h);
    return h;
  });
}
async function refusal(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(SelectedFileError);
  await expect(promise).rejects.toMatchObject({ name: 'SelectedFileError', code });
}

it('pins exact numeric flags, one open and the native backing region across partial reads', async () => {
  const { file } = await fixture();
  const destinations: Uint8Array[] = [];
  let originalRead: FileHandle['read'] | undefined;
  const opened = intercept(file, h => {
    const read = h.read.bind(h);
    originalRead = read;
    Object.defineProperty(h, 'read', { configurable: true, value: async (b: Uint8Array, o: number, n: number, p: number) => {
      expect(o).toBe(p);
      expect(o + n).toBe(b.byteLength);
      destinations.push(b);
      return read(b, o, Math.min(n, 2), p);
    } });
  });
  const data = await readSelectedDataFile(file, 8);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(opened.mock.calls[0]).toEqual([file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK]);
  expect(new TextDecoder().decode(data)).toBe('abcdefgh');
  expect(destinations).toHaveLength(4);
  for (const destination of destinations) {
    expect(data.buffer).toBe(destination.buffer);
    expect(data.byteOffset).toBe(destination.byteOffset);
    expect(data.byteLength).toBe(destination.byteLength);
  }
  await expect(originalRead!(new Uint8Array(1), 0, 1, 0)).rejects.toMatchObject({ code: 'EBADF' });
});

it.each([1, 2, 3])('refuses over-remaining counts after %i actual bytes of progress', async step => {
  const { file } = await fixture();
  intercept(file, h => {
    const read = h.read.bind(h);
    let calls = 0;
    Object.defineProperty(h, 'read', { configurable: true, value: async (b: Uint8Array, o: number, n: number, p: number) => {
      expect(o + n).toBe(b.byteLength);
      if (calls++ === 0) return read(b, o, Math.min(step, n), p);
      // Deliberately invalid backend count, unchanged real held-file metadata.
      return { bytesRead: n + 1, buffer: b };
    } });
  });
  await refusal(readSelectedDataFile(file, 8), 'IO');
});

it('pins diagnostics for empty, root-only and shortest suffix paths without real root IO', async () => {
  const open = vi.spyOn(fs, 'open').mockRejectedValue(Object.assign(new Error('fictional'), { code: 'ENOENT' }));
  for (const [name, code] of [['', 'PATH'], ['/', 'EXTENSION'], ['x', 'PATH'], ['/x', 'EXTENSION'], ['/.gdc', 'EXTENSION']] as const) {
    await refusal(readSelectedDataFile(name, 8), code);
  }
  expect(open).not.toHaveBeenCalled();
  for (const name of ['/.json', '/.wonderdraft_map']) await refusal(readSelectedDataFile(name, 8), 'MISSING');
  expect(open).toHaveBeenCalledTimes(2);
});

it('checks a nonempty final snapshot after a real write following the last post-read stat', async () => {
  const { file } = await fixture();
  const writer = await fs.open(file, 'r+');
  let stats = 0;
  try {
    intercept(file, h => {
      const stat = h.stat.bind(h);
      Object.defineProperty(h, 'stat', { configurable: true, value: async (o: { bigint: true }) => {
        const captured = await stat(o);
        if (++stats === 2) await writer.write(new Uint8Array([90]), 0, 1, 0);
        // Stat2 is the old, genuine native snapshot; stat3 must detect the real write.
        return captured;
      } });
    });
    await refusal(readSelectedDataFile(file, 8), 'CHANGED');
    expect(stats).toBe(3);
  } finally { await writer.close(); }
});

it('maps native read rejection to IO even if the held file also changes', async () => {
  const { file } = await fixture();
  const writer = await fs.open(file, 'r+');
  let stats = 0;
  try {
    intercept(file, h => {
      const stat = h.stat.bind(h);
      Object.defineProperty(h, 'stat', { configurable: true, value: async (o: { bigint: true }) => { stats++; return stat(o); } });
      Object.defineProperty(h, 'read', { configurable: true, value: async () => {
        await writer.write(new Uint8Array([90]), 0, 1, 0);
        throw Object.assign(new Error('fictional-read-error'), { code: 'EIO' });
      } });
    });
    await refusal(readSelectedDataFile(file, 8), 'IO');
    expect(stats).toBe(1);
  } finally { await writer.close(); }
});

it.each([0, -1, 0.5, NaN, Infinity, '2', undefined, {}, true, 1n])(
  'checks changed metadata before interpreting invalid backend count %s', async count => {
    const { file } = await fixture();
    intercept(file, h => {
      const read = h.read.bind(h);
      const stat = h.stat.bind(h);
      let completed = false;
      Object.defineProperty(h, 'read', { configurable: true, value: async (b: Uint8Array, o: number, n: number, p: number) => {
        await read(b, o, n, p);
        completed = true;
        return { bytesRead: count, buffer: b };
      } });
      Object.defineProperty(h, 'stat', { configurable: true, value: async (o: { bigint: true }) => {
        const captured = await stat(o);
        // Simulated bigint metadata delta around a real completed native read, not an in-place write.
        return completed ? { ...captured, ctimeNs: captured.ctimeNs + 1n } : captured;
      } });
    });
    await refusal(readSelectedDataFile(file, 8), 'CHANGED');
  },
);

it('does not settle its public promise before the owned close promise settles', async () => {
  const { file } = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const closing = new Promise<void>(r => { entered = r; });
  let settled = false;
  intercept(file, h => {
    const close = h.close.bind(h);
    Object.defineProperty(h, 'close', { configurable: true, value: async () => {
      await close(); // Always real-close before any gated reporting delay.
      entered();
      await gate;
    } });
  });
  const pending = readSelectedDataFile(file, 8);
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await closing;
    await tick(); // Flush an event-loop turn after an explicit close-entry event, not a fixed sleep.
    expect(settled).toBe(false);
  } finally {
    release();
    await pending;
  }
  expect(settled).toBe(true);
});

it('uses the held file, not a replacement selected path, and permits selected ancestor links', async () => {
  const { file, root } = await fixture();
  const alias = path.join(root, 'selected-alias');
  await fs.symlink(root, alias);
  const selected = path.join(alias, 'invented.json');
  let first = true;
  const open = intercept(selected, async () => {
    if (first) {
      first = false;
      // Swap before the first held snapshot: rename ctime is captured, no atomic-namespace claim.
      await fs.rename(file, path.join(root, 'held-renamed.json'));
      await fs.writeFile(file, 'replaced');
    }
  });
  expect(new TextDecoder().decode(await readSelectedDataFile(selected, 8))).toBe('abcdefgh');
  expect(open).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(file, 'utf8')).toBe('replaced');
});

it.each([1, 2, 3])('normalizes held stat failure at call %i and closes the exact native handle', async failAt => {
  const { file } = await fixture();
  let nativeRead: FileHandle['read'] | undefined;
  intercept(file, h => {
    nativeRead = h.read.bind(h);
    const stat = h.stat.bind(h);
    let calls = 0;
    Object.defineProperty(h, 'stat', { configurable: true, value: async (o: { bigint: true }) => {
      if (++calls === failAt) throw Object.assign(new Error('fictional-stat-failure'), { code: 'EIO' });
      return stat(o);
    } });
  });
  await refusal(readSelectedDataFile(file, 8), 'IO');
  await expect(nativeRead!(new Uint8Array(1), 0, 1, 0)).rejects.toMatchObject({ code: 'EBADF' });
});

