import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { launcherSignals, resolveLauncherEnv } from './display-env.mjs';

const binary = createRequire(import.meta.url)('electron');
const { env, args } = await resolveLauncherEnv({
  platform: process.platform,
  env: process.env,
  fs,
  getuid: () => process.getuid(),
});
const child = spawn(binary, [...args, ...process.argv.slice(2)], { env, stdio: 'inherit' });

const signalHandlers = new Map();
for (const signal of launcherSignals(process.platform)) {
  const handler = () => child.kill(signal);
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

child.once('error', (error) => {
  console.error(`Could not launch Electron: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  for (const [name, handler] of signalHandlers) process.off(name, handler);
  // Windows cannot reliably re-raise Unix signals to itself. Preserve the
  // original POSIX signal exit behavior on Linux and other Unix platforms.
  if (signal && process.platform !== 'win32') process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
