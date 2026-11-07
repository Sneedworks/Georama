import { describe, expect, it, vi } from 'vitest';
import { launcherSignals, resolveLauncherEnv } from '../../scripts/display-env.mjs';
import type { DisplayFileSystem } from '../../scripts/display-env.mjs';

describe('native launcher platform selection', () => {
  it.each(['win32', 'darwin', 'freebsd'])('leaves %s environment untouched without querying Linux uid or sockets', async (platform) => {
    const env = { DISPLAY: ':7', WAYLAND_DISPLAY: 'ignored-on-Windows', XDG_RUNTIME_DIR: '/inherited', MY_FLAG: 'unchanged' };
    const getuid = vi.fn(() => { throw new Error('Linux-only getuid called'); });
    const fs: DisplayFileSystem = {
      readdir: vi.fn(async () => { throw new Error('Linux-only readdir called'); }),
      stat: vi.fn(async () => { throw new Error('Linux-only stat called'); }),
    };
    const result = await resolveLauncherEnv({ platform, env, fs, getuid });
    expect(result).toEqual({ env, args: [] });
    expect(result.env).not.toBe(env);
    expect(env).toEqual({ DISPLAY: ':7', WAYLAND_DISPLAY: 'ignored-on-Windows', XDG_RUNTIME_DIR: '/inherited', MY_FLAG: 'unchanged' });
    expect(getuid).not.toHaveBeenCalled();
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it('keeps the original Linux Wayland resolver and POSIX path semantics', async () => {
    const getuid = vi.fn(() => 1000);
    const fs: DisplayFileSystem = {
      readdir: vi.fn(async (directory: string) => directory === '/run/user/1000' ? ['wayland-2', 'wayland-0'] : []),
      stat: vi.fn(async (socket: string) => ({ isSocket: () => socket === '/run/user/1000/wayland-0' })),
    };
    const result = await resolveLauncherEnv({
      platform: 'linux', env: { KEEP: 'value' }, getuid, fs,
    });
    expect(result).toEqual({
      env: { KEEP: 'value', XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: 'wayland-0' },
      args: ['--ozone-platform=wayland'],
    });
    expect(getuid).toHaveBeenCalledOnce();
    expect(fs.readdir).toHaveBeenCalledWith('/run/user/1000');
    expect(fs.stat).toHaveBeenCalledWith('/run/user/1000/wayland-0');
  });

  it('preserves Linux fallback behavior when display detection finds no socket', async () => {
    const fs: DisplayFileSystem = {
      readdir: async () => [],
      stat: async () => ({ isSocket: () => false }),
    };
    expect(await resolveLauncherEnv({ platform: 'linux', env: { DISPLAY: ':1' }, fs, getuid: () => 1000 }))
      .toEqual({ env: { DISPLAY: ':1' }, args: [] });
  });

  it('does not try Unix SIGHUP on Windows and retains the Unix signal contract', () => {
    expect(launcherSignals('win32')).toEqual(['SIGINT', 'SIGTERM']);
    expect(launcherSignals('linux')).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
    expect(launcherSignals('darwin')).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP']);
  });
});
