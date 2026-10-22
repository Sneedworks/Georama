import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolveDisplayEnv } from './display-env.mjs';

const binary = createRequire(import.meta.url)('electron');
const { env, args } = await resolveDisplayEnv({ env: process.env, uid: process.getuid(), fs });
const child = spawn(binary, [...args, ...process.argv.slice(2)], { env, stdio: 'inherit' });

const signalHandlers = new Map();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
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
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
