import { spawn } from 'node:child_process';
import path from 'node:path';

export type WindowsReadError = 'PATH' | 'EXTENSION' | 'LIMIT' | 'MISSING' | 'TYPE' | 'IO';

export interface WindowsReadResult {
  readonly bytes?: Uint8Array;
  readonly error?: WindowsReadError;
}

const MESSAGES = new Set(['PATH', 'LIMIT', 'MISSING', 'TYPE', 'IO']);
const TIMEOUT_MS = 60_000;

/**
 * A dedicated Windows process opens/checks each HANDLE before emitting bytes.
 * No JavaScript realpath/lstat/exists preflight is used for authorization.
 * Absent native binary, spawn errors, timeouts and malformed responses fail
 * closed as IO. The binary is built explicitly, not downloaded dynamically.
 *
 * For this development milestone the helper path is relative to the checkout.
 * Distribution must package and authenticate the helper separately.
 */
export function readWindowsAsset(
  root: string,
  relative: string,
  maxBytes: number,
): Promise<WindowsReadResult> {
  const binary = path.resolve(process.cwd(), 'out', 'windows', 'georama-win-asset-read.exe');
  return new Promise((resolve) => {
    let done = false;
    let overflow = false;
    let stderr = '';
    let count = 0;
    const chunks: Buffer[] = [];
    const finish = (result: WindowsReadResult): void => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      resolve(result);
    };
    const child = spawn(binary, [root, relative, String(maxBytes)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    const watchdog = setTimeout(() => {
      child.kill();
      finish({ error: 'IO' });
    }, TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      count += chunk.byteLength;
      if (count > maxBytes) {
        overflow = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length <= 256) stderr += chunk.toString('utf8');
    });
    child.once('error', () => finish({ error: 'IO' }));
    child.once('close', (code) => {
      if (overflow) return finish({ error: 'LIMIT' });
      if (code === 0 && stderr === '') {
        const bytes = Buffer.concat(chunks, count);
        return finish({ bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
      }
      const token = stderr.trim();
      finish({ error: MESSAGES.has(token) ? token as WindowsReadError : 'IO' });
    });
  });
}
