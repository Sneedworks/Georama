import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
vi.mock('electron', () => ({app: {}, protocol: {}, session: {defaultSession: {}}}));
vi.mock('node:fs/promises', async original => { const actual = await original<typeof import('node:fs/promises')>(); return {...actual, readFile: vi.fn(actual.readFile), realpath: vi.fn(actual.realpath), stat: vi.fn(actual.stat)}; });
import { handleAppRequest, MAX_UI_ASSET_BYTES } from '../../electron/protocol.ts';
import { buildCsp } from '../../electron/security.ts';
let temp: string, root: string;
const get = (pathname: string, method = 'GET', headers = {}) => handleAppRequest({url: 'georama://app' + pathname, method, headers: new Headers(headers)}, root);
beforeAll(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-protocol-')); root = path.join(temp, 'renderer');
  await fs.mkdir(root); await fs.mkdir(root + '-other');
  for (const [name, value] of Object.entries({'index.html': '<!doctype html>control', 'a.js': 'postMessage(1)', 'a.mjs': 'postMessage(2)', 'a.css': 'body{}', 'a.json': '{}', 'a.svg': '<svg></svg>', 'a.png': 'png', 'a.jpg': 'jpg', 'a.webp': 'webp', 'a.woff2': 'font', 'a.ttf': 'ttf', 'a.wasm': 'wasm', 'a.map': '{}', 'a.xyz': 'xyz', 'noext': 'noext', 'café.txt': 'composed', 'café.txt': 'decomposed'})) await fs.writeFile(path.join(root, name), value);
  await fs.writeFile(path.join(temp, 'outside.txt'), 'outside'); await fs.writeFile(path.join(root + '-other', 'outside.txt'), 'outside');
  await fs.symlink(path.join(root, 'index.html'), path.join(root, 'inside.html'));
  await fs.symlink(path.join(temp, 'outside.txt'), path.join(root, 'escape'));
  await fs.symlink(path.join(root + '-other', 'outside.txt'), path.join(root, 'sibling'));
  await fs.writeFile(path.join(root, 'large.png'), ''); await fs.truncate(path.join(root, 'large.png'), 16 * 1024 * 1024 + 1);
});
afterAll(async () => fs.rm(temp, {recursive: true, force: true}));
beforeEach(() => vi.clearAllMocks());
async function headersOn(response: Response) {
  expect(response.headers.get('content-security-policy')).toBe(buildCsp()); expect(response.headers.get('x-content-type-options')).toBe('nosniff'); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('accept-ranges')).toBe('none');
}
describe('bounded UI protocol core', () => {
  it('GET returns exact bytes and length without a second buffer copy', async () => {
    const response = await get('/index.html'); expect(response.status).toBe(200); expect(await response.text()).toBe('<!doctype html>control'); expect(response.headers.get('content-length')).toBe('22'); await headersOn(response);
  });
  it('HEAD uses metadata, never reads the body', async () => {
    const response = await get('/index.html', 'HEAD'); expect(response.status).toBe(200); expect(await response.text()).toBe(''); expect(fs.readFile).not.toHaveBeenCalled(); expect(response.headers.get('content-length')).toBe('22'); await headersOn(response);
  });
  it.each(['.js', '.css', '.json', '.png', '.woff2'])('sends the identical CSP for %s', async ext => { const response = await get('/a' + ext); expect(response.status).toBe(200); await headersOn(response); });
  it('ignores Range deliberately and serves the full representation', async () => { const r = await get('/index.html', 'GET', {Range: 'bytes=0-3'}); expect(r.status).toBe(200); expect(await r.text()).toBe('<!doctype html>control'); await headersOn(r); });
  it.each([['/index.html', 'POST', 405], ['/missing', 'GET', 404], ['/escape', 'GET', 403], ['/sibling', 'GET', 403], ['/large.png', 'GET', 413]] as const)('returns a path-free error for %s %s', async (url, method, status) => {
    const r = await get(url, method); expect(r.status).toBe(status); expect(await r.text()).toBe(''); await headersOn(r); if (status === 405) expect(r.headers.get('allow')).toBe('GET, HEAD');
  });
  it('caps UI files at 16 MiB before any body read', async () => { expect(MAX_UI_ASSET_BYTES).toBe(16 * 1024 * 1024); expect((await get('/large.png')).status).toBe(413); expect(fs.readFile).not.toHaveBeenCalled(); });
  it('omits content-length when the body read fails after a successful stat (EIO reads as 500)', async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({isFile: () => true, size: 10} as never);
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('io'), {code: 'EIO'}));
    const r = await get('/index.html');
    expect(r.status).toBe(500); expect(await r.text()).toBe('');
    expect(r.headers.has('content-length')).toBe(false); await headersOn(r);
  });
  it('omits content-length when the body read fails after a successful stat (EACCES reads as 403)', async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({isFile: () => true, size: 10} as never);
    vi.mocked(fs.readFile).mockRejectedValueOnce(Object.assign(new Error('denied'), {code: 'EACCES'}));
    const r = await get('/index.html');
    expect(r.status).toBe(403); expect(await r.text()).toBe('');
    expect(r.headers.has('content-length')).toBe(false); await headersOn(r);
  });
  it('carries content-length equal to the byte length on a successful GET', async () => {
    const r = await get('/a.png');
    expect(r.status).toBe(200);
    const bytes = new TextEncoder().encode('png');
    expect(r.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(await r.text()).toBe('png');
  });
  it.each([
    ['/index.html', 'text/html; charset=utf-8'],
    ['/a.js', 'text/javascript; charset=utf-8'],
    ['/a.mjs', 'text/javascript; charset=utf-8'],
    ['/a.css', 'text/css; charset=utf-8'],
    ['/a.json', 'application/json; charset=utf-8'],
    ['/a.svg', 'image/svg+xml'],
    ['/a.png', 'image/png'],
    ['/a.jpg', 'image/jpeg'],
    ['/a.webp', 'image/webp'],
    ['/a.woff2', 'font/woff2'],
    ['/a.ttf', 'font/ttf'],
    ['/a.wasm', 'application/wasm'],
    ['/a.map', 'application/json; charset=utf-8'],
    ['/a.xyz', 'application/octet-stream'],
    ['/noext', 'application/octet-stream'],
  ] as const)('serves exact content-type for GET %s', async (url, type) => {
    const r = await get(url);
    expect(r.status).toBe(200); expect(r.headers.get('content-type')).toBe(type);
  });
  it.each([
    ['/index.html', 'text/html; charset=utf-8'],
    ['/a.js', 'text/javascript; charset=utf-8'],
    ['/a.mjs', 'text/javascript; charset=utf-8'],
    ['/a.css', 'text/css; charset=utf-8'],
    ['/a.json', 'application/json; charset=utf-8'],
    ['/a.svg', 'image/svg+xml'],
    ['/a.png', 'image/png'],
    ['/a.jpg', 'image/jpeg'],
    ['/a.webp', 'image/webp'],
    ['/a.woff2', 'font/woff2'],
    ['/a.ttf', 'font/ttf'],
    ['/a.wasm', 'application/wasm'],
    ['/a.map', 'application/json; charset=utf-8'],
    ['/a.xyz', 'application/octet-stream'],
    ['/noext', 'application/octet-stream'],
  ] as const)('serves exact content-type for HEAD %s', async (url, type) => {
    const r = await get(url, 'HEAD');
    expect(r.status).toBe(200); expect(r.headers.get('content-type')).toBe(type);
  });
  it('allows an in-root symlink', async () => { const r = await get('/inside.html'); expect(r.status).toBe(200); expect(await r.text()).toBe('<!doctype html>control'); });
  it.each(['/..%2foutside', '/%2e%2e%5coutside', '/a%2f..%2findex.html', '/%252e%252e%252foutside', '/%00index.html', '/a\\b', '/%5cindex.html', '/%E0%A4%A'])('rejects traversal or ambiguity %s', async url => { const r = await get(url); expect(r.status).toBe(400); expect(await r.text()).toBe(''); await headersOn(r); });
  it.each(['/../outside', '/%2e%2e/outside'])('URL parsing removes dot segments from %s before the handler sees it, so it cannot leave the root', async url => {
    expect(new URL('georama://app' + url).pathname).toBe('/outside');
    const r = await get(url); expect(r.status).toBe(404); expect(await r.text()).toBe(''); await headersOn(r);
  });
  it('retains decoded separators that are not traversal (existing semantics)', async () => { expect((await get('/%2findex.html')).status).toBe(200); expect((await get('/%252findex.html')).status).toBe(400); });
  it('preserves Linux Unicode, case, trailing dot and trailing separator semantics', async () => {
    for (const [url, body] of [['/caf%C3%A9.txt', 'composed'], ['/cafe%CC%81.txt', 'decomposed']]) expect(await (await get(url!)).text()).toBe(body);
    expect((await get('/INDEX.HTML')).status).toBe(404); expect((await get('/index.html.')).status).toBe(404); expect((await get('/index.html/')).status).toBe(200);
  });
  it.each(['/' + 'x'.repeat(4100), '/' + Array(6).fill('a'.repeat(200)).join('/'), '/' + 'é'.repeat(128)])('bounds raw URL, decoded path or UTF-8 segment length before filesystem work', async url => { const r = await get(url); expect(r.status).toBe(414); expect(await r.text()).toBe(''); expect(fs.realpath).not.toHaveBeenCalled(); expect(fs.stat).not.toHaveBeenCalled(); expect(fs.readFile).not.toHaveBeenCalled(); await headersOn(r); });
  it('bounds the raw URL on its own: a long query on a short path is 414 before any filesystem work', async () => {
    const r = await get('/index.html?' + 'q'.repeat(4100));
    expect(r.status).toBe(414); expect(await r.text()).toBe('');
    expect(fs.realpath).not.toHaveBeenCalled(); expect(fs.stat).not.toHaveBeenCalled(); expect(fs.readFile).not.toHaveBeenCalled();
    expect((await get('/index.html?' + 'q'.repeat(100))).status).toBe(200);
  });
  it.each(['http://app/index.html', 'georama://app.evil/index.html', 'georama://app@other/index.html', 'georama://user@app/index.html', 'georama://app:80/index.html'])('rejects handler authority %s', async url => { const r = await handleAppRequest({url, method: 'GET'}, root); expect(r.status).toBe(404); await headersOn(r); });
});
