import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
vi.mock('electron', () => ({app: {}, protocol: {}, session: {defaultSession: {}}}));
vi.mock('node:fs/promises', async original => { const actual = await original<typeof import('node:fs/promises')>(); return {...actual, readFile: vi.fn(actual.readFile), realpath: vi.fn(actual.realpath), stat: vi.fn(actual.stat), open: vi.fn(actual.open)}; });
import { handleAppRequest, MAX_UI_ASSET_BYTES, MAX_IN_FLIGHT_BYTES, MAX_IN_FLIGHT_READS, createReadBudget, readBoundedBytes, type ReadBudget } from '../../electron/protocol.ts';
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
    const openMock = vi.mocked(fs.open) as unknown as {
      getMockImplementation(): (...args: never[]) => Promise<FileHandle>;
      mockImplementationOnce(impl: (...args: never[]) => Promise<FileHandle>): void;
    };
    const through = openMock.getMockImplementation();
    openMock.mockImplementationOnce(async (...args: never[]) => {
      const handle = await through(...args);
      vi.spyOn(handle, 'read').mockRejectedValueOnce(Object.assign(new Error('io'), {code: 'EIO'}));
      return handle;
    });
    const r = await get('/index.html');
    expect(r.status).toBe(500); expect(await r.text()).toBe('');
    expect(r.headers.has('content-length')).toBe(false); await headersOn(r);
  });
  it('omits content-length when the body read fails after a successful stat (EACCES reads as 403)', async () => {
    const openMock = vi.mocked(fs.open) as unknown as {
      getMockImplementation(): (...args: never[]) => Promise<FileHandle>;
      mockImplementationOnce(impl: (...args: never[]) => Promise<FileHandle>): void;
    };
    const through = openMock.getMockImplementation();
    openMock.mockImplementationOnce(async (...args: never[]) => {
      const handle = await through(...args);
      vi.spyOn(handle, 'read').mockRejectedValueOnce(Object.assign(new Error('denied'), {code: 'EACCES'}));
      return handle;
    });
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

/** Simple open() seam: the next open returns a real handle with a read-call spy attached. */
function spyNextOpenReads(): () => number {
  const openMock = vi.mocked(fs.open) as unknown as {
    getMockImplementation(): (...args: never[]) => Promise<FileHandle>;
    mockImplementationOnce(impl: (...args: never[]) => Promise<FileHandle>): void;
  };
  const through = openMock.getMockImplementation();
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  openMock.mockImplementationOnce(async (...args: never[]) => {
    const handle = await through(...args);
    spy = vi.spyOn(handle, 'read');
    return handle;
  });
  return () => spy?.mock.calls.length ?? -1;
}

const getWithBudget = (pathname: string, budget: ReadBudget, method = 'GET') =>
  handleAppRequest({url: 'georama://app' + pathname, method, headers: new Headers({})}, root, budget);

describe('admission budget (issue #5 A)', () => {
  it('refuses with 503 and no body read when the aggregate budget is exhausted', async () => {
    expect(MAX_IN_FLIGHT_BYTES).toBe(64 * 1024 * 1024); expect(MAX_IN_FLIGHT_READS).toBe(16);
    const budget = createReadBudget({maxBytes: 1, maxReads: 16});
    const reads = spyNextOpenReads();
    const r = await getWithBudget('/index.html', budget);
    expect(r.status).toBe(503); expect(await r.text()).toBe(''); await headersOn(r);
    expect(reads()).toBe(0);
  });
  it('admits a later request after an earlier one completes (reservation is released)', async () => {
    const budget = createReadBudget({maxBytes: 64, maxReads: 1});
    const first = await getWithBudget('/index.html', budget); expect(first.status).toBe(200); expect(await first.text()).toBe('<!doctype html>control');
    const second = await getWithBudget('/a.png', budget); expect(second.status).toBe(200); expect(await second.text()).toBe('png');
  });
});

describe('descriptor-bound bounded reads (issue #5 C)', () => {
  it('stops at cap+1 and refuses when a handle reports more bytes than requested', async () => {
    let calls = 0;
    const evil = {read: async (buf: Buffer, offset: number, length: number) => { calls += 1; buf.fill(0x61, offset, offset + length); return {bytesRead: length + 1000}; }};
    expect(await readBoundedBytes(evil as never, 10)).toBeNull();
    expect(calls).toBe(1);
  });
  it('returns exact bytes for a well-behaved handle', async () => {
    const chunks = [Buffer.from('hello '), Buffer.from('world')]; let i = 0;
    const good = {read: async (buf: Buffer, offset: number, length: number) => {
      if (i >= chunks.length) return {bytesRead: 0};
      const chunk = chunks[i++]; const n = Math.min(chunk.length, length); chunk.copy(buf, offset, 0, n); return {bytesRead: n};
    }};
    expect((await readBoundedBytes(good as never, 1024))?.toString()).toBe('hello world');
  });
  it('refuses a real file larger than the cap when opened without reading past the bound', async () => {
    const reads = spyNextOpenReads();
    const r = await get('/large.png');
    expect(r.status).toBe(413); expect(await r.text()).toBe(''); await headersOn(r);
    expect(vi.mocked(fs.open)).toHaveBeenCalled(); expect(reads()).toBe(0);
  });
  it('HEAD opens for metadata but never reads the body', async () => {
    const reads = spyNextOpenReads();
    const r = await get('/index.html', 'HEAD');
    expect(r.status).toBe(200); expect(await r.text()).toBe(''); expect(r.headers.get('content-length')).toBe('22'); await headersOn(r);
    expect(reads()).toBe(0);
  });
});

describe.skipIf(process.platform === 'win32')('non-regular files (issue #5 B stall part)', () => {
  it('refuses a FIFO quickly instead of blocking', async () => {
    const fifoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-protocol-fifo-'));
    try {
      const fifo = path.join(fifoRoot, 'swap');
      execFileSync('mkfifo', [fifo]);
      // Simulate the stat/open window: stat once saw a regular file, but the descriptor is a FIFO.
      vi.mocked(fs.stat).mockResolvedValueOnce({isFile: () => true, size: 8} as never);
      const r = await handleAppRequest({url: 'georama://app/swap', method: 'GET', headers: new Headers({})}, fifoRoot);
      expect(r.status).toBe(404); expect(await r.text()).toBe('');
      expect(r.headers.get('content-security-policy')).toBe(buildCsp()); expect(r.headers.get('x-content-type-options')).toBe('nosniff'); expect(r.headers.get('cache-control')).toBe('no-store');
    } finally {
      await fs.rm(fifoRoot, {recursive: true, force: true});
    }
  }, 3000);
});
