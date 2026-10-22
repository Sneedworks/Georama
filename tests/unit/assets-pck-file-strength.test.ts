import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as immediate } from 'node:timers/promises';
import { openPckFile } from '../../electron/assets/pck-file.ts';
import type { PckFile } from '../../electron/assets/pck-file.ts';
import { parsePckIndex, PCK_LIMITS } from '../../src/core/assets/pck.ts';
import { buildPck } from '../helpers/pck-synthetic.ts';

const KEY = 'res://synthetic/strength.png';
const DATA = Uint8Array.from([0xa1, 0xb2, 0xc3, 0xd4]);
const dirs: string[] = [];
async function fixture(bytes = buildPck([{ path: KEY, data: DATA }], { gapAfterIndex: 0 })) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pck-strength-'));
  dirs.push(root);
  const file = path.join(root, 'Wonderdraft.pck');
  await fs.writeFile(file, bytes);
  return { root, file, bytes };
}
function watchArchive(setup: (handle: FileHandle) => void): void {
  const real = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (arg, flags, mode) => {
    const handle = await real(arg as string, flags as number, mode as unknown as undefined);
    if (String(arg).endsWith('/Wonderdraft.pck')) setup(handle);
    return handle;
  });
}
async function typedFailure(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    const value = await promise;
    if (value && typeof value === 'object' && 'close' in value && typeof value.close === 'function') await value.close();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(['PckError', 'PckFileError']).toContain((error as Error).name);
    expect((error as { code: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected typed ${code} refusal`);
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Controlled I/O did not reach its expected event');
    await immediate();
  }
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('../../src/core/assets/pck.ts');
  vi.resetModules();
  for (const root of dirs.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('PCK independent snapshot and read-strength contracts', () => {
  it('rejects a zero-entry archive changed during its header read', async () => {
    const f = await fixture(buildPck([], { gapAfterIndex: 0 }));
    let changed = false;
    const handles: FileHandle[] = [];
    watchArchive((handle) => {
      handles.push(handle);
      const raw = handle.read.bind(handle);
      Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const result = await raw(buffer, offset, length, position);
        if (!changed && position === 0) {
          changed = true;
          await fs.appendFile(f.file, Uint8Array.from([1, 2, 3, 4]));
        }
        return result;
      } });
    });
    await typedFailure(openPckFile(f.root), 'CHANGED');
    expect(changed).toBe(true);
    for (const handle of handles) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('records the exact metadata trace and validates every short-read request before clamping', async () => {
    const bytes = buildPck([{ path: KEY, data: DATA }, { path: 'res://synthetic/longer_name.csv', data: DATA }], { gapAfterIndex: 7 });
    const f = await fixture(bytes);
    const index = parsePckIndex(bytes, bytes.length);
    const wordPositions: number[] = [];
    for (let p = 88, i = 0; i < index.entries.size; i++) {
      wordPositions.push(p);
      p += 4 + new DataView(bytes.buffer).getUint32(p, true) + 32;
    }
    const trace: Array<[number, number]> = [];
    let short = false;
    watchArchive((handle) => {
      const raw = handle.read.bind(handle);
      Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        expect(Number.isSafeInteger(offset)).toBe(true);
        expect(length).toBeGreaterThan(0);
        expect(offset + length).toBeLessThanOrEqual(buffer.byteLength);
        trace.push([position, length]);
        return raw(buffer, offset, short ? Math.min(length, 1) : length, position);
      } });
    });
    const session = await openPckFile(f.root);
    try {
      expect(trace).toEqual([[0, 88], ...wordPositions.map((p): [number, number] => [p, 4]), [88, index.indexEnd - 88]]);
      short = true;
      expect(await session.readData(KEY)).toEqual(DATA);
    } finally { await session.close(); }
  });

  it('accepts the exact maximum encoded path field', async () => {
    const key = 'res://' + 'x'.repeat(PCK_LIMITS.maxPathBytes - 'res://'.length - '.png'.length) + '.png';
    const f = await fixture(buildPck([{ path: key, data: DATA }], { gapAfterIndex: 0 }));
    expect(new DataView(f.bytes.buffer).getUint32(88, true)).toBe(PCK_LIMITS.maxPathBytes);
    const session = await openPckFile(f.root);
    try { expect(await session.readData(key)).toEqual(DATA); }
    finally { await session.close(); }
  });

  it.each([84, 88])('does not hide a malformed high byte in header/index field at %i', async (at) => {
    const bytes = buildPck([{ path: KEY, data: DATA }], { gapAfterIndex: 0 });
    new DataView(bytes.buffer).setUint32(at, 0x01000000, true);
    const f = await fixture(bytes);
    await typedFailure(openPckFile(f.root), 'LIMIT');
  });

  it.each([1, 87, 88, 89, 91])('classifies the truncated metadata prefix of %i bytes', async (size) => {
    const bytes = buildPck([{ path: KEY, data: DATA }], { gapAfterIndex: 0 });
    const f = await fixture(bytes.subarray(0, size));
    await typedFailure(openPckFile(f.root), 'TRUNCATED');
  });

  it('detects ctime-only change after ordinary mtime restoration', async () => {
    const f = await fixture();
    const fixedSeconds = 1700000000;
    await fs.utimes(f.file, fixedSeconds, fixedSeconds);
    const before = await fs.stat(f.file, { bigint: true });
    const session = await openPckFile(f.root);
    try {
      const index = parsePckIndex(f.bytes, f.bytes.length);
      const writer = await fs.open(f.file, 'r+');
      try { await writer.write(Uint8Array.of(0xee), 0, 1, index.entries.get(KEY)!.offset); }
      finally { await writer.close(); }
      await fs.utimes(f.file, fixedSeconds, fixedSeconds);
      const after = await fs.stat(f.file, { bigint: true });
      expect(after.size).toBe(before.size);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(after.ctimeNs).not.toBe(before.ctimeNs);
      await typedFailure(session.readData(KEY), 'CHANGED');
    } finally { await session.close(); }
  });

  it('propagates a payload read rejection as typed IO instead of returning zero bytes', async () => {
    const f = await fixture();
    let payload = false;
    watchArchive((handle) => {
      const raw = handle.read.bind(handle);
      Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        if (payload) throw Object.assign(new Error('synthetic I/O rejection'), { code: 'EIO' });
        return raw(buffer, offset, length, position);
      } });
    });
    const session = await openPckFile(f.root);
    try { payload = true; await typedFailure(session.readData(KEY), 'IO'); }
    finally { await session.close(); }
  });

  it('preserves ENOENT classification if the canonical root disappears before open', async () => {
    const f = await fixture();
    const real = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (arg, flags, mode) => {
      if (String(arg) === f.root) throw Object.assign(new Error('synthetic root race'), { code: 'ENOENT' });
      return real(arg as string, flags as number, mode as unknown as undefined);
    });
    await typedFailure(openPckFile(f.root), 'MISSING');
  });

  it('reports a root close failure and releases both owned handles', async () => {
    const f = await fixture();
    const handles: FileHandle[] = [];
    const real = fs.open.bind(fs);
    let rootCloseCalls = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (arg, flags, mode) => {
      const handle = await real(arg as string, flags as number, mode as unknown as undefined);
      handles.push(handle);
      if (String(arg) === f.root) {
        const close = handle.close.bind(handle);
        Object.defineProperty(handle, 'close', { value: async () => {
          rootCloseCalls++;
          if (rootCloseCalls === 1) throw Object.assign(new Error('synthetic close failure'), { code: 'EIO' });
          await close();
        } });
      }
      return handle;
    });
    await typedFailure(openPckFile(f.root), 'IO');
    expect(rootCloseCalls).toBe(2);
    for (const handle of handles) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('reports archive close failure once and does not close an owned descriptor twice', async () => {
    const f = await fixture();
    let calls = 0;
    watchArchive((handle) => {
      const close = handle.close.bind(handle);
      Object.defineProperty(handle, 'close', { value: async () => {
        calls++;
        await close();
        throw Object.assign(new Error('synthetic close report'), { code: 'EIO' });
      } });
    });
    const session = await openPckFile(f.root);
    await typedFailure(session.close(), 'IO');
    await typedFailure(session.close(), 'IO');
    expect(calls).toBe(1);
  });
});

describe('PCK repeated concurrency and close strength', () => {
  async function gateFixture() {
    const f = await fixture();
    let release = () => {};
    let gate = Promise.resolve();
    let entered = 0;
    let closes = 0;
    watchArchive((handle) => {
      const raw = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        entered++;
        await gate;
        return raw(buffer, offset, length, position);
      } });
      Object.defineProperty(handle, 'close', { value: async () => { closes++; await close(); } });
    });
    const session = await openPckFile(f.root);
    return { session,
      hold() { entered = 0; gate = new Promise<void>((resolve) => { release = resolve; }); },
      release() { release(); },
      entered: () => entered,
      closes: () => closes,
    };
  }

  it('enforces four-read admission on repeated waves in the same session', async () => {
    const g = await gateFixture();
    try {
      for (let wave = 0; wave < 3; wave++) {
        g.hold();
        const pending: Promise<unknown>[] = Array.from({ length: 4 }, () => g.session.readData(KEY));
        const firstSettlement = Promise.allSettled(pending);
        let fifthState = 'pending';
        try {
          await until(() => g.entered() === 4);
          const fifth = g.session.readData(KEY).then(
            () => { fifthState = 'accepted'; },
            (error: { code?: string }) => { fifthState = error.code ?? 'untyped'; },
          );
          pending.push(fifth);
          await until(() => fifthState !== 'pending' || g.entered() > 4);
          expect(fifthState).toBe('BUSY');
          expect(g.entered()).toBe(4);
        } finally {
          g.release();
          await firstSettlement;
          await Promise.allSettled(pending);
        }
      }
    } finally { g.release(); await g.session.close(); }
  });

  it('does not close with exactly one accepted read still gated', async () => {
    const g = await gateFixture();
    let closing: Promise<void> | undefined;
    g.hold();
    const pending = g.session.readData(KEY);
    const settled = Promise.allSettled([pending]);
    try {
      await until(() => g.entered() === 1);
      closing = g.session.close();
      expect(g.closes()).toBe(0);
      await typedFailure(g.session.readData(KEY), 'CLOSED');
    } finally {
      g.release();
      await settled;
      await closing?.catch(() => {});
      await g.session.close().catch(() => {});
    }
    expect(g.closes()).toBe(1);
  });
});

// The extra pre-discovery comparison is contract-redundant: the factory's
// initial fstat captures the same pre-read snapshot, and completed header,
// word, prefix and payload reads still require their post-read comparisons.
// This is not an assertion of identical I/O traces or universal hostile-host
// equivalence; read/stat failures may take either permitted CHANGED/IO route.
describe('PCK in-flight native-read snapshot strength', () => {
  it.each([
    { phase: 'prefix', moment: 'before' },
    { phase: 'prefix', moment: 'after' },
    { phase: 'payload', moment: 'before' },
    { phase: 'payload', moment: 'after' },
  ])('refuses a change $moment the native $phase read', async ({ phase, moment }) => {
    const f = await fixture();
    const index = parsePckIndex(f.bytes, f.bytes.length);
    const entry = index.entries.get(KEY)!;
    const control = await openPckFile(f.root);
    try { expect(await control.readData(KEY)).toEqual(DATA); }
    finally { await control.close(); }
    const before = await fs.stat(f.file, { bigint: true });
    const realOpen = fs.open.bind(fs);
    const handles: FileHandle[] = [];
    let armed = phase === 'prefix';
    let changed = false;
    async function change() {
      changed = true;
      const writer = await realOpen(f.file, 'r+');
      try { await writer.write(Uint8Array.of(0xee), 0, 1, entry.offset); }
      finally { await writer.close(); }
    }
    watchArchive((handle) => {
      handles.push(handle);
      const raw = handle.read.bind(handle);
      Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const target = phase === 'prefix'
          ? position === 88 && length === index.indexEnd - 88
          : position === entry.offset && length === DATA.length;
        const inject = armed && !changed && target;
        if (inject && moment === 'before') await change();
        const result = await raw(buffer, offset, length, position);
        if (inject && moment === 'after') await change();
        return result;
      } });
    });
    let session: PckFile | undefined;
    try {
      if (phase === 'prefix') await typedFailure(openPckFile(f.root), 'CHANGED');
      else {
        session = await openPckFile(f.root);
        armed = true;
        await typedFailure(session.readData(KEY), 'CHANGED');
      }
      expect(changed).toBe(true);
      const after = await fs.stat(f.file, { bigint: true });
      expect(after.size).toBe(before.size);
      expect(after.ctimeNs !== before.ctimeNs || after.mtimeNs !== before.mtimeNs).toBe(true);
    } finally { await session?.close(); }
    expect(handles).toHaveLength(1);
    for (const handle of handles) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });
});

describe('PCK cap arithmetic with a lowered constant seam', () => {
  it('admits the exact index cap and rejects a one-byte-longer valid index', async () => {
    const key = 'res://' + 'x'.repeat(36 - 'res://'.length - '.png'.length) + '.png';
    const exact = buildPck([{ path: key, data: DATA }], { gapAfterIndex: 0 });
    const indexEnd = parsePckIndex(exact, exact.length).indexEnd;
    const over = buildPck([{ path: key, data: DATA }], { gapAfterIndex: 0, paddingBytes: false });
    expect(parsePckIndex(over, over.length).indexEnd).toBe(indexEnd + 1);
    vi.resetModules();
    vi.doMock('../../src/core/assets/pck.ts', async () => {
      const actual = await vi.importActual<typeof import('../../src/core/assets/pck.ts')>('../../src/core/assets/pck.ts');
      return { ...actual, PCK_LIMITS: Object.freeze({ ...actual.PCK_LIMITS, maxIndexBytes: indexEnd - 88 }) };
    });
    const lowered = await import('../../electron/assets/pck-file.ts');
    const good = await fixture(exact);
    const session = await lowered.openPckFile(good.root);
    try { expect(await session.readData(key)).toEqual(DATA); }
    finally { await session.close(); }
    const bad = await fixture(over);
    await typedFailure(lowered.openPckFile(bad.root).catch((error: { offset: number }) => {
      // Characterize the failing record's offset, not its diagnostic text.
      expect(error.offset).toBe(88);
      throw error;
    }), 'LIMIT');
  });
});

// These stat/limit seams exercise the real adapter with small synthetic files;
// they do not claim that enormous real files or a full 200k-entry pack ran.
describe('PCK remaining boundary and failure classes', () => {
  it.each(['symbol', 'throwing-primitive', 'value-of'])('rejects %s caller caps without coercion', async (kind) => {
    const f = await fixture();
    const session = await openPckFile(f.root);
    let coercions = 0;
    const cap: unknown = kind === 'symbol' ? Symbol('synthetic-cap') : kind === 'throwing-primitive'
      ? { [Symbol.toPrimitive]() { coercions++; throw new Error('Must not coerce a caller cap'); } }
      : { valueOf() { coercions++; return -1; } };
    try {
      await typedFailure(session.readData(KEY, cap as unknown as number), 'LIMIT');
      expect(coercions).toBe(0);
      expect(await session.readData(KEY)).toEqual(DATA);
    } finally { await session.close(); }
  });

  it('rejects a physically empty archive with the session size error', async () => {
    const f = await fixture(new Uint8Array(0));
    await typedFailure(openPckFile(f.root), 'IO');
  });

  it('accepts an empty data entry whose index ends at physical EOF', async () => {
    const f = await fixture(buildPck([{ path: KEY, data: new Uint8Array(0) }], { gapAfterIndex: 0 }));
    expect(parsePckIndex(f.bytes, f.bytes.length).indexEnd).toBe(f.bytes.length);
    const session = await openPckFile(f.root);
    try { expect(await session.readData(KEY, 0)).toEqual(new Uint8Array(0)); }
    finally { await session.close(); }
  });

  it.each([-1n, 0n, 1n])('checks safe-size stat seam at MAX_SAFE_INTEGER plus %s', async (delta) => {
    const f = await fixture();
    const size = BigInt(Number.MAX_SAFE_INTEGER) + delta;
    watchArchive((handle) => {
      const raw = handle.stat.bind(handle);
      Object.defineProperty(handle, 'stat', { value: async () => {
        const stat = await raw({ bigint: true });
        Object.defineProperty(stat, 'size', { value: size });
        return stat;
      } });
    });
    if (delta > 0n) await typedFailure(openPckFile(f.root), 'IO');
    else {
      const session = await openPckFile(f.root);
      try {
        expect(session.fileSize).toBe(Number(size));
        expect(await session.readData(KEY)).toEqual(DATA);
      } finally { await session.close(); }
    }
  });

  it('maps procfs identity-read failure to IO and releases the held root', async () => {
    const f = await fixture();
    const held: FileHandle[] = [];
    const real = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (arg, flags, mode) => {
      const handle = await real(arg as string, flags as number, mode as unknown as undefined);
      held.push(handle);
      return handle;
    });
    vi.spyOn(fs, 'realpath').mockResolvedValueOnce(f.root)
      .mockRejectedValueOnce(Object.assign(new Error('synthetic procfs denial'), { code: 'EACCES' }));
    await typedFailure(openPckFile(f.root), 'IO');
    expect(held).toHaveLength(1);
    for (const handle of held) await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
  });

  it.each(['header', 'payload'])('normalizes %s allocation failure instead of resolving an invalid session/result', async (phase) => {
    const f = await fixture();
    let session: PckFile | undefined;
    if (phase === 'payload') session = await openPckFile(f.root);
    const RealArray = Uint8Array;
    let injected = 0;
    vi.stubGlobal('Uint8Array', new Proxy(RealArray, {
      construct(target, args, newTarget) {
        // Fail the first allocation in the operation, not a particular length:
        // otherwise a harmless buffer-size mutant can evade the injected fault.
        if (injected === 0) {
          injected++;
          throw new RangeError('synthetic allocation refusal');
        }
        return Reflect.construct(target, args, newTarget);
      },
    }));
    try {
      await typedFailure(phase === 'header' ? openPckFile(f.root) : session!.readData(KEY), 'IO');
      expect(injected).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      await session?.close();
    }
  });

  async function limited(limits: Partial<typeof PCK_LIMITS>) {
    vi.resetModules();
    vi.doMock('../../src/core/assets/pck.ts', async () => {
      const actual = await vi.importActual<typeof import('../../src/core/assets/pck.ts')>('../../src/core/assets/pck.ts');
      return { ...actual, PCK_LIMITS: Object.freeze({ ...actual.PCK_LIMITS, ...limits }) };
    });
    return import('../../electron/assets/pck-file.ts');
  }

  it('diagnoses a zero path-length word even when its record tail is absent', async () => {
    const bytes = buildPck([{ path: KEY, data: DATA }], { gapAfterIndex: 0 }).slice(0, 92);
    new DataView(bytes.buffer).setUint32(88, 0, true);
    const f = await fixture(bytes);
    await typedFailure(openPckFile(f.root), 'FORMAT');
  });

  it('diagnoses a zero path-length word that fits the exact lowered index cap', async () => {
    const bytes = buildPck([{ path: KEY, data: new Uint8Array(4) }], { gapAfterIndex: 0 });
    const end = parsePckIndex(bytes, bytes.length).indexEnd;
    new DataView(bytes.buffer).setUint32(84, 2, true);
    const f = await fixture(bytes);
    const lower = await limited({ maxIndexBytes: end + 4 - 88 });
    await typedFailure(lower.openPckFile(f.root), 'FORMAT');
  });

  it('accepts the exact file-count limit through a lowered positive seam', async () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({ path: `res://synthetic/count-${i}.png`, data: DATA }));
    const f = await fixture(buildPck(entries, { gapAfterIndex: 0 }));
    const lower = await limited({ maxFiles: entries.length });
    const session = await lower.openPckFile(f.root);
    try { for (const entry of entries) expect(await session.readData(entry.path)).toEqual(DATA); }
    finally { await session.close(); }
  });

  it.each([0, 3])('never requests a metadata word past a lowered index cap with %i tail bytes', async (tail) => {
    const bytes = buildPck([{ path: KEY, data: DATA }], { gapAfterIndex: 0 });
    const end = parsePckIndex(bytes, bytes.length).indexEnd;
    const cap = end + tail;
    const good = await fixture(bytes);
    const extra = new Uint8Array(bytes);
    new DataView(extra.buffer).setUint32(84, 2, true);
    const bad = await fixture(extra);
    const lower = await limited({ maxIndexBytes: cap - 88 });
    const trace: Array<[number, number]> = [];
    watchArchive((handle) => {
      const raw = handle.read.bind(handle);
      Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        trace.push([position, length]);
        expect(position + length).toBeLessThanOrEqual(cap);
        return raw(buffer, offset, length, position);
      } });
    });
    const session = await lower.openPckFile(good.root);
    await session.close();
    trace.length = 0;
    await typedFailure(lower.openPckFile(bad.root), 'LIMIT');
    expect(trace.every(([position, length]) => position + length <= cap)).toBe(true);
    expect(trace).not.toHaveLength(0);
  });
});
