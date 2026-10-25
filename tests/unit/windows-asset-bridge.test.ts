import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { readWindowsAsset } from '../../electron/assets/windows-read.ts';

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}

afterEach(() => { vi.clearAllMocks(); });

describe('bounded native Windows process bridge (portable mocks)', () => {
  it('returns binary-safe bytes only after a clean zero exit', async () => {
    const child = childProcess();
    const work = readWindowsAsset('C:\\assets', 'pack/tree.png', 5);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('georama-win-asset-read.exe'),
      ['C:\\assets', 'pack/tree.png', '5'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true },
    );
    child.stdout.emit('data', Buffer.from([0, 1, 255]));
    child.stdout.emit('data', Buffer.from([13, 0]));
    child.emit('close', 0);
    expect(await work).toEqual({ bytes: new Uint8Array([0, 1, 255, 13, 0]) });
  });

  it.each(['PATH', 'TYPE', 'MISSING', 'LIMIT', 'IO'])('preserves only known path-free %s failure tokens', async (code) => {
    const child = childProcess();
    const work = readWindowsAsset('C:\\assets', 'pack/missing.png', 9);
    child.stderr.emit('data', Buffer.from(code + '\n'));
    child.emit('close', 1);
    expect(await work).toEqual({ error: code });
  });

  it('rejects malformed helper stderr and nonzero exits without leaking output', async () => {
    const child = childProcess();
    const work = readWindowsAsset('C:\\assets', 'pack/leaf.png', 10);
    child.stdout.emit('data', Buffer.from('partial'));
    child.stderr.emit('data', Buffer.from('ERROR: C:\\private\\secret'));
    child.emit('close', 2);
    expect(await work).toEqual({ error: 'IO' });
  });

  it('rejects a successful exit with unexpected stderr', async () => {
    const child = childProcess();
    const work = readWindowsAsset('C:\\assets', 'pack/leaf.png', 10);
    child.stderr.emit('data', Buffer.from('unexpected'));
    child.emit('close', 0);
    expect(await work).toEqual({ error: 'IO' });
  });

  it('kills a helper that attempts to exceed the authorized byte cap', async () => {
    const child = childProcess();
    const work = readWindowsAsset('C:\\assets', 'pack/leaf.png', 3);
    child.stdout.emit('data', Buffer.from([1, 2, 3, 4]));
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit('close', null);
    expect(await work).toEqual({ error: 'LIMIT' });
  });

  it('treats absent executables and spawn failures as IO', async () => {
    const child = childProcess();
    const work = readWindowsAsset('C:\\assets', 'pack/leaf.png', 3);
    child.emit('error', Object.assign(new Error('missing helper'), { code: 'ENOENT' }));
    child.emit('close', -1);
    expect(await work).toEqual({ error: 'IO' });
  });
});
