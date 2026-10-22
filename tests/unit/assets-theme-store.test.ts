import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPck } from '../helpers/pck-synthetic.ts';
import { THEME_STORE_LIMITS, createAssetStore } from '../../electron/assets/store.ts';
import type { AssetStore } from '../../electron/assets/store.ts';

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

describe('theme store RED: missing readTheme method', () => {
  it('reads a builtin theme from the archive', async () => {
    const base = await makeDir('georama-theme-red-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://themes/synthetic/Willow.wonderdraft_theme', data: themeJson() }]),
    );
    const store = await createAssetStore({ installRoot });
    openStores.push(store);
    const asset = await store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme');
    expect(asset.key).toBe('theme:pck:res://themes/synthetic/Willow.wonderdraft_theme');
    expect(asset.file.waterTexture).toBe('synthetic-water');
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.isFrozen(asset.ref)).toBe(true);
  });
});

describe('theme store vertical 2: user route and parsed theme content', () => {
  it('reads a user theme with the exact relative key', async () => {
    const base = await makeDir('georama-theme-v2a-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const asset = await store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme');
    expect(asset.key).toBe('theme:user:themes/synthetic/Willow.wonderdraft_theme');
    expect(asset.ref).toEqual({ source: 'user', path: 'themes/synthetic/Willow.wonderdraft_theme' });
    expect(asset.file.waterTexture).toBe('synthetic-water');
    expect(asset.file.groundTexture).toBe('synthetic-ground');
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.isFrozen(asset.ref)).toBe(true);
  });

  it('reads a user theme below assets/p/themes under the original user root', async () => {
    const base = await makeDir('georama-theme-v2b-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'p', 'themes'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'p', 'themes', 'X.wonderdraft_theme'), themeJson());
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const asset = await store.readTheme('user://assets/p/themes/X.wonderdraft_theme');
    expect(asset.key).toBe('theme:user:assets/p/themes/X.wonderdraft_theme');
    expect(asset.file.waterTexture).toBe('synthetic-water');
  });

  it('exposes label presets in a Map, lists unknown keys, and nulls absent optionals', async () => {
    const base = await makeDir('georama-theme-v2c-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    const enc = new TextEncoder();
    const body = JSON.parse(new TextDecoder().decode(themeJson())) as Record<string, unknown>;
    body['zzz_extra'] = 1;
    body['aaa_extra'] = 2;
    await fs.writeFile(
      path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'),
      enc.encode(JSON.stringify(body)),
    );
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const asset = await store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme');
    const preset = asset.file.labelPresets.get('synthetic');
    expect(preset).toMatchObject({ fontName: 'Synthetic Font', fontSize: 12, fontOutlineWidth: 1 });
    expect(preset?.fontColor).toMatchObject({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
    expect(asset.file.labelPresets.size).toBe(1);
    expect(asset.file.unknownKeys).toEqual(['aaa_extra', 'zzz_extra']);
    expect(asset.file.waterColors).toBe(null);
    expect(asset.file.waterColorNames).toBe(null);
    expect(asset.file.groundColorNames).toBe(null);
    expect(asset.file.groundColors).toHaveLength(1);
    expect(asset.file.symbolCustomColors).toHaveLength(1);
  });

  it('does not cache: mutating one parsed theme cannot affect a reread', async () => {
    const base = await makeDir('georama-theme-v2d-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    const first = await store.readTheme(ref);
    (first.file.groundColors as unknown as Array<{ r: number }>).pop();
    (first.file.labelPresets as Map<string, unknown>).delete('synthetic');
    const second = await store.readTheme(ref);
    expect(second.file.groundColors).toHaveLength(1);
    expect(second.file.labelPresets.size).toBe(1);
    expect(second.file.labelPresets).not.toBe(first.file.labelPresets);
    expect(second.file).not.toBe(first.file);
  });

  it('publishes the exact frozen 1MiB theme ceiling', () => {
    expect(THEME_STORE_LIMITS).toEqual({ maxReadBytes: 1048576 });
    expect(Object.isFrozen(THEME_STORE_LIMITS)).toBe(true);
  });
});

describe('theme store vertical 3: caps, order and decoder strictness', () => {
  it('enforces exact byte caps len-1/len/len+1 on both sources, 0, 1MiB and 1MiB+1', async () => {
    const bytes = themeJson();
    const base = await makeDir('georama-theme-v3a-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://themes/synthetic/Willow.wonderdraft_theme', data: bytes }]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), bytes);
    const store = await createAssetStore({ installRoot, userDataRoot });
    openStores.push(store);
    const pckRef = 'res://themes/synthetic/Willow.wonderdraft_theme';
    const userRef = 'user://themes/synthetic/Willow.wonderdraft_theme';
    for (const ref of [pckRef, userRef]) {
      await expect(store.readTheme(ref, bytes.length - 1)).rejects.toMatchObject({ code: 'LIMIT' });
      expect((await store.readTheme(ref, bytes.length)).file.waterTexture).toBe('synthetic-water');
      expect((await store.readTheme(ref, bytes.length + 1)).file.waterTexture).toBe('synthetic-water');
      await expect(store.readTheme(ref, 0)).rejects.toMatchObject({ code: 'LIMIT' });
      expect((await store.readTheme(ref, 1048576)).file.waterTexture).toBe('synthetic-water');
      await expect(store.readTheme(ref, 1048577)).rejects.toMatchObject({ code: 'LIMIT' });
    }
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
        await expect(
          store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme', cap as number),
        ).rejects.toMatchObject({ code: 'LIMIT' });
      }
    } finally {
      (fsPromises as unknown as Record<string, unknown>)['open'] = origOpen;
    }
    expect(coercions).toBe(0);
    expect(opens).toBe(0);
  });

  it('validates cap before bad refs and before CLOSED; resolves before CLOSED', async () => {
    const base = await makeDir('georama-theme-v3b-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    await expect(store.readTheme('bogus', NaN)).rejects.toMatchObject({ code: 'LIMIT' });
    await store.close();
    await expect(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme', NaN)).rejects.toMatchObject({
      code: 'LIMIT',
    });
    await expect(store.readTheme('bogus')).rejects.toMatchObject({ name: 'ThemeRefError' });
    await expect(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
      code: 'CLOSED',
    });
    await expect(store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
      code: 'CLOSED',
    });
  });

  it('rejects wrong extensions before any backend read, even for fake entries', async () => {
    // No roots at all: a resolver failure must surface before ROOT/CLOSED/IO.
    const store = await createAssetStore();
    openStores.push(store);
    await expect(store.readTheme('res://themes/synthetic/Willow.gd')).rejects.toMatchObject({
      name: 'ThemeRefError',
      code: 'EXTENSION',
    });
    await expect(store.readTheme('user://themes/synthetic/Willow.png')).rejects.toMatchObject({
      name: 'ThemeRefError',
      code: 'EXTENSION',
    });
    // A valid ref with no roots configured reports ROOT, not a backend error.
    await expect(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
      code: 'ROOT',
    });
    await expect(store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
      code: 'ROOT',
    });
  });

  it('accepts a zero cap through validation and reports missing ROOT next', async () => {
    // No roots: cap 0 is a legal cap, so the failure must be ROOT (not LIMIT).
    const store = await createAssetStore();
    openStores.push(store);
    await expect(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme', 0)).rejects.toMatchObject({
      code: 'ROOT',
    });
    await expect(store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme', 0)).rejects.toMatchObject({
      code: 'ROOT',
    });
  });

  it('passes the stricter native user-reader PATH through without loosening it', async () => {
    const base = await makeDir('georama-theme-v3c-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(userDataRoot, { recursive: true });
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    // ':' passes the theme resolver but the native reader refuses it.
    await expect(store.readTheme('user://themes/a:b/X.wonderdraft_theme')).rejects.toMatchObject({
      name: 'AssetFileError',
      code: 'PATH',
    });
  });

  it('rejects invalid UTF-8 as ENCODING with a valid-controls retry', async () => {
    const good = themeJson();
    const bad = Uint8Array.from(good);
    const quote = bad.indexOf(0x22);
    bad[quote + 1] = 0xff;
    const base = await makeDir('georama-theme-v3d-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    const leaf = path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme');
    await fs.writeFile(leaf, bad);
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    await expect(store.readTheme(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'ENCODING' });
    await fs.writeFile(leaf, good);
    expect((await store.readTheme(ref)).file.waterTexture).toBe('synthetic-water');
  });

  it('rejects a BOM as SYNTAX and bad JSON as SYNTAX/SHAPE with retry', async () => {
    const enc = new TextEncoder();
    const base = await makeDir('georama-theme-v3e-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    const leaf = path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme');
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    await fs.writeFile(leaf, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(themeJson())]));
    await expect(store.readTheme(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'SYNTAX' });
    await fs.writeFile(leaf, enc.encode('{not json'));
    await expect(store.readTheme(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'SYNTAX' });
    await fs.writeFile(leaf, enc.encode('[1,2]'));
    await expect(store.readTheme(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code: 'SHAPE' });
    await fs.writeFile(leaf, themeJson());
    expect((await store.readTheme(ref)).file.waterTexture).toBe('synthetic-water');
  });

  it('preserves SHAPE and TYPE failures from the theme parser', async () => {
    const enc = new TextEncoder();
    const base = await makeDir('georama-theme-v3f-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    const leaf = path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme');
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    const full = JSON.parse(new TextDecoder().decode(themeJson())) as Record<string, unknown>;
    const missingWater = { ...full };
    delete missingWater['water_texture'];
    const badColor = { ...full, coastline_color: 'nope' };
    const badNumber = { ...full, water_hue: 'zero' };
    const badPresetMissing = {
      ...full,
      label_presets: { synthetic: { font_name: 'x' } },
    };
    const badPresetType = {
      ...full,
      label_presets: { synthetic: { font_name: 'x', font_size: 'big' } },
    };
    const cases: Array<[unknown, string]> = [
      [missingWater, 'SHAPE'],
      [{}, 'SHAPE'],
      [badColor, 'TYPE'],
      [badNumber, 'TYPE'],
      [badPresetMissing, 'SHAPE'],
      [badPresetType, 'TYPE'],
    ];
    for (const [body, code] of cases) {
      await fs.writeFile(leaf, enc.encode(JSON.stringify(body)));
      await expect(store.readTheme(ref)).rejects.toMatchObject({ name: 'AssetJsonError', code });
    }
    await fs.writeFile(leaf, themeJson());
    expect((await store.readTheme(ref)).file.waterTexture).toBe('synthetic-water');
  });

  it('surfaces native MISSING for absent themes on both sources without fallback', async () => {
    const { makePng } = await import('../helpers/pck-synthetic.ts');
    const png = makePng({ width: 2, height: 3 });
    const base = await makeDir('georama-theme-v3g-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://sprites/synthetic/tree.wonderdraft_image', data: png }]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Other.wonderdraft_theme'), themeJson());
    const store = await createAssetStore({ installRoot, userDataRoot });
    openStores.push(store);
    // Present image/sibling files must not satisfy a theme read on either source.
    await expect(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
      code: 'MISSING',
    });
    await expect(store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
      code: 'MISSING',
    });
  });

  it('rejects oversize backend files with LIMIT before allocation', async () => {
    const base = await makeDir('georama-theme-v3h-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
    const store = await createAssetStore({ userDataRoot });
    openStores.push(store);
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    await expect(store.readTheme(ref, 10)).rejects.toMatchObject({ code: 'LIMIT' });
    expect((await store.readTheme(ref)).file.waterTexture).toBe('synthetic-water');
  });

  it('reports missing-source ROOT before BUSY and defaults to 1MiB', async () => {
    const base = await makeDir('georama-theme-v3i-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
    // No install root: hold all four shared slots with user reads, then a PCK
    // ref must still report ROOT (not BUSY).
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
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    const held = [store.readTheme(ref), store.readTheme(ref), store.readTheme(ref), store.readTheme(ref)];
    const pending: Array<Promise<unknown>> = held.map((p) => p.catch(() => undefined as never));
    try {
      await waitForCondition(() => entered >= 4, 5000, 'four user theme reads to reach IO');
      await expect(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
        code: 'ROOT',
      });
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled(pending);
    }
    // Default cap is the 1MiB theme ceiling.
    expect((await store.readTheme(ref)).file.groundTexture).toBe('synthetic-ground');
  });
});

