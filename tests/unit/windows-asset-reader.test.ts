import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readAssetFile, AssetFileError } from '../../electron/assets/open.ts';
import { createAssetStore, type AssetStore } from '../../electron/assets/store.ts';
import { makePng } from '../helpers/pck-synthetic.ts';

const helper = path.resolve(process.cwd(), 'out', 'windows', 'georama-win-asset-read.exe');
const roots: string[] = [];
const stores: AssetStore[] = [];
beforeAll(async () => {
  if (process.platform === 'win32') await fs.access(helper); // Missing helper is a failed gate, not a skip.
});
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
});
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-win-assets-'));
  roots.push(base);
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  await fs.mkdir(path.join(root, 'pack'), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(root, 'pack', 'leaf.png'), 'INSIDE');
  await fs.writeFile(path.join(outside, 'leaf.png'), 'OUTSIDE-SECRET');
  return { base, root, outside };
}
async function fails(root: string, relative: string, code: string, maxBytes = 4096) {
  try {
    await readAssetFile(root, relative, maxBytes);
    expect.unreachable('expected asset refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(AssetFileError);
    expect((error as AssetFileError).code).toBe(code);
    expect((error as Error).message).not.toContain(root);
  }
}

describe.skipIf(process.platform !== 'win32')('native Windows scoped asset file reads', () => {
  it('reads exact bytes, empty files and multi-chunk data', async () => {
    const { root } = await fixture();
    expect(new TextDecoder().decode(await readAssetFile(root, 'pack/leaf.png', 6))).toBe('INSIDE');
    await fs.writeFile(path.join(root, 'pack', 'empty.png'), '');
    expect(await readAssetFile(root, 'pack/empty.png', 0)).toEqual(new Uint8Array());
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 123);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 71 + (i >>> 10)) & 255;
    await fs.writeFile(path.join(root, 'pack', 'many.png'), bytes);
    expect(await readAssetFile(root, 'pack/many.png', bytes.length)).toEqual(bytes);
  });

  it('refuses unsupported paths, missing files, directories and oversized data', async () => {
    const { root } = await fixture();
    await fails(root, 'pack/missing.png', 'MISSING');
    await fails(root, 'pack/leaf.png', 'LIMIT', 5);
    await fails(root, 'pack/folder.png', 'MISSING');
    await fs.mkdir(path.join(root, 'pack', 'folder.png'));
    await fails(root, 'pack/folder.png', 'TYPE');
    await fails(root, 'pack/../../leaf.png', 'PATH');
    await fails(root, 'pack//leaf.png', 'PATH');
    await fails(root, 'pack/leaf.png:stream', 'PATH');
    await fails(root, 'pack/CON.png', 'PATH');
    await fails(root, 'pack/code.exe', 'EXTENSION');
    const big = await fs.open(path.join(root, 'pack', 'big.png'), 'w');
    try { await big.truncate(64 * 1024 * 1024 + 1); } finally { await big.close(); }
    await fails(root, 'pack/big.png', 'LIMIT', 64 * 1024 * 1024);
  });

  it('denies intermediate junction escapes and reparse-point roots', async () => {
    const { base, root, outside } = await fixture();
    const junction = path.join(root, 'pack', 'escape');
    await fs.symlink(outside, junction, 'junction');
    await fails(root, 'pack/escape/leaf.png', 'PATH');
    const rootAlias = path.join(base, 'root-alias');
    await fs.symlink(root, rootAlias, 'junction');
    await fails(rootAlias, 'pack/leaf.png', 'PATH');
    expect(await fs.readFile(path.join(outside, 'leaf.png'), 'utf8')).toBe('OUTSIDE-SECRET');
  });

  it('denies final file links where symlink creation is supported', async () => {
    const { root, outside } = await fixture();
    const link = path.join(root, 'pack', 'link.png');
    try {
      await fs.symlink(path.join(outside, 'leaf.png'), link, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await fails(root, 'pack/link.png', 'PATH');
  });

  it('helper itself rejects traversal without emitting bytes or paths', async () => {
    const { root } = await fixture();
    for (const [relative, code] of [
      ['../outside/leaf.png', 'PATH'], ['pack/CON.png', 'PATH'], ['pack/missing.png', 'MISSING'],
    ] as const) {
      const run = spawnSync(helper, [root, relative, '16'], { encoding: 'utf8', windowsHide: true });
      expect(run.status).not.toBe(0);
      expect(run.stdout).toBe('');
      expect(run.stderr.trim()).toBe(code);
      expect(run.stderr).not.toContain(root);
    }
  });

  it('releases open handles after both successful and rejected reads', async () => {
    const { root } = await fixture();
    await readAssetFile(root, 'pack/leaf.png', 6);
    await fails(root, 'pack/leaf.png', 'LIMIT', 1);
    const source = path.join(root, 'pack', 'leaf.png');
    const moved = path.join(root, 'pack', 'renamed.png');
    await fs.rename(source, moved);
    await fs.rename(moved, source);
  });

  it('works through the actual user-symbol asset store', async () => {
    const { root } = await fixture();
    const directory = path.join(root, 'assets', 'synthetic', 'trees');
    await fs.mkdir(directory, { recursive: true });
    const png = makePng({ width: 2, height: 3 });
    await fs.writeFile(path.join(directory, 'oak.png'), png);
    const store = await createAssetStore({ userDataRoot: root });
    stores.push(store);
    const image = await store.readImage('symbol', 'user://assets/synthetic/trees/oak');
    expect(image.bytes).toEqual(png);
    expect(image.info.width).toBe(2);
    expect(image.info.height).toBe(3);
  });
});
