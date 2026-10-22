import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPck } from '../helpers/pck-synthetic.ts';
import { SYMBOL_STORE_LIMITS, createAssetStore } from '../../electron/assets/store.ts';
import type { AssetStore } from '../../electron/assets/store.ts';
import { symbolEntryFor } from '../../src/core/assets/asset-json.ts';

const openStores: AssetStore[] = [];
const fixtures: string[] = [];

async function makeDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  fixtures.push(dir);
  return dir;
}

async function waitForCondition(cond: () => boolean, ms: number, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`deadline waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fileHandleProto(base: string): Promise<Record<string, unknown>> {
  const probePath = path.join(base, 'probe');
  await fs.writeFile(probePath, 'x');
  const probe = await fs.open(probePath, 'r');
  const proto = Object.getPrototypeOf(probe) as Record<string, unknown>;
  await probe.close();
  return proto;
}

async function tick(times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    await store.close();
  }
  for (const dir of fixtures.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function folderJson(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ name: 'synthetic folder', radius: 3, offset_x: 1, offset_y: -2, draw_mode: 'normal' }),
  );
}

function imagesJson(): Uint8Array {
  const root: Record<string, unknown> = {};
  root['tree'] = { name: 'tree', radius: 2, offset_x: 0, offset_y: 0, draw_mode: 'normal' };
  root['rock'] = { name: 'rock', radius: 0, offset_x: -1, offset_y: 4, draw_mode: 'mystery_mode' };
  return new TextEncoder().encode(JSON.stringify(root));
}

describe('symbol store RED: missing readSymbolSet method', () => {
  it('reads a builtin folder symbol set from the archive', async () => {
    const base = await makeDir('georama-symbol-red-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://sprites/synthetic/.wonderdraft_symbols', data: folderJson() }]),
    );
    const store = await createAssetStore({ installRoot });
    openStores.push(store);
    const asset = await store.readSymbolSet('res://sprites/synthetic/tree');
    expect(asset.key).toBe('pck:res://sprites/synthetic/.wonderdraft_symbols');
    expect(asset.file.shape).toBe('folder');
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.isFrozen(asset.ref)).toBe(true);
  });
});

describe('symbol store vertical 2: user route and per-image map', () => {
  it('reads a user folder symbol set with exact virtual key', async () => {
    const base = await makeDir('georama-symbol-v2a-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      folderJson(),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const asset = await store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
    expect(asset.key).toBe('user:synthetic-pack/trees/.wonderdraft_symbols');
    expect(asset.file).toMatchObject({ shape: 'folder', entry: { name: 'synthetic folder', radius: 3 } });
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.isFrozen(asset.ref)).toBe(true);
  });

  it('reads a per-image map, selects entries, and allows unknown draw modes', async () => {
    const base = await makeDir('georama-symbol-v2b-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://sprites/synthetic/.wonderdraft_symbols', data: imagesJson() }]),
    );
    const store = await createAssetStore({ installRoot });
    openStores.push(store);
    const asset = await store.readSymbolSet('res://sprites/synthetic/tree');
    expect(asset.file.shape).toBe('images');
    if (asset.file.shape !== 'images') throw new Error('expected images shape');
    expect(asset.file.entries.size).toBe(2);
    const tree = symbolEntryFor(asset.file, 'tree');
    expect(tree).toMatchObject({ name: 'tree', radius: 2 });
    expect(symbolEntryFor(asset.file, 'rock')).toMatchObject({ drawMode: 'mystery_mode' });
    expect(symbolEntryFor(asset.file, 'missing')).toBe(null);
  });

  it('keeps untrusted keys in the Map including __proto__ and constructor', async () => {
    const enc = new TextEncoder();
    const text = `{"tree":${JSON.stringify({ name: 'tree', radius: 1, offset_x: 0, offset_y: 0, draw_mode: 'normal' })},"constructor":${JSON.stringify({ name: 'c', radius: 1, offset_x: 0, offset_y: 0, draw_mode: 'normal' })},"__proto__":${JSON.stringify({ name: 'p', radius: 1, offset_x: 0, offset_y: 0, draw_mode: 'normal' })}}`;
    const base = await makeDir('georama-symbol-v2c-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      enc.encode(text),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const asset = await store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
    if (asset.file.shape !== 'images') throw new Error('expected images shape');
    expect(asset.file.entries.get('__proto__')).toMatchObject({ name: 'p' });
    expect(asset.file.entries.get('constructor')).toMatchObject({ name: 'c' });
    expect(asset.file.entries.size).toBe(3);
  });

  it('does not cache: mutating one parsed map cannot affect a reread', async () => {
    const base = await makeDir('georama-symbol-v2d-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      imagesJson(),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const first = await store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
    if (first.file.shape !== 'images') throw new Error('expected images shape');
    const firstEntries = first.file.entries as unknown as Map<string, { radius: number }>;
    firstEntries.delete('tree');
    (firstEntries.get('rock') as { radius: number }).radius = 999;
    const second = await store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
    if (second.file.shape !== 'images') throw new Error('expected images shape');
    expect(second.file.entries.size).toBe(2);
    expect(second.file.entries.get('rock')).toMatchObject({ radius: 0 });
    expect(second.file.entries).not.toBe(first.file.entries);
  });

  it('publishes the exact frozen 1MiB symbol ceiling', () => {
    expect(SYMBOL_STORE_LIMITS).toEqual({ maxReadBytes: 1048576 });
    expect(Object.isFrozen(SYMBOL_STORE_LIMITS)).toBe(true);
  });
});

describe('symbol store vertical 3: caps, order and decoder strictness', () => {
  it('enforces exact byte caps len-1/len/len+1, 0, 1MiB and rejects 1MiB+1', async () => {
    const base = await makeDir('georama-symbol-v3a-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    const bytes = folderJson();
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'), bytes);
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://assets/synthetic-pack/trees/tree';
    await expect(store.readSymbolSet(ref, bytes.length - 1)).rejects.toMatchObject({ code: 'LIMIT' });
    expect((await store.readSymbolSet(ref, bytes.length)).key).toBe(
      'user:synthetic-pack/trees/.wonderdraft_symbols',
    );
    expect((await store.readSymbolSet(ref, bytes.length + 1)).key).toBe(
      'user:synthetic-pack/trees/.wonderdraft_symbols',
    );
    await expect(store.readSymbolSet(ref, 0)).rejects.toMatchObject({ code: 'LIMIT' });
    expect((await store.readSymbolSet(ref, 1048576)).key).toBe('user:synthetic-pack/trees/.wonderdraft_symbols');
    await expect(store.readSymbolSet(ref, 1048577)).rejects.toMatchObject({ code: 'LIMIT' });
  });

  it('rejects malformed caps without coercion or IO', async () => {
    const store = await createAssetStore();
    openStores.push(store);
    let coercions = 0;
    const caps: unknown[] = [-1, 1.5, NaN, Infinity, -Infinity, 1048577, Number.MAX_SAFE_INTEGER + 1, null,
      '1', false, Symbol('cap'), { valueOf() { coercions++; throw new Error('must not coerce'); } }];
    const { default: fsPromises } = await import('node:fs/promises');
    const origOpen = fsPromises.open;
    let opens = 0;
    (fsPromises as unknown as Record<string, unknown>)['open'] = async (...args: unknown[]) => {
      opens += 1;
      return (origOpen as unknown as (...a: unknown[]) => Promise<unknown>)(...args);
    };
    try {
      for (const cap of caps) {
        await expect(store.readSymbolSet('res://sprites/synthetic/tree', cap as number)).rejects.toMatchObject({
          code: 'LIMIT',
        });
      }
    } finally {
      (fsPromises as unknown as Record<string, unknown>)['open'] = origOpen;
    }
    expect(coercions).toBe(0);
    expect(opens).toBe(0);
  });

  it('validates cap before bad refs and before CLOSED; resolves before CLOSED', async () => {
    const base = await makeDir('georama-symbol-v3b-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      folderJson(),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    await expect(store.readSymbolSet('bogus', NaN)).rejects.toMatchObject({ code: 'LIMIT' });
    await store.close();
    await expect(store.readSymbolSet('res://sprites/synthetic/tree', NaN)).rejects.toMatchObject({ code: 'LIMIT' });
    await expect(store.readSymbolSet('bogus')).rejects.toMatchObject({ name: 'RefError' });
    await expect(store.readSymbolSet('res://sprites/synthetic/tree')).rejects.toMatchObject({ code: 'CLOSED' });
    await expect(store.readSymbolSet('user://assets/synthetic-pack/trees/tree')).rejects.toMatchObject({
      code: 'CLOSED',
    });
  });

  it('rejects invalid UTF-8 as ENCODING inside otherwise valid JSON', async () => {
    const good = folderJson();
    const bad = Uint8Array.from(good);
    const quote = bad.indexOf(0x22);
    bad[quote + 1] = 0xff;
    const base = await makeDir('georama-symbol-v3c-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'), bad);
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    await expect(store.readSymbolSet('user://assets/synthetic-pack/trees/tree')).rejects.toMatchObject({
      name: 'AssetJsonError',
      code: 'ENCODING',
    });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'), good);
    const retry = await store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
    expect(retry.file.shape).toBe('folder');
  });

  it('rejects a BOM as SYNTAX and bad JSON as SYNTAX', async () => {
    const enc = new TextEncoder();
    const base = await makeDir('georama-symbol-v3d-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    const leaf = path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols');
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://assets/synthetic-pack/trees/tree';
    await fs.writeFile(leaf, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(folderJson())]));
    await expect(store.readSymbolSet(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'SYNTAX' });
    await fs.writeFile(leaf, enc.encode('{not json'));
    await expect(store.readSymbolSet(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'SYNTAX' });
    await fs.writeFile(leaf, enc.encode('[1,2]'));
    await expect(store.readSymbolSet(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'SHAPE' });
    await fs.writeFile(leaf, folderJson());
    expect((await store.readSymbolSet(ref)).file.shape).toBe('folder');
  });

  it('preserves SHAPE and TYPE failures from the parser', async () => {
    const enc = new TextEncoder();
    const base = await makeDir('georama-symbol-v3e-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    const leaf = path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols');
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://assets/synthetic-pack/trees/tree';
    const cases: Array<[unknown, string]> = [
      [{ radius: 3, offset_x: 1, offset_y: -2, draw_mode: 'normal' }, 'SHAPE'],
      [{}, 'SHAPE'],
      [{ name: 'x', radius: -1, offset_x: 0, offset_y: 0, draw_mode: 'normal' }, 'TYPE'],
      [{ name: 'x', radius: '3', offset_x: 0, offset_y: 0, draw_mode: 'normal' }, 'TYPE'],
      [{ name: 'x', radius: 3, offset_x: 0, offset_y: 0 }, 'SHAPE'],
    ];
    for (const [body, code] of cases) {
      await fs.writeFile(leaf, enc.encode(JSON.stringify(body)));
      await expect(store.readSymbolSet(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code });
    }
    await fs.writeFile(leaf, folderJson());
    expect((await store.readSymbolSet(ref)).file.shape).toBe('folder');
  });

  it('surfaces native MISSING for absent metadata on both sources without fallback', async () => {
    const png = (await import('../helpers/pck-synthetic.ts')).makePng({ width: 2, height: 3 });
    const base = await makeDir('georama-symbol-v3f-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://sprites/synthetic/tree.wonderdraft_image', data: png }]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'tree.png'), png);
    const store = await createAssetStore({ installRoot, userDataRoot });
    openStores.push(store);
    await expect(store.readSymbolSet('res://sprites/synthetic/tree')).rejects.toMatchObject({ code: 'MISSING' });
    await expect(store.readSymbolSet('user://assets/synthetic-pack/trees/tree')).rejects.toMatchObject({
      code: 'MISSING',
    });
  });

  it('rejects oversize backend files with LIMIT before allocation', async () => {
    const base = await makeDir('georama-symbol-v3g-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    const filler = `{"name":"${'x'.repeat(100)}","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"normal"}`;
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      new TextEncoder().encode(filler),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://assets/synthetic-pack/trees/tree';
    await expect(store.readSymbolSet(ref, 10)).rejects.toMatchObject({ code: 'LIMIT' });
    expect((await store.readSymbolSet(ref)).file.shape).toBe('folder');
  });
});

