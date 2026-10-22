import path from 'node:path';

export async function resolveDisplayEnv({ env: inherited, uid, fs }) {
  const env = { ...inherited };
  const fallback = `/run/user/${uid}`;
  const args = ['--ozone-platform=wayland'];
  const isSocket = async (socket) => {
    try { return (await fs.stat(socket)).isSocket(); }
    catch { return false; } // A stale or inaccessible display passes through unchanged.
  };

  if (env.WAYLAND_DISPLAY) {
    const absolute = path.isAbsolute(env.WAYLAND_DISPLAY);
    const socket = absolute ? env.WAYLAND_DISPLAY : path.join(env.XDG_RUNTIME_DIR ?? fallback, env.WAYLAND_DISPLAY);
    if (!await isSocket(socket)) return { env, args: [] };
    if (!absolute) env.XDG_RUNTIME_DIR ??= fallback;
    return { env, args };
  }

  for (const directory of new Set([env.XDG_RUNTIME_DIR, fallback].filter(Boolean))) {
    let names;
    try { names = await fs.readdir(directory); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    const candidates = names.filter((entry) => /^wayland-\d+$/.test(entry))
      .sort((left, right) => Number(left.slice(8)) - Number(right.slice(8)) || left.localeCompare(right));
    for (const name of candidates) {
      const socket = path.join(directory, name);
      if (!await isSocket(socket)) continue;
      // An inherited runtime directory may serve more than Wayland: do not replace it.
      env.WAYLAND_DISPLAY = env.XDG_RUNTIME_DIR && env.XDG_RUNTIME_DIR !== directory ? socket : name;
      env.XDG_RUNTIME_DIR ??= directory;
      return { env, args };
    }
  }
  return { env, args: [] };
}