describe('theme store vertical 4: mixed admission and close drain', () => {
  function folderJson(): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ name: 'synthetic folder', radius: 3, offset_x: 1, offset_y: -2, draw_mode: 'normal' }),
    );
  }

  it('admits four mixed image+symbol+theme reads and rejects a fifth per method without IO', async () => {
    const { makePng } = await import('../helpers/pck-synthetic.ts');
    const pngA = makePng({ width: 2, height: 3 });
    const pngB = makePng({ width: 4, height: 1 });
    const base = await makeDir('georama-theme-v4a-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([
        { path: 'res://sprites/synthetic/tree.wonderdraft_image', data: pngA },
        { path: 'res://sprites/synthetic/.wonderdraft_symbols', data: folderJson() },
        { path: 'res://themes/synthetic/Willow.wonderdraft_theme', data: themeJson() },
      ]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'tree.png'), pngA);
    await fs.writeFile(path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', 'bush.png'), pngB);
    await fs.writeFile(
      path.join(userDataRoot, 'assets', 'synthetic-pack', 'trees', '.wonderdraft_symbols'),
      folderJson(),
    );
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
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
    const p2 = store.readSymbolSet('res://sprites/synthetic/tree');
    const p3 = store.readImage('symbol', 'user://assets/synthetic-pack/trees/tree');
    const p4 = store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme');
    const held: Array<Promise<unknown>> = [p1, p2, p3, p4];
    try {
      await waitForCondition(() => entered >= 4, 5000, 'four mixed reads to reach IO');
      async function expectBusy(fifth: Promise<unknown>): Promise<void> {
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
        held.push(fifth.catch(() => undefined as never));
        await waitForCondition(() => fifthDone || entered > 4, 5000, 'fifth to settle or extra IO');
        expect(entered).toBe(4);
        expect(fifthDone).toBe(true);
        expect(fifthError).toMatchObject({ name: 'AssetStoreError', code: 'BUSY' });
      }
      await expectBusy(store.readImage('symbol', 'user://assets/synthetic-pack/trees/bush'));
      await expectBusy(store.readSymbolSet('user://assets/synthetic-pack/trees/bush'));
      await expectBusy(store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme'));
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled(held);
    }
    expect((await store.readImage('symbol', 'res://sprites/synthetic/tree')).bytes).toEqual(pngA);
    expect((await store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme')).file.waterTexture).toBe(
      'synthetic-water',
    );
  });

  it('close waits for an admitted user theme read with the archive fd still open', async () => {
    const { makePng } = await import('../helpers/pck-synthetic.ts');
    const png = makePng({ width: 2, height: 3 });
    const base = await makeDir('georama-theme-v4b-');
    const installRoot = path.join(base, 'install');
    await fs.mkdir(installRoot, { recursive: true });
    await fs.writeFile(
      path.join(installRoot, 'Wonderdraft.pck'),
      buildPck([{ path: 'res://sprites/synthetic/tree.wonderdraft_image', data: png }]),
    );
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
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
    const userPending = store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme');
    try {
      await waitForCondition(() => entered >= 1, 5000, 'user theme read to reach IO');
      const closing = store.close();
      await tick(2);
      expect(await archiveFdState()).toBe(pckPath);
      releaseGate();
      await closing;
      const asset = await userPending;
      expect(asset.key).toBe('theme:user:themes/synthetic/Willow.wonderdraft_theme');
      const after = await archiveFdState();
      expect(after === null || after !== pckPath).toBe(true);
      await expect(store.readImage('symbol', 'res://sprites/synthetic/tree')).rejects.toMatchObject({
        code: 'CLOSED',
      });
      await expect(store.readSymbolSet('res://sprites/synthetic/tree')).rejects.toMatchObject({ code: 'CLOSED' });
      await expect(store.readTheme('user://themes/synthetic/Willow.wonderdraft_theme')).rejects.toMatchObject({
        code: 'CLOSED',
      });
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled([userPending.catch(() => undefined as never)]);
    }
  });

  it('user-only close settles the public theme read before close resolves', async () => {
    const base = await makeDir('georama-theme-v4c-');
    const userDataRoot = path.join(base, 'user');
    await fs.mkdir(path.join(userDataRoot, 'themes', 'synthetic'), { recursive: true });
    await fs.writeFile(path.join(userDataRoot, 'themes', 'synthetic', 'Willow.wonderdraft_theme'), themeJson());
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
    const ref = 'user://themes/synthetic/Willow.wonderdraft_theme';
    const rp = store.readTheme(ref).then((value) => {
      order.push('read');
      return value;
    });
    const pending: Array<Promise<unknown>> = [rp.catch(() => undefined as never)];
    try {
      await waitForCondition(() => entered >= 1, 5000, 'theme read to reach IO');
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
      expect(asset.key).toBe('theme:user:themes/synthetic/Willow.wonderdraft_theme');
    } finally {
      releaseGate();
      proto['read'] = origRead;
      await Promise.allSettled(pending);
    }
  });
});
