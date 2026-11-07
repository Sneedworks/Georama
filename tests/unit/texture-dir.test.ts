import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTextureDir, TextureDirError } from '../helpers/texture-dir.ts';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// A minimal 8-bit RGBA PNG with filter 0 on every row.
function rgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const parts = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TextureDirError);
    expect((error as TextureDirError).code).toBe(code);
    return;
  }
  throw new Error(`expected a TextureDirError with code ${code}`);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tex-dir-'));
  mkdirSync(join(dir, 'water'));
  mkdirSync(join(dir, 'ground'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readTextureDir', () => {
  it('skips when the variable is unset or empty', () => {
    expect(readTextureDir(undefined).kind).toBe('skip');
    expect(readTextureDir('').kind).toBe('skip');
  });

  it('refuses a directory without water/ with code missing', () => {
    rmSync(join(dir, 'water'), { recursive: true });
    expectCode(() => readTextureDir(dir), 'missing');
  });

  it('decodes water/ and ground/ PNGs to RGBA8, named group/bare', () => {
    const alpha = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
    const beta = new Uint8Array([1, 2, 3, 4]);
    writeFileSync(join(dir, 'water', 'alpha.png'), rgbaPng(2, 1, alpha));
    writeFileSync(join(dir, 'ground', 'beta.png'), rgbaPng(1, 1, beta));
    const result = readTextureDir(dir);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.textures.map((t) => t.name)).toEqual(['water/alpha', 'ground/beta']);
    expect(result.textures[0]).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(result.textures[0].rgba)).toEqual(Array.from(alpha));
    expect(Array.from(result.textures[1].rgba)).toEqual(Array.from(beta));
  });

  it('ignores files that are not PNG', () => {
    writeFileSync(join(dir, 'water', 'notes.txt'), 'not a texture');
    expect(readTextureDir(dir)).toEqual({ kind: 'ok', textures: [] });
  });

  it('refuses a name that starts with a dot with code name', () => {
    writeFileSync(join(dir, 'water', '.hidden.png'), rgbaPng(1, 1, new Uint8Array(4)));
    expectCode(() => readTextureDir(dir), 'name');
  });

  it('refuses bytes that do not decode with code png', () => {
    writeFileSync(join(dir, 'ground', 'broken.png'), new Uint8Array([1, 2, 3]));
    expectCode(() => readTextureDir(dir), 'png');
  });
});
