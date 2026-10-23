import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { app, protocol } from 'electron';
import { BRAND } from '../src/shared/brand.ts';
import { resolveAppPath } from './app-path.ts';
import { buildCsp, isTrustedAppUrl } from './security.ts';

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: BRAND.scheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

// UI resources only; large assets get a separate bounded reader.
export const MAX_UI_ASSET_BYTES = 16 * 1024 * 1024;
// Aggregate admission budget: at most four maximum-size assets may be read concurrently.
export const MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024;
// Aggregate admission budget: at most this many asset reads may be in flight at once.
export const MAX_IN_FLIGHT_READS = 16;
/** Limits accepted by createReadBudget; each defaults to the matching MAX_IN_FLIGHT_* constant. */
export interface ReadBudgetLimits { maxBytes?: number; maxReads?: number }
/** A concurrency budget for asset reads: tryReserve admits a read, release returns it. */
export interface ReadBudget { tryReserve(size: number): boolean; release(size: number): void }
/** Creates an isolated admission budget (tests use small limits to exercise refusal without large files). */
export function createReadBudget(limits: ReadBudgetLimits = {}): ReadBudget {
  const maxBytes = limits.maxBytes ?? MAX_IN_FLIGHT_BYTES;
  const maxReads = limits.maxReads ?? MAX_IN_FLIGHT_READS;
  let inFlightBytes = 0, inFlightReads = 0;
  return {
    tryReserve(size: number): boolean {
      if (inFlightReads + 1 > maxReads || inFlightBytes + size > maxBytes) return false;
      inFlightReads += 1; inFlightBytes += size; return true;
    },
    release(size: number): void {
      inFlightReads = Math.max(0, inFlightReads - 1);
      inFlightBytes = Math.max(0, inFlightBytes - size);
    },
  };
}
/** Module-level admission budget built from the MAX_IN_FLIGHT_* constants. */
export const defaultReadBudget: ReadBudget = createReadBudget();
/** Reads at most cap+1 bytes from an open descriptor; returns null when the content exceeds cap. */
export async function readBoundedBytes(handle: FileHandle, cap: number = MAX_UI_ASSET_BYTES): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const remaining = cap + 1 - total;
    if (remaining <= 0) return null;
    // Small fixed-size chunks: transient memory stays near one chunk however large the
    // cap is, and the total ever requested from the descriptor never exceeds cap+1.
    const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
    const {bytesRead} = await handle.read(buf, 0, buf.length, null);
    if (bytesRead === 0) break;
    // Clamp: a faulty handle must not report more than was requested.
    const n = Math.min(Math.max(bytesRead, 0), buf.length);
    chunks.push(n === buf.length ? buf : buf.subarray(0, n));
    total += n;
    if (total > cap) return null;
  }
  return Buffer.concat(chunks, total);
}

// One chunk per in-flight read bounds transient memory well below the aggregate budget.
const READ_CHUNK_BYTES = 64 * 1024;

// Undefined on some platforms (Windows); 0 keeps the open flags valid there.
const O_RDONLY = constants.O_RDONLY ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** Electron-independent request core; rendererRoot is injectable for disposable tests. */
export async function handleAppRequest(request: {url: string; method: string; headers?: Headers}, rendererRoot: string, budget: ReadBudget = defaultReadBudget): Promise<Response> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': buildCsp(),
    'Accept-Ranges': 'none',
  };
  const errorResponse = (status: number): Response => new Response(null, {status, headers});
  if (request.url.length > 4096) return errorResponse(414);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers['Allow'] = 'GET, HEAD';
    return errorResponse(405);
  }
  if (!isTrustedAppUrl(request.url)) return errorResponse(404);
  const url = new URL(request.url);
  let decoded: string;
  try { decoded = decodeURIComponent(url.pathname); } catch { return errorResponse(400); }
  if (decoded.length > 1024 || decoded.split('/').some(segment => Buffer.byteLength(segment, 'utf8') > 255)) return errorResponse(414);
  const filename = resolveAppPath(rendererRoot, url.pathname);
  if (filename === null) return errorResponse(400);
  try {
    const [realRoot, realFile] = await Promise.all([realpath(rendererRoot), realpath(filename)]);
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) return errorResponse(403);
    // Defence in depth: the realpath containment check above stays, but metadata and bytes
    // below come from one open descriptor, so a swap after the check cannot redirect them.
    // O_NONBLOCK keeps the open itself from blocking on a FIFO; O_NOFOLLOW refuses a
    // final-component symlink planted after the check.
    const handle = await open(realFile, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) return errorResponse(404);
      if (metadata.size > MAX_UI_ASSET_BYTES) return errorResponse(413);
      headers['Content-Length'] = String(metadata.size);
      headers['Content-Type'] = contentTypes[path.extname(realFile).toLowerCase()] ?? 'application/octet-stream';
      // Range is intentionally ignored: return 200 and the full bounded representation.
      if (request.method === 'HEAD') return new Response(null, {status: 200, headers});
      if (!budget.tryReserve(metadata.size)) { delete headers['Content-Length']; return errorResponse(503); }
      try {
        const bytes = await readBoundedBytes(handle);
        // Growth after open: content past the cap is refused without ever reading past cap+1.
        if (bytes === null) { delete headers['Content-Length']; return errorResponse(413); }
        headers['Content-Length'] = String(bytes.byteLength);
        // Buffer is already a Uint8Array; the assertion changes no bytes and makes no copy.
        return new Response(bytes as Uint8Array<ArrayBuffer>, {status: 200, headers});
      } finally {
        budget.release(metadata.size);
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR' || code === 'ELOOP' ? 404 : code === 'EACCES' ? 403 : 500;
    delete headers['Content-Length'];
    return errorResponse(status);
  }
}

/** Install only after app.whenReady(); never serve anything outside the renderer build. */
export function installAppProtocol(): void {
  const rendererRoot = path.join(app.getAppPath(), 'dist', 'renderer');
  protocol.handle(BRAND.scheme, request => handleAppRequest(request, rendererRoot));
}
