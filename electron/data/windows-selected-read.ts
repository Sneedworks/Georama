import { spawn } from 'node:child_process';
import path from 'node:path';
import { isNativeAbsolutePath } from '../native-path.ts';

export type WindowsSelectedReadError = 'PATH' | 'EXTENSION' | 'LIMIT' | 'MISSING' | 'TYPE' | 'IO' | 'CHANGED';
export interface WindowsSelectedReadResult {
  readonly bytes?: Uint8Array;
  readonly error?: WindowsSelectedReadError;
}

export const WINDOWS_SELECTED_HELPER_LIMITS = Object.freeze({
  maxBytes: 512 * 1024 * 1024,
  maxConcurrent: 2,
  timeoutMs: 120_000,
  terminationGraceMs: 3_000,
});

const ERROR_CODES = new Set<WindowsSelectedReadError>(
  ['PATH', 'EXTENSION', 'LIMIT', 'MISSING', 'TYPE', 'IO', 'CHANGED'],
);
let configuredHelper: string | undefined;
let activeHelpers = 0;

/**
 * Resolve once against the trusted installed application root, not cwd or a
 * user-selected file directory. A missing helper fails closed; there is no
 * JavaScript lstat/open fallback. Packaging and publisher authentication
 * require separate review before a signed release.
 */
export function configureWindowsSelectedFileHelper(appRoot: string): void {
  if (configuredHelper !== undefined) throw new Error('Windows selected-file helper already configured');
  if (!isNativeAbsolutePath(appRoot, 'win32')) {
    throw new Error('Windows selected-file helper requires a canonical absolute application root');
  }
  configuredHelper = path.win32.join(appRoot, 'out', 'windows', 'georama-win-selected-read.exe');
}

/**
 * Delegate the full pathname traversal to the native held-HANDLE reader.
 * Every ancestor is opened without DELETE sharing and checked for reparse
 * metadata. Nothing read by the child reaches the caller unless it exits 0.
 */
export function readWindowsSelectedFile(
  filename: string,
  maxBytes: number,
): Promise<WindowsSelectedReadResult> {
  if (process.platform !== 'win32' || configuredHelper === undefined) {
    return Promise.resolve({ error: 'IO' });
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > WINDOWS_SELECTED_HELPER_LIMITS.maxBytes) {
    return Promise.resolve({ error: 'LIMIT' });
  }
  if (activeHelpers >= WINDOWS_SELECTED_HELPER_LIMITS.maxConcurrent) {
    return Promise.resolve({ error: 'IO' });
  }

  activeHelpers += 1;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(configuredHelper, [filename, String(maxBytes)], {
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true,
    });
  } catch {
    activeHelpers -= 1;
    return Promise.resolve({ error: 'IO' });
  }

  return new Promise<WindowsSelectedReadResult>((resolve) => {
    let settled = false;
    let released = false;
    let forcedError: WindowsSelectedReadError | undefined;
    let stderr = '';
    let count = 0;
    const chunks: Buffer[] = [];
    let grace: ReturnType<typeof setTimeout> | undefined;

    const release = (): void => {
      if (released) return;
      released = true;
      activeHelpers -= 1;
    };
    const finish = (result: WindowsSelectedReadResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (grace !== undefined) clearTimeout(grace);
      chunks.length = 0;
      resolve(result);
    };
    const terminate = (error: WindowsSelectedReadError): void => {
      if (forcedError !== undefined || settled) return;
      forcedError = error;
      chunks.length = 0;
      try { child.kill(); } catch { /* the close/grace path remains fail-closed */ }
      grace = setTimeout(() => finish({ error }), WINDOWS_SELECTED_HELPER_LIMITS.terminationGraceMs);
    };
    const watchdog = setTimeout(() => terminate('IO'), WINDOWS_SELECTED_HELPER_LIMITS.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || forcedError !== undefined) return;
      if (chunk.byteLength > maxBytes - count) return terminate('LIMIT');
      count += chunk.byteLength;
      chunks.push(chunk);
    });
    child.stdout?.once('error', () => terminate('IO'));
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (stderr.length < 128) stderr += chunk.toString('utf8').slice(0, 128 - stderr.length);
    });
    child.stderr?.once('error', () => terminate('IO'));
    child.once('error', () => {
      if (child.pid === undefined) {
        release();
        finish({ error: 'IO' });
      } else {
        terminate('IO');
      }
    });
    child.once('close', (code) => {
      release();
      if (forcedError !== undefined) return finish({ error: forcedError });
      if (code === 0 && stderr === '') {
        const bytes = Buffer.concat(chunks, count);
        return finish({ bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
      }
      const token = stderr.trim() as WindowsSelectedReadError;
      finish({ error: ERROR_CODES.has(token) ? token : 'IO' });
    });
  });
}
