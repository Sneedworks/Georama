import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import {
  configureWindowsSelectedFileHelper,
  readWindowsSelectedFile,
  WINDOWS_SELECTED_HELPER_LIMITS,
} from '../../electron/data/windows-selected-read.ts';

const appRoot = 'C:\\Program Files (x86)\\Georama';
const filename = 'C:\\Users\\Artist\\Maps\\world.wonderdraft_map';

function onWindows<T>(operation: () => T): T {
  // Exercise the Windows-only bridge on Linux runners as well. The temporary
  // platform override is synchronous; no asynchronous work runs under it.
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!original) throw new Error('process.platform descriptor missing');
  Object.defineProperty(process, 'platform', { ...original, value: 'win32' });
  try {
    return operation();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

function fakeChild(pid: number | undefined = 1234) {
  return Object.assign(new EventEmitter(), {
    pid: pid as number | undefined,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

function nextChild(pid?: number) {
  const child = fakeChild(pid);
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  return child;
}

beforeAll(() => configureWindowsSelectedFileHelper(appRoot));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('selected-file native process confinement (host-independent mocks)', () => {
  it('binds the executable to the application installation, ignoring hostile cwd and PATH', async () => {
    const child = nextChild();
    const poisonedCwd = vi.spyOn(process, 'cwd').mockReturnValue('C:\\attacker');
    let work: ReturnType<typeof readWindowsSelectedFile>;
    try {
      work = onWindows(() => readWindowsSelectedFile(filename, 8));
    } finally {
      poisonedCwd.mockRestore();
    }
    expect(spawn).toHaveBeenCalledWith(
      path.win32.join(appRoot, 'out', 'windows', 'georama-win-selected-read.exe'),
      [filename, '8'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true },
    );
    child.stdout.emit('data', Buffer.from([0, 255, 13]));
    child.emit('close', 0);
    expect(await work).toEqual({ bytes: new Uint8Array([0, 255, 13]) });
  });

  it('fails closed if the helper executable is missing or cannot start, then recovers', async () => {
    const absent = nextChild();
    absent.pid = undefined;
    const failed = onWindows(() => readWindowsSelectedFile(filename, 8));
    absent.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    absent.emit('close', -1);
    expect(await failed).toEqual({ error: 'IO' });

    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn denied'); });
    expect(await onWindows(() => readWindowsSelectedFile(filename, 8))).toEqual({ error: 'IO' });

    const child = nextChild();
    const next = onWindows(() => readWindowsSelectedFile(filename, 8));
    child.emit('close', 0);
    expect(await next).toEqual({ bytes: new Uint8Array() });
  });

  it('never forwards output from a failed or malformed helper', async () => {
    for (const [code, stderr] of [[1, 'private path C:\\secret'], [0, 'unexpected']] as const) {
      const child = nextChild();
      const work = onWindows(() => readWindowsSelectedFile(filename, 16));
      child.stdout.emit('data', Buffer.from('PARTIAL-SECRET'));
      child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code);
      expect(await work).toEqual({ error: 'IO' });
    }
  });

  it.each(['PATH', 'EXTENSION', 'LIMIT', 'MISSING', 'TYPE', 'IO', 'CHANGED'])(
    'returns only the path-free %s error token', async (code) => {
      const child = nextChild();
      const work = onWindows(() => readWindowsSelectedFile(filename, 16));
      child.stderr.emit('data', Buffer.from(`${code}\n`));
      child.emit('close', 1);
      expect(await work).toEqual({ error: code });
    },
  );

  it('rejects invalid caps before spawning and does not use a shell', async () => {
    for (const cap of [-1, NaN, Infinity, 0.5, WINDOWS_SELECTED_HELPER_LIMITS.maxBytes + 1]) {
      expect(await onWindows(() => readWindowsSelectedFile(filename, cap))).toEqual({ error: 'LIMIT' });
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('admits exactly two helpers, rejects the third, and frees slots only on close', async () => {
    const children = Array.from({ length: 3 }, () => fakeChild());
    let spawned = 0;
    vi.mocked(spawn).mockImplementation(() => children[spawned++] as unknown as ReturnType<typeof spawn>);
    const first = onWindows(() => readWindowsSelectedFile(filename, 4));
    const second = onWindows(() => readWindowsSelectedFile(filename, 4));
    expect(await onWindows(() => readWindowsSelectedFile(filename, 4))).toEqual({ error: 'IO' });
    expect(spawn).toHaveBeenCalledTimes(2);
    children[0].emit('close', 0);
    expect(await first).toEqual({ bytes: new Uint8Array() });
    const third = onWindows(() => readWindowsSelectedFile(filename, 4));
    expect(spawn).toHaveBeenCalledTimes(3);
    children[1].emit('close', 0);
    children[2].emit('close', 0);
    await Promise.all([second, third]);
  });

  it('kills an oversized stream and never returns its partial or later bytes', async () => {
    const child = nextChild();
    const work = onWindows(() => readWindowsSelectedFile(filename, 3));
    child.stdout.emit('data', Buffer.from([1, 2]));
    child.stdout.emit('data', Buffer.from([3, 4]));
    child.stdout.emit('data', Buffer.from([5]));
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit('close', 0);
    expect(await work).toEqual({ error: 'LIMIT' });
  });

  it('does not leave a grace timer when the child closes synchronously during kill', async () => {
    vi.useFakeTimers();
    const child = nextChild();
    child.kill.mockImplementation(() => {
      child.emit('close', null);
      return true;
    });
    const work = onWindows(() => readWindowsSelectedFile(filename, 1));
    child.stdout.emit('data', Buffer.from([1, 2]));
    expect(await work).toEqual({ error: 'LIMIT' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds timeout/grace without letting a stuck process consume a fresh slot', async () => {
    vi.useFakeTimers();
    const children = Array.from({ length: 3 }, () => fakeChild());
    let spawned = 0;
    vi.mocked(spawn).mockImplementation(() => children[spawned++] as unknown as ReturnType<typeof spawn>);
    const stalled = onWindows(() => readWindowsSelectedFile(filename, 8));
    await vi.advanceTimersByTimeAsync(WINDOWS_SELECTED_HELPER_LIMITS.timeoutMs);
    expect(children[0].kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(WINDOWS_SELECTED_HELPER_LIMITS.terminationGraceMs);
    expect(await stalled).toEqual({ error: 'IO' });
    const other = onWindows(() => readWindowsSelectedFile(filename, 8));
    expect(await onWindows(() => readWindowsSelectedFile(filename, 8))).toEqual({ error: 'IO' });
    expect(spawn).toHaveBeenCalledTimes(2);
    children[0].emit('close', null);
    const third = onWindows(() => readWindowsSelectedFile(filename, 8));
    children[1].emit('close', 0);
    children[2].emit('close', 0);
    await Promise.all([other, third]);
  });

  it('treats stdout and stderr failures as IO and recovers the slot', async () => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const child = nextChild();
      const work = onWindows(() => readWindowsSelectedFile(filename, 8));
      child[stream].emit('error', new Error('stream failure'));
      expect(child.kill).toHaveBeenCalledOnce();
      child.emit('close', null);
      expect(await work).toEqual({ error: 'IO' });
    }
  });
});
