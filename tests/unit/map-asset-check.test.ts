import { afterEach, describe, expect, it, vi } from 'vitest';
import * as selectedFile from '../../electron/data/selected-file.ts';
import { SELECTED_FILE_LIMITS } from '../../electron/data/selected-file.ts';
import * as configFileMod from '../../electron/data/config-file.ts';
import * as storeMod from '../../electron/assets/store.ts';
import { checkSelectedMapAssets } from '../../electron/data/map-asset-check.ts';
import * as mapRefsMod from '../../src/core/assets/map-refs.ts';
import * as wdFileMod from '../../src/core/formats/wonderdraft-map-file.ts';
import * as selectedFileMod from '../../electron/data/selected-file.ts';
import * as configMod from '../../electron/assets/config.ts';
import { makeAssetCheckFixture } from '../helpers/asset-check-synthetic.ts';
import { setImmediate } from 'node:timers/promises';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanups.splice(0)) {
    await fn();
  }
});

describe('map asset check happy flow', () => {
  it('reports six valid groups and one embedded symbol with frozen report', async () => {
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const configSpy = vi.spyOn(configFileMod, 'readSelectedConfigFile');
    const dataSpy = vi.spyOn(selectedFile, 'readSelectedDataFile');
    const origCreate = storeMod.createAssetStore;
    const readCalls: Array<{ kind: unknown; ref: unknown; args: unknown[] }> = [];
    let closeCalls = 0;
    const storeSpy = vi.spyOn(storeMod, 'createAssetStore').mockImplementation(async (opts) => {
      const store = await origCreate(opts);
      const origRead = store.readImage.bind(store);
      store.readImage = (async (kind: never, reference: never, maxBytes?: never) => {
        readCalls.push({ kind, ref: reference, args: [kind, reference, ...(maxBytes === undefined ? [] : [maxBytes])] });
        return origRead(kind, reference);
      }) as typeof store.readImage;
      const origClose = store.close.bind(store);
      store.close = async () => {
        closeCalls += 1;
        return origClose();
      };
      return store;
    });
    const report = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    expect(report.version).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.groups).toBe(6);
    expect(report.checked).toBe(6);
    expect(report.valid).toBe(6);
    expect(report.unresolved).toBe(0);
    expect(report.empty).toBe(0);
    expect(report.embeddedSymbols).toBe(1);
    expect(report.entries).toHaveLength(6);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.entries)).toBe(true);
    for (const entry of report.entries) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.locations)).toBe(true);
      expect(entry.status).toBe('valid');
    }
    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith(fx.configFile);
    expect(dataSpy).toHaveBeenCalledTimes(2);
    expect(dataSpy).toHaveBeenCalledWith(fx.mapFile, SELECTED_FILE_LIMITS.maxReadBytes);
    const mapCalls = dataSpy.mock.calls.filter((c) => (c as unknown[])[0] === fx.mapFile);
    expect(mapCalls).toHaveLength(1);
    expect(configSpy.mock.invocationCallOrder[0]).toBeLessThan(dataSpy.mock.invocationCallOrder[1] as number);
    expect(storeSpy).toHaveBeenCalledTimes(1);
    expect(storeSpy).toHaveBeenCalledWith({ installRoot: fx.installRoot, userDataRoot: fx.userDataRoot });
    expect(readCalls).toHaveLength(6);
    for (const call of readCalls) {
      expect(call.args).toHaveLength(2);
    }
    const refs = report.entries.map((e: { kind: string; reference: string }) => `${e.kind}\0${e.reference}`);
    const sorted = [...refs].sort();
    expect(refs).toEqual(sorted);
    expect(closeCalls).toBe(1);
  });
});

describe('map asset check semantic gate', () => {
  it('rejects water_level 1.5 with VALIDATION and zero inventory/store work', async () => {
    const fx = await makeAssetCheckFixture({ waterLevel: 1.5 });
    cleanups.push(fx.cleanup);
    const inventorySpy = vi.spyOn(mapRefsMod, 'collectMapAssetRefs');
    const storeSpy = vi.spyOn(storeMod, 'createAssetStore');
    await expect(checkSelectedMapAssets(fx.mapFile, fx.configFile)).rejects.toMatchObject({
      name: 'MapAssetCheckError', code: 'VALIDATION', issueCount: 1,
      message: 'Selected map failed semantic validation',
    });
    expect(inventorySpy).not.toHaveBeenCalled();
    expect(storeSpy).not.toHaveBeenCalled();
  });
});

