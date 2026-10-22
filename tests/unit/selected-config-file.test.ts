import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as selectedFile from '../../electron/data/selected-file.ts';
import { CONFIG_LIMITS, ConfigError } from '../../electron/assets/config.ts';
import * as configMod from '../../electron/assets/config.ts';
import { SelectedFileError } from '../../electron/data/selected-file.ts';
import * as assetJson from '../../src/core/assets/asset-json.ts';
import { AssetJsonError } from '../../src/core/assets/asset-json.ts';
import { readSelectedConfigFile } from '../../electron/data/config-file.ts';

const roots: string[] = [];
async function mkroot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'sel-cfg-'));
  roots.push(base);
  return base;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of roots.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function expectConfigError(promise: Promise<unknown>, code: string, key: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe(code);
    expect((error as ConfigError).key).toBe(key);
    expect((error as Error).name).toBe('ConfigError');
    return error as ConfigError;
  }
  throw new Error(`expected ConfigError/${code}/${key}`);
}

async function expectSelectedError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SelectedFileError);
    expect((error as SelectedFileError).code).toBe(code);
    expect((error as Error).message).not.toContain(os.tmpdir());
    expect((error as Error).name).toBe('SelectedFileError');
    return error as SelectedFileError;
  }
  throw new Error(`expected SelectedFileError/${code}`);
}

describe('selected-config-file setup', () => {
  it('reads one owned JSON config through C7 with exact cap', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{"wonderdraftInstall":"/invented/wd-install","wonderdraftUserData":"/invented/wd-data","mapRoots":["/invented/maps-a"]}');
    const spy = vi.spyOn(selectedFile, 'readSelectedDataFile');
    const cfg = await readSelectedConfigFile(file);
    expect(cfg).toEqual({
      wonderdraftInstall: '/invented/wd-install',
      wonderdraftUserData: '/invented/wd-data',
      mapRoots: ['/invented/maps-a'],
    });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(file, CONFIG_LIMITS.maxBytes);
  });

  it('maps malformed UTF-8 inside a known path string to SYNTAX with no cause', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    const raw = Buffer.concat([
      Buffer.from('{"wonderdraftInstall":"/invented/wd-a', 'utf8'),
      Buffer.from([0xff]),
      Buffer.from('/b"}', 'utf8'),
    ]);
    await fs.writeFile(file, raw);
    try {
      await readSelectedConfigFile(file);
      expect.unreachable('expected ConfigError/SYNTAX');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).code).toBe('SYNTAX');
      expect((error as ConfigError).key).toBe('');
      expect((error as Error).message).toBe('config is not valid UTF-8');
      expect((error as Error).name).toBe('ConfigError');
      expect('cause' in (error as Record<string, unknown>)).toBe(false);
    }
  });
});

