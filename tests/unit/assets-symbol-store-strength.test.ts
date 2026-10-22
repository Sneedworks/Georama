import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetStoreError, createAssetStore } from '../../electron/assets/store.ts';
import type { AssetStore } from '../../electron/assets/store.ts';
import { buildPck } from '../helpers/pck-synthetic.ts';

const stores: AssetStore[] = [];
const roots: string[] = [];
const builtin = 'res://sprites/synthetic/tree';
const user = 'user://assets/p/trees/tree';

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-symbol-strength-'));
  roots.push(base);
  const text = JSON.stringify({ name: 'synthetic 🌲', radius: 3, offset_x: 1, offset_y: -2, draw_mode: 'normal' });
  const bytes = new TextEncoder().encode(text);
  const installRoot = path.join(base, 'install');
  const userDataRoot = path.join(base, 'user');
  const leaf = path.join(userDataRoot, 'assets', 'p', 'trees', '.wonderdraft_symbols');
  await fs.mkdir(installRoot, { recursive: true });
  await fs.mkdir(path.dirname(leaf), { recursive: true });
  await fs.writeFile(leaf, bytes);
  const archive = path.join(installRoot, 'Wonderdraft.pck');
  await fs.writeFile(archive, buildPck([{ path: 'res://sprites/synthetic/.wonderdraft_symbols', data: bytes }]));
  return { base, text, bytes, installRoot, userDataRoot, leaf, archive };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('parent symbol metadata strength', () => {
  it('accepts zero and exact ceiling caps before missing-root checks; malformed caps remain facade LIMIT', async () => {
    const store = await createAssetStore(); stores.push(store);
    for (const cap of [0, 1048576]) for (const ref of [builtin, user]) {
      const error = await store.readSymbolSet(ref, cap).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AssetStoreError);
      expect(error).toMatchObject({ code: 'ROOT' });
    }
    await store.close();
    for (const cap of [-1, 1.5, NaN, Infinity, 1048577]) {
      const error = await store.readSymbolSet('bogus', cap).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AssetStoreError);
      expect(error).toMatchObject({ code: 'LIMIT' });
    }
  });

  it('refuses a missing declared source as ROOT before any backend IO with both-source positives', async () => {
    const fx = await fixture();
    const pck = await createAssetStore({ installRoot: fx.installRoot }); stores.push(pck);
    const users = await createAssetStore({ userDataRoot: fx.userDataRoot }); stores.push(users);
    expect((await pck.readSymbolSet(builtin)).file.shape).toBe('folder');
    expect((await users.readSymbolSet(user)).file.shape).toBe('folder');
    const open = vi.spyOn(fs, 'open').mockRejectedValue(new Error('unexpected backend open'));
    for (const [store, ref] of [[pck, user], [users, builtin]] as const) {
      const error = await store.readSymbolSet(ref).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AssetStoreError);
      expect(error).toMatchObject({ code: 'ROOT' });
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('forwards the actual UTF8 byte cap to the PCK reader, not a string length or default ceiling', async () => {
    const fx = await fixture();
    expect(fx.bytes.length).toBeGreaterThan(fx.text.length);
    const store = await createAssetStore({ installRoot: fx.installRoot }); stores.push(store);
    for (const cap of [0, fx.bytes.length - 1]) {
      await expect(store.readSymbolSet(builtin, cap)).rejects.toMatchObject({ name: 'PckError', code: 'LIMIT' });
    }
    expect((await store.readSymbolSet(builtin, fx.bytes.length)).file).toMatchObject({ shape: 'folder', entry: { name: 'synthetic 🌲' } });
    expect((await store.readSymbolSet(builtin, fx.bytes.length + 1)).file.shape).toBe('folder');
  });

  it('does not hide a changed archive behind previously parsed symbol data', async () => {
    const fx = await fixture();
    const store = await createAssetStore({ installRoot: fx.installRoot }); stores.push(store);
    expect((await store.readSymbolSet(builtin)).file.shape).toBe('folder');
    const file = await fs.open(fx.archive, 'r+');
    try { await file.write(new Uint8Array([0]), 0, 1, 0); } finally { await file.close(); }
    await expect(store.readSymbolSet(builtin)).rejects.toMatchObject({ name: 'PckFileError', code: 'CHANGED' });
  });

  it('keeps the tighter filesystem path budget instead of re-rooting the metadata directory', async () => {
    const fx = await fixture();
    const store = await createAssetStore({ userDataRoot: fx.userDataRoot }); stores.push(store);
    const ref = `user://assets/p/${Array.from({ length: 14 }, (_, i) => `s${i}`).join('/')}/tree`;
    const open = vi.spyOn(fs, 'open').mockRejectedValue(new Error('unexpected backend open'));
    await expect(store.readSymbolSet(ref)).rejects.toMatchObject({ name: 'AssetFileError', code: 'PATH' });
    expect(open).not.toHaveBeenCalled();
  });

  it('never creates a fifth encoded backing region while four metadata reads remain admitted', async () => {
    const fx = await fixture();
    const store = await createAssetStore({ userDataRoot: fx.userDataRoot }); stores.push(store);
    const probe = await fs.open(fx.leaf, 'r');
    const proto = Object.getPrototypeOf(probe) as Record<string, unknown>;
    await probe.close();
    const originalRead = proto['read'] as (...args: unknown[]) => Promise<unknown>;
    const NativeArray = globalThis.Uint8Array;
    const originalSpecies = Object.getOwnPropertyDescriptor(NativeArray, Symbol.species);
    const originalFrom = Buffer.from;
    let allocated = 0; let returned = 0; let extraBeforeReturn = false; let entered = 0;
    const count = () => { allocated++; if (allocated > 4 && returned === 0) extraBeforeReturn = true; };
    const CountedArray = new Proxy(NativeArray, {
      construct(target, args, newTarget) {
        const result = Reflect.construct(target, args, newTarget) as Uint8Array;
        // A full-range view of an existing buffer is permitted; only new data regions count.
        const first: unknown = args[0];
        const viewOnly = (first instanceof ArrayBuffer || first instanceof SharedArrayBuffer) && result.buffer === first;
        if (result.byteLength === fx.bytes.length && !viewOnly) count();
        return result;
      },
    });
    let releaseFirst!: () => void; let releaseOthers!: () => void;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    const othersGate = new Promise<void>((r) => { releaseOthers = r; });
    const pending: Array<Promise<unknown>> = [];
    try {
      Object.defineProperty(NativeArray, Symbol.species, { configurable: true, value: CountedArray });
      globalThis.Uint8Array = CountedArray;
      (Buffer as unknown as Record<string, unknown>)['from'] = (...args: unknown[]) => {
        const result = Reflect.apply(originalFrom, Buffer, args) as Buffer;
        const first: unknown = args[0];
        const viewOnly = first instanceof ArrayBuffer && result.buffer === first;
        if (result.byteLength === fx.bytes.length && !viewOnly) count();
        return result;
      };
      proto['read'] = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
        const buffer = args[0];
        if (buffer instanceof NativeArray && buffer.byteLength === fx.bytes.length && args[3] === 0) {
          entered++;
          await (entered === 1 ? firstGate : othersGate);
        }
        return Reflect.apply(originalRead, this, args) as Promise<unknown>;
      };
      for (let i = 0; i < 4; i++) pending.push(store.readSymbolSet(user, fx.bytes.length).then((x) => { returned++; return x; }));
      const deadline = Date.now() + 3000;
      while (entered < 4) {
        if (Date.now() > deadline) throw new Error('four metadata native-read gates were not reached');
        await new Promise<void>((r) => setImmediate(r));
      }
      expect(allocated).toBe(4);
      releaseFirst();
      const result = await Promise.race(pending);
      expect(result).toMatchObject({ file: { shape: 'folder', entry: { name: 'synthetic 🌲' } } });
      expect(returned).toBe(1);
      expect(extraBeforeReturn).toBe(false);
      expect(allocated).toBe(4);
    } finally {
      releaseFirst(); releaseOthers();
      await Promise.allSettled(pending);
      proto['read'] = originalRead;
      (Buffer as unknown as Record<string, unknown>)['from'] = originalFrom;
      globalThis.Uint8Array = NativeArray;
      if (originalSpecies) Object.defineProperty(NativeArray, Symbol.species, originalSpecies);
      else Reflect.deleteProperty(NativeArray, Symbol.species);
    }
  });
});