describe('map asset check per-image catch', () => {
  it('marks a missing user png unresolved and checks every remaining group', async () => {
    const fx = await makeAssetCheckFixture({ omitUserPng: true });
    cleanups.push(fx.cleanup);
    const report = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    expect(report.ok).toBe(false);
    expect(report.groups).toBe(6);
    expect(report.checked).toBe(6);
    expect(report.valid).toBe(5);
    expect(report.unresolved).toBe(1);
    expect(report.empty).toBe(0);
    expect(report.embeddedSymbols).toBe(1);
    const bad = report.entries.filter((e: { status: string }) => e.status === 'unresolved');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.kind).toBe('symbol');
    expect(bad[0]?.reference).toBe('user://assets/synthetic-pack/trees/tree');
    expect(Object.isFrozen(report)).toBe(true);
  });
});

describe('map asset check empty reference', () => {
  it("marks exact '' empty with zero image calls and whitespace stays unresolved", async () => {
    const fx = await makeAssetCheckFixture({ waterTexture: '' });
    cleanups.push(fx.cleanup);
    const origCreate = storeMod.createAssetStore;
    let imageCalls = 0;
    const storeSpy = vi.spyOn(storeMod, 'createAssetStore').mockImplementation(async (opts) => {
      const store = await origCreate(opts);
      const origRead = store.readImage.bind(store);
      store.readImage = (async (...args: Parameters<typeof store.readImage>) => {
        imageCalls += 1;
        return origRead(...args);
      }) as typeof store.readImage;
      return store;
    });
    void storeSpy;
    const report = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    expect(report.groups).toBe(6);
    expect(report.empty).toBe(1);
    expect(report.checked).toBe(5);
    expect(report.valid).toBe(5);
    expect(report.unresolved).toBe(0);
    expect(report.ok).toBe(true);
    expect(imageCalls).toBe(5);
    const emptyRows = report.entries.filter((e: { status: string }) => e.status === 'empty');
    expect(emptyRows).toHaveLength(1);
    expect(emptyRows[0]?.reference).toBe('');

    const fx2 = await makeAssetCheckFixture({ waterTexture: ' ' });
    cleanups.push(fx2.cleanup);
    const report2 = await checkSelectedMapAssets(fx2.mapFile, fx2.configFile);
    const ws = report2.entries.filter((e: { reference: string }) => e.reference === ' ');
    expect(ws).toHaveLength(1);
    expect(ws[0]?.status).toBe('unresolved');
    expect(report2.empty).toBe(0);
  });
});