describe('frozen parser behavior through composition', () => {
  it('reads real unicode config with frozen result', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{"wonderdraftInstall":"/invented/caf\\u00e9-\\u00fc-\\u00df","mapRoots":["/invented/\\ud83d\\ude00-maps"]}');
    const cfg = await readSelectedConfigFile(file);
    expect(cfg).toEqual({ wonderdraftInstall: '/invented/café-ü-ß', mapRoots: ['/invented/😀-maps'] });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.mapRoots)).toBe(true);
  });

  it('rejects BOM-prefixed JSON as SYNTAX (decoder retains BOM)', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}', 'utf8')]));
    await expectConfigError(readSelectedConfigFile(file), 'SYNTAX', '');
  });

  it('rejects empty file as SYNTAX (no empty-config fallback)', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '');
    await expectConfigError(readSelectedConfigFile(file), 'SYNTAX', '');
  });

  it('rejects malformed JSON as SYNTAX', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{oops');
    await expectConfigError(readSelectedConfigFile(file), 'SYNTAX', '');
  });

  it.each([['array', '[]'], ['null', 'null'], ['number', '42'], ['string', '"s"']])(
    'rejects non-object root %s as SHAPE',
    async (_label, text) => {
      const base = await mkroot();
      const file = path.join(base, 'owned.json');
      await fs.writeFile(file, text);
      await expectConfigError(readSelectedConfigFile(file), 'SHAPE', '');
    },
  );

  it('rejects wrong key type with exact TYPE key', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{"wonderdraftInstall":7}');
    await expectConfigError(readSelectedConfigFile(file), 'TYPE', 'wonderdraftInstall');
  });

  it('rejects relative path with exact PATH key', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{"wonderdraftInstall":"relative/x"}');
    await expectConfigError(readSelectedConfigFile(file), 'PATH', 'wonderdraftInstall');
  });

  it('ignores unknown keys via frozen parser', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{"x":1,"__proto__":{"x":1},"mapRoots":[]}');
    const cfg = (await readSelectedConfigFile(file)) as Record<string, unknown>;
    expect(cfg).toEqual({ mapRoots: [] });
    expect(Object.hasOwn(cfg, 'x')).toBe(false);
    expect(Object.hasOwn(cfg, '__proto__')).toBe(false);
  });

  it('accepts 64 map roots and rejects 65 with SHAPE', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    const ok = `{"mapRoots":[${Array(64).fill('"/invented/m"').join(',')}]}`;
    await fs.writeFile(file, ok);
    const cfg2 = await readSelectedConfigFile(file);
    expect(cfg2.mapRoots?.length).toBe(64);
    expect(Object.isFrozen(cfg2.mapRoots)).toBe(true);
    expect(cfg2).toEqual({ mapRoots: Array(64).fill('/invented/m') });
    const tooMany = `{"mapRoots":[${Array(65).fill('"/invented/m"').join(',')}]}`;
    await fs.writeFile(file, tooMany);
    await expectConfigError(readSelectedConfigFile(file), 'SHAPE', 'mapRoots');
  });

  it('accepts exactly 65536-byte JSON with padding', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    const pad = 'p'.repeat(65_536 - 10);
    const text = `{"pad":"${pad}"}`;
    expect(Buffer.byteLength(text, 'utf8')).toBe(65_536);
    await fs.writeFile(file, text);
    expect(await readSelectedConfigFile(file)).toEqual({});
  });

  it('rejects 65537-byte sparse file with LIMIT before decode (no huge fixture)', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    const h = await fs.open(file, 'w');
    try {
      await h.truncate(65_537);
    } finally {
      await h.close();
    }
    const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
    const parseSpy = vi.spyOn(configMod, 'parseConfig');
    await expectSelectedError(readSelectedConfigFile(file), 'LIMIT');
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe('C7 failure passthrough (verify-pass of frozen reader)', () => {
  it.each(['leaf.PNG', 'code.gdc', 'x.js', 'x.JSON', 'x.json.bak', 'x.json/'])(
    'propagates EXTENSION for unsupported suffix %s without decode',
    async (suffix) => {
      const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
      const parseSpy = vi.spyOn(configMod, 'parseConfig');
      await expectSelectedError(readSelectedConfigFile(`/unused-${suffix}`), 'EXTENSION');
      expect(decodeSpy).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    },
  );

  it('reports selected-missing as MISSING, not empty-config fallback', async () => {
    const base = await mkroot();
    const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
    const parseSpy = vi.spyOn(configMod, 'parseConfig');
    await expectSelectedError(readSelectedConfigFile(path.join(base, 'absent.json')), 'MISSING');
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('refuses leaf symlinks with PATH and leaves target unchanged', async () => {
    const base = await mkroot();
    const target = path.join(base, 'target.json');
    await fs.writeFile(target, '{"wonderdraftInstall":"/invented/secret"}');
    const link = path.join(base, 'leaf.json');
    await fs.symlink(target, link);
    const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
    await expectSelectedError(readSelectedConfigFile(link), 'PATH');
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(await fs.readFile(target, 'utf8')).toBe('{"wonderdraftInstall":"/invented/secret"}');
  });

  it('refuses directories with TYPE', async () => {
    const base = await mkroot();
    const dir = path.join(base, 'dir.json');
    await fs.mkdir(dir);
    await expectSelectedError(readSelectedConfigFile(dir), 'TYPE');
  });

  it('opens FIFOs nonblocking and rejects them with TYPE', async () => {
    const base = await mkroot();
    const fifo = path.join(base, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    await expectSelectedError(readSelectedConfigFile(fifo), 'TYPE');
  }, 5000);

  it('rejects wrong-typed filename with PATH before decode', async () => {
    const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
    const parseSpy = vi.spyOn(configMod, 'parseConfig');
    await expectSelectedError(readSelectedConfigFile(42 as unknown as string), 'PATH');
    expect(decodeSpy).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
  });
});

describe('reader fault identity (by operation stage)', () => {
  it.each(['PATH', 'EXTENSION', 'LIMIT', 'MISSING', 'TYPE', 'IO', 'CHANGED'] as const)(
    'propagates reader %s with exact same identity and zero decode/parse calls',
    async (code) => {
      const base = await mkroot();
      const file = path.join(base, 'owned.json');
      await fs.writeFile(file, '{}');
      const injected = new SelectedFileError(code, `injected-${code}`);
      const reader = vi.spyOn(selectedFile, 'readSelectedDataFile').mockRejectedValueOnce(injected);
      const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
      const parseSpy = vi.spyOn(configMod, 'parseConfig');
      let caught: unknown;
      try {
        await readSelectedConfigFile(file);
        expect.unreachable(`expected SelectedFileError/${code}`);
      } catch (error) {
        caught = error;
      } finally {
        expect(reader).toHaveBeenCalledTimes(1);
        expect(reader).toHaveBeenCalledWith(file, CONFIG_LIMITS.maxBytes);
        expect(decodeSpy).not.toHaveBeenCalled();
        expect(parseSpy).not.toHaveBeenCalled();
      }
      expect(caught).toBe(injected);
      expect(caught).toBeInstanceOf(SelectedFileError);
    },
  );
});

describe('decoder fault normalization (by error kind)', () => {
  it.each([
    ['asset-encoding', () => new AssetJsonError('ENCODING', '/', 'input is not valid UTF-8')],
    ['asset-too-large', () => new AssetJsonError('TOO_LARGE', '/', 'input exceeds maxChars')],
    ['type-error', () => new TypeError('boom')],
    ['plain-error', () => new Error('plain')],
    ['sneaky-selected', () => new SelectedFileError('IO', 'sneaky')],
    ['sneaky-config', () => new ConfigError('PATH', 'k', 'sneaky-path')],
  ])('normalizes decoder %s to SYNTAX with no cause', async (_label, make) => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{}');
    const thrown = make();
    vi.spyOn(assetJson, 'decodeAssetText').mockImplementationOnce(() => {
      throw thrown;
    });
    const parseSpy = vi.spyOn(configMod, 'parseConfig');
    let caught: unknown;
    try {
      await readSelectedConfigFile(file);
      expect.unreachable('expected ConfigError/SYNTAX');
    } catch (error) {
      caught = error;
    } finally {
      expect(parseSpy).not.toHaveBeenCalled();
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).code).toBe('SYNTAX');
    expect((caught as ConfigError).key).toBe('');
    expect((caught as Error).message).toBe('config is not valid UTF-8');
    expect((caught as Error).name).toBe('ConfigError');
    expect('cause' in (caught as Record<string, unknown>)).toBe(false);
    expect(caught).not.toBe(thrown);
  });
});

describe('parser faults pass through outside the decode catch', () => {
  it('preserves parser ConfigError identity and key', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{}');
    const injected = new ConfigError('PATH', 'mapRoots[0]', 'mapRoots[0]: path must be absolute');
    vi.spyOn(configMod, 'parseConfig').mockImplementationOnce(() => {
      throw injected;
    });
    let caught: unknown;
    try {
      await readSelectedConfigFile(file);
      expect.unreachable('expected parser ConfigError');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(injected);
    expect((caught as ConfigError).code).toBe('PATH');
    expect((caught as ConfigError).key).toBe('mapRoots[0]');
  });

  it('returns the parser result object identity as-is', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{}');
    const frozen = Object.freeze({ wonderdraftInstall: '/invented/only' });
    vi.spyOn(configMod, 'parseConfig').mockReturnValueOnce(frozen);
    const got = await readSelectedConfigFile(file);
    expect(got).toBe(frozen);
  });
});

describe('owned-handle gate and reread identity', () => {
  it('holds decode until the owned handle really closes, then reports EBADF', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{}');
    const actualOpen = fs.open.bind(fs);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let realClosed = false;
    let nativeRead: (b: Uint8Array, o: number, l: number, q: number) => Promise<unknown>;
    vi.spyOn(fs, 'open').mockImplementation(async (p, f, ...rest) => {
      const h = await actualOpen(p as string, f as number, ...(rest as []));
      if (String(p) === file) {
        nativeRead = h.read.bind(h);
        const origClose = h.close.bind(h);
        Object.defineProperty(h, 'close', {
          value: async () => {
            await gate;
            const out = await origClose();
            realClosed = true;
            return out;
          },
          configurable: true,
        });
      }
      return h;
    });
    const decodeSpy = vi.spyOn(assetJson, 'decodeAssetText');
    let pending: Promise<unknown> | undefined;
    try {
      pending = readSelectedConfigFile(file);
      await new Promise((r) => setTimeout(r, 60));
      expect(decodeSpy).not.toHaveBeenCalled();
    } finally {
      release();
    }
    const cfg = await pending;
    expect(cfg).toEqual({});
    expect(realClosed).toBe(true);
    await expect(nativeRead!(new Uint8Array(1), 0, 1, 0)).rejects.toMatchObject({ code: 'EBADF' });
  });

  it('returns fresh frozen roots across real rereads with no extra I/O', async () => {
    const base = await mkroot();
    const file = path.join(base, 'owned.json');
    await fs.writeFile(file, '{"mapRoots":["/invented/m1","/invented/m2"]}');
    const reader = vi.spyOn(selectedFile, 'readSelectedDataFile');
    const opener = vi.spyOn(fs, 'open');
    const first = await readSelectedConfigFile(file);
    const second = await readSelectedConfigFile(file);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.mapRoots).not.toBe(second.mapRoots);
    expect(first.mapRoots).toEqual(['/invented/m1', '/invented/m2']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.mapRoots)).toBe(true);
    expect(Object.isFrozen(second.mapRoots)).toBe(true);
    expect(reader).toHaveBeenCalledTimes(2);
    expect(reader).toHaveBeenNthCalledWith(1, file, CONFIG_LIMITS.maxBytes);
    expect(reader).toHaveBeenNthCalledWith(2, file, CONFIG_LIMITS.maxBytes);
    expect(opener).toHaveBeenCalledTimes(2);
  });
});

describe('module hygiene', () => {
  it('imports only reviewed deps and performs no side-channel I/O', async () => {
    const src = await fs.readFile(new URL('../../electron/data/config-file.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('electron');
    const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs.sort()).toEqual(
      ['../../src/core/assets/asset-json.ts', '../assets/config.ts', '../assets/config.ts', './selected-file.ts'].sort(),
    );
    for (const banned of [
      'loadConfig',
      'configFilePath',
      'resolveRoots',
      'readFile',
      'readdir',
      'O_RDONLY',
      'O_NOFOLLOW',
      'process.env',
      'require(',
      'cause',
    ]) {
      expect(src).not.toContain(banned);
    }
    expect(src).toContain('CONFIG_LIMITS.maxBytes');
    expect(src).toContain('decodeAssetText');
    expect(src).toContain('parseConfig');
  });
});
