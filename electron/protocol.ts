import { readFile, realpath, stat } from 'node:fs/promises';
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

/** Electron-independent request core; rendererRoot is injectable for disposable tests. */
export async function handleAppRequest(request: {url: string; method: string; headers?: Headers}, rendererRoot: string): Promise<Response> {
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
    const metadata = await stat(realFile);
    if (!metadata.isFile()) return errorResponse(404);
    if (metadata.size > MAX_UI_ASSET_BYTES) return errorResponse(413);
    headers['Content-Length'] = String(metadata.size);
    headers['Content-Type'] = contentTypes[path.extname(realFile).toLowerCase()] ?? 'application/octet-stream';
    // Range is intentionally ignored: return 200 and the full bounded representation.
    if (request.method === 'HEAD') return new Response(null, {status: 200, headers});
    const bytes = await readFile(realFile);
    if (bytes.byteLength > MAX_UI_ASSET_BYTES) { delete headers['Content-Length']; return errorResponse(413); }
    headers['Content-Length'] = String(bytes.byteLength);
    // Buffer is already a Uint8Array; the assertion changes no bytes and makes no copy.
    return new Response(bytes as Uint8Array<ArrayBuffer>, {status: 200, headers});
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const status = code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR' ? 404 : code === 'EACCES' ? 403 : 500;
    delete headers['Content-Length'];
    return errorResponse(status);
  }
}

/** Install only after app.whenReady(); never serve anything outside the renderer build. */
export function installAppProtocol(): void {
  const rendererRoot = path.join(app.getAppPath(), 'dist', 'renderer');
  protocol.handle(BRAND.scheme, request => handleAppRequest(request, rendererRoot));
}