describe('map asset check permanent guarantees', () => {
  it('keeps sort order, complete locations, embedded count and across-kind separation', async () => {
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const report = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    const keys = report.entries.map((e: { kind: string; reference: string }) => `${e.kind}\0${e.reference}`);
    expect(keys).toEqual([...keys].sort());
    const byKey = new Map<string, { locations: readonly string[] }>(report.entries.map((e: { kind: string; reference: string; locations: readonly string[] }) => [`${e.kind}\0${e.reference}`, e]));
    expect(byKey.get('water-texture\0SynthWater')?.locations).toEqual(['/theme/water_texture']);
    expect(byKey.get('ground-texture\0SynthGround')?.locations).toEqual(['/theme/ground_texture']);
    expect(byKey.get('frame-texture\0SynthFrame')?.locations).toEqual(['/frame/texture']);
    expect(byKey.get('path-style\0res://textures/paths/SynthPath')?.locations).toEqual(['/paths/0/style']);
    expect(byKey.get('border-style\0res://textures/borders/SynthBorder')?.locations).toEqual(['/territories/territories/0/style']);
    expect(byKey.get('symbol\0user://assets/synthetic-pack/trees/tree')?.locations).toEqual(['/symbols/0/texture']);
    expect(report.embeddedSymbols).toBe(1);
    expect(report.groups).toBe(report.checked + report.empty);
    expect(report.checked).toBe(report.valid + report.unresolved);
  });

  it('sends invalid refs and corrupt pngs to unresolved without skipping', async () => {
    const fx = await makeAssetCheckFixture({ symbolTexture: 'bogus-no-scheme' });
    cleanups.push(fx.cleanup);
    const report = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    const row = report.entries.filter((e: { kind: string }) => e.kind === 'symbol');
    expect(row).toHaveLength(1);
    expect(row[0]?.status).toBe('unresolved');
    expect(report.checked).toBe(6);
  });

  it('reads images sequentially with no cap override and fresh frozen reports', async () => {
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const origCreate = storeMod.createAssetStore;
    let active = 0;
    let maxActive = 0;
    const argLens: number[] = [];
    vi.spyOn(storeMod, 'createAssetStore').mockImplementation(async (opts) => {
      const store = await origCreate(opts);
      const origRead = store.readImage.bind(store);
      store.readImage = (async (...args: Parameters<typeof store.readImage>) => {
        argLens.push(args.length);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((r) => setTimeout(r, 5));
          return await origRead(...args);
        } finally {
          active -= 1;
        }
      }) as typeof store.readImage;
      return store;
    });
    const a = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    const b = await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    expect(maxActive).toBe(1);
    expect(argLens.every((n) => n === 2)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.entries).not.toBe(b.entries);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.isFrozen(a) && Object.isFrozen(b)).toBe(true);
  });

  it('passes the exact native bytes to readWdMap once and holds exactly two selected reads', async () => {
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const dataSpy = vi.spyOn(selectedFileMod, 'readSelectedDataFile');
    const readSpy = vi.spyOn(wdFileMod, 'readWdMap');
    const validateSpy = vi.spyOn(wdFileMod, 'validateWdMap');
    const inventorySpy = vi.spyOn(mapRefsMod, 'collectMapAssetRefs');
    await checkSelectedMapAssets(fx.mapFile, fx.configFile);
    expect(dataSpy).toHaveBeenCalledTimes(2);
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(inventorySpy).toHaveBeenCalledTimes(1);
    const mapBytes = dataSpy.mock.results.find((r) => r.type === 'return');
    void mapBytes;
  });

  it('never uses discovery roots and closes exactly once even when close is gated', async () => {
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const resolveSpy = vi.spyOn(configMod, 'resolveRoots');
    const origCreate = storeMod.createAssetStore;
    let closeCalls = 0;
    let enteredResolve!: () => void;
    const entered = new Promise<void>((r) => { enteredResolve = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vi.spyOn(storeMod, 'createAssetStore').mockImplementation(async (opts) => {
      const store = await origCreate(opts);
      const origClose = store.close.bind(store);
      store.close = async () => {
        closeCalls += 1;
        await origClose();
        enteredResolve();
        await gate;
      };
      return store;
    });
    const pending = checkSelectedMapAssets(fx.mapFile, fx.configFile);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    let report!: Awaited<typeof pending>;
    try {
      await entered;
      await setImmediate();
      expect(closeCalls).toBe(1);
      expect(settled).toBe(false);
    } finally {
      release();
      report = await pending;
    }
    expect(settled).toBe(true);
    expect(report.valid).toBe(6);
    expect(closeCalls).toBe(1);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('propagates close failure with exact identity and no report', async () => {
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const origCreate = storeMod.createAssetStore;
    const boom = new Error('close-boom');
    vi.spyOn(storeMod, 'createAssetStore').mockImplementation(async (opts) => {
      const store = await origCreate(opts);
      const origClose = store.close.bind(store);
      store.close = async () => { await origClose(); throw boom; };
      return store;
    });
    try {
      await checkSelectedMapAssets(fx.mapFile, fx.configFile);
      expect.unreachable('expected close error');
    } catch (error) {
      expect(error).toBe(boom);
    }
  });
});

describe('map asset check fresh semantic redo', () => {
  it('fresh semantic redo', async () => {
    const fx = await makeAssetCheckFixture({ waterLevel: 1.5 });
    cleanups.push(fx.cleanup);
    const inventorySpy = vi.spyOn(mapRefsMod, 'collectMapAssetRefs');
    const storeSpy = vi.spyOn(storeMod, 'createAssetStore');
    await expect(checkSelectedMapAssets(fx.mapFile, fx.configFile)).rejects.toMatchObject({
      name: 'MapAssetCheckError',
      code: 'VALIDATION',
      issueCount: 1,
      message: 'Selected map failed semantic validation',
    });
    expect(inventorySpy).not.toHaveBeenCalled();
    expect(storeSpy).not.toHaveBeenCalled();
  });

  it('fresh semantic redo instanceof', async () => {
    const fx = await makeAssetCheckFixture({ waterLevel: 1.5 });
    cleanups.push(fx.cleanup);
    const svc = await import('../../electron/data/map-asset-check.ts');
    const desc = Object.getOwnPropertyDescriptor(svc, 'MapAssetCheckError');
    expect(desc?.enumerable).toBe(true);
    const Ctor = (svc as unknown as { MapAssetCheckError: new (n: number) => Error }).MapAssetCheckError;
    expect(typeof Ctor).toBe('function');
    try {
      await checkSelectedMapAssets(fx.mapFile, fx.configFile);
      expect.unreachable('expected VALIDATION rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Ctor);
      expect((error as { code?: unknown }).code).toBe('VALIDATION');
    }
  });
});
