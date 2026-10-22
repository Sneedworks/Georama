import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssetStore } from '../../electron/assets/store.ts';
import type { AssetStore } from '../../electron/assets/store.ts';
const stores: AssetStore[] = [];
const roots: string[] = [];
const user = 'user://themes/synthetic/F.wonderdraft_theme';
const COLOR = '0.1,0.2,0.3,1';

export function themeJson(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      water_texture: 'synthetic-water',
      ground_texture: 'synthetic-ground',
      water_hue: 0,
      water_saturation: 1,
      water_value: 1,
      vignette_strength: 0,
      coastal_fx_distance: 1,
      coastline_style: 0,
      coastline_color: COLOR,
      landmass_outline_color: COLOR,
      landmass_outline_blend: 0,
      freshwater_color: COLOR,
      freshwater_outline_color: COLOR,
      ground_colors: [COLOR],
      path_color: COLOR,
      windrose_color: COLOR,
      symbol_custom_colors: [COLOR],
      label_presets: {
        synthetic: {
          font_name: 'Synthetic Font',
          font_size: 12,
          font_color: COLOR,
          font_outline_width: 1,
          font_outline_color: COLOR,
        },
      },
    }),
  );
}

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-theme-strength-'));
  roots.push(base);
  const userDataRoot = path.join(base, 'user');
  const leaf = path.join(userDataRoot, 'themes', 'synthetic', 'F.wonderdraft_theme');
  const bytes = themeJson();
  await fs.mkdir(path.dirname(leaf), { recursive: true });
  await fs.writeFile(leaf, bytes);
  return { base, userDataRoot, leaf, bytes };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
describe('parent theme store strength', () => {
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
      for (let i = 0; i < 4; i++) pending.push(store.readTheme(user, fx.bytes.length).then((x) => { returned++; return x; }));
      const deadline = Date.now() + 3000;
      while (entered < 4) {
        if (Date.now() > deadline) throw new Error('four metadata native-read gates were not reached');
        await new Promise<void>((r) => setImmediate(r));
      }
      expect(allocated).toBe(4);
      releaseFirst();
      const result = await Promise.race(pending);
      expect(result).toMatchObject({ file: { waterTexture: 'synthetic-water' } });
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