describe('symbol store vertical 4: mixed admission and close drain', () => {
  it('admits four mixed image+symbol reads across sources and rejects the fifth without IO', async () => {
    const { makePng } = await import('../helpers/pck-synthetic.ts');
    const pngA = makePng({ width: 2, height: 3 });
    const pngB = makePng({ width: 4, height: 1 });
    const base = await makeDir('georama-symbol-v4a-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([
        { path: 'res://sprites/synthetic/tree.wonderdraft_image', data: pngA },
        { path: 'res://sprites/synthetic/rock.wonderdraft_image', data: pngB },
        { path: 'res://sprites/synthetic/.wonderdraft_symbols', data: folderJson() },
      ]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'tree.png'), pngA);
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'bush.png'), pngB);
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      imagesJson(),
    );
    const store = await createAssetStore({ installRoot, userDataRoot });
    openStores.push(store);
    const proto = await fileHandleProto(base);
    const origRead = proto['read'] as (...args: never[]) => Promise<unknown>;
    let entered = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    proto['read'] = async function (this: unknown, ...args: never[]): Promise<unknown> {
      entered += 1;
      await gate;
      return origRead.apply(this, args);
    };
    const p1 = store.readImage('symbol', 'res://sprites/synthetic/tree');
    const p2 = store.readSymbolSet('res://sprites/synthetic/rock');
    const p3 = store.readImage('symbol', 'user://assets/synthetic-pack/trees/tree');
    const p4 = store.readSymbolSet('user://assets/synthetic-pack/trees/bush');
    const pending: Array<Promise<unknown>> = [p1, p2, p3, p4];
    try {
      await waitForCondition(() => entered >= 4, 5000, 'four mixed reads to reach IO');
      const fifth = store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
      let fifthError: unknown;
      let fifthDone = false;
      fifth.then(
        () => {
          fifthDone = true;
        },
        (error: unknown) => {
          fifthError = error;
          fifthDone = true;
        },
      );
      await waitForCondition(() => fifthDone || entered > 4, 5000, 'fifth to settle or extra IO');
      expect(entered).toBe(4);
      expect(fifthDone).toBe(true);
      expect(fifthError).toMatchObject({ name: 'AssetStoreError', code: 'BUSY' });
      pending.push(fifth.catch(() => undefined as never));
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled(pending);
    }
    expect((await store.readImage('symbol', 'res://sprites/synthetic/tree')).bytes).toEqual(pngA);
    expect((await store.readSymbolSet('user://assets/synthetic-pack/trees/tree')).file.shape).toBe('images');
  });

  it('close waits for an admitted user metadata read with the archive fd still open', async () => {
    const { makePng } = await import('../helpers/pck-synthetic.ts');
    const png = makePng({ width: 2, height: 3 });
    const base = await makeDir('georama-symbol-v4b-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://sprites/synthetic/tree.wonderdraft_image', data: png }]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      folderJson(),
    );
    const store = await createAssetStore({ installRoot, userDataRoot });
    openStores.push(store);
    const pckPath = path.join(installRoot, 'Wonderdraft.pck');
    let archiveFd = -1;
    for (const name of await fs.readdir('/proc/self/fd')) {
      try {
        const link = await fs.readlink(`/proc/self/fd/${name}`);
        if (link === pckPath) archiveFd = Number(name);
      } catch {
        /* fd raced closed */
      }
    }
    expect(archiveFd).toBeGreaterThanOrEqual(0);
    const archiveFdState = async (): Promise<string | null> => {
      try {
        return await fs.readlink(`/proc/self/fd/${archiveFd}`);
      } catch {
        return null;
      }
    };
    const proto = await fileHandleProto(base);
    const origRead = proto['read'] as (...args: never[]) => Promise<unknown>;
    let entered = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    proto['read'] = async function (this: unknown, ...args: never[]): Promise<unknown> {
      entered += 1;
      await gate;
      return origRead.apply(this, args);
    };
    const userPending = store.readSymbolSet('user://assets/synthetic-pack/trees/tree');
    try {
      await waitForCondition(() => entered >= 1, 5000, 'user metadata read to reach IO');
      const closing = store.close();
      await tick(2);
      expect(await archiveFdState()).toBe(pckPath);
      releaseGate();
      await closing;
      const asset = await userPending;
      expect(asset.key).toBe('user:synthetic-pack/trees/.wonderdraft_symbols');
      const after = await archiveFdState();
      expect(after === null || after !== pckPath).toBe(true);
      await expect(store.readImage('symbol', 'res://sprites/synthetic/tree')).rejects.toMatchObject({
        code: 'CLOSED',
      });
      await expect(store.readSymbolSet('user://assets/synthetic-pack/trees/tree')).rejects.toMatchObject({
        code: 'CLOSED',
      });
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled([userPending.catch(() => undefined as never)]);
    }
  });

  it('user-only close settles the public metadata read before close resolves', async () => {
    const base = await makeDir('georama-symbol-v4c-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      folderJson(),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const proto = await fileHandleProto(base);
    const origRead = proto['read'] as (...args: never[]) => Promise<unknown>;
    let entered = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    proto['read'] = async function (this: unknown, ...args: never[]): Promise<unknown> {
      entered += 1;
      await gate;
      return origRead.apply(this, args);
    };
    const order: string[] = [];
    const ref = 'user://assets/synthetic-pack/trees/tree';
    const rp = store
      .readSymbolSet(ref)
      .then((value) => {
        order.push('read');
        return value;
      });
    const pending: Array<Promise<unknown>> = [rp.catch(() => undefined as never)];
    try {
      await waitForCondition(() => entered >= 1, 5000, 'metadata read to reach IO');
      const cp = store.close().then(() => {
        order.push('close');
      });
      pending.push(cp);
      await tick(3);
      expect(order).toEqual([]);
      releaseGate();
      const asset = await rp;
      await cp;
      expect(order).toEqual(['read', 'close']);
      expect(asset.key).toBe('user:synthetic-pack/trees/.wonderdraft_symbols');
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled(pending);
    }
  });

  it('user-only close settles the public image read before close resolves', async () => {
    const { makePng } = await import('../helpers/pck-synthetic.ts');
    const png = makePng({ width: 2, height: 3 });
    const base = await makeDir('georama-symbol-v4d-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'tree.png'), png);
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const proto = await fileHandleProto(base);
    const origRead = proto['read'] as (...args: never[]) => Promise<unknown>;
    let entered = 0;
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    proto['read'] = async function (this: unknown, ...args: never[]): Promise<unknown> {
      entered += 1;
      await gate;
      return origRead.apply(this, args);
    };
    const order: string[] = [];
    const rp = store.readImage('symbol', 'user://assets/synthetic-pack/trees/tree').then((value) => {
      order.push('read');
      return value;
    });
    const pending: Array<Promise<unknown>> = [rp.catch(() => undefined as never)];
    try {
      await waitForCondition(() => entered >= 1, 5000, 'image read to reach IO');
      const cp = store.close().then(() => {
        order.push('close');
      });
      pending.push(cp);
      await tick(3);
      expect(order).toEqual([]);
      releaseGate();
      const img = await rp;
      await cp;
      expect(order).toEqual(['read', 'close']);
      expect(img.bytes).toEqual(png);
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled(pending);
    }
  });
});
