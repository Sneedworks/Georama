// Card 1.4: reads the owner's texture PNGs for the env-gated texture phase (tests/e2e/gl.mjs).
// Node only; never part of src/core. Names and paths stay in this process: error messages carry no names,
// and the phase prints counts only.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePngRgba8 } from '../../src/core/assets/png-pixels.ts';

export type TextureDirErrorCode = 'missing' | 'name' | 'png';

export class TextureDirError extends Error {
  readonly code: TextureDirErrorCode;

  constructor(code: TextureDirErrorCode, message: string) {
    super(message);
    this.name = 'TextureDirError';
    this.code = code;
  }
}

export interface TextureDirTexture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export type TextureDirResult =
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'ok'; readonly textures: readonly TextureDirTexture[] };

const GROUPS = ['water', 'ground'] as const;
const MAX_NAME_CHARS = 512;
const PNG_SUFFIX = '.png';

// The bare-name rule of resolveRef (src/core/assets/resolve.ts): no separator, no leading dot, not empty.
function checkBareName(bare: string): void {
  if (bare.length === 0 || bare.length > MAX_NAME_CHARS) {
    throw new TextureDirError('name', 'texture name length out of range');
  }
  if (bare.includes('/') || bare.includes('\\')) {
    throw new TextureDirError('name', 'texture name must not contain a separator');
  }
  if (bare.startsWith('.')) {
    throw new TextureDirError('name', 'texture name must not start with a dot');
  }
}

export function readTextureDir(dir: string | undefined): TextureDirResult {
  if (dir === undefined || dir === '') {
    return { kind: 'skip', reason: 'GEORAMA_TEXTURE_DIR not set' };
  }
  const textures: TextureDirTexture[] = [];
  for (const group of GROUPS) {
    const groupDir = join(dir, group);
    let entries: string[];
    try {
      entries = readdirSync(groupDir);
    } catch {
      throw new TextureDirError('missing', `${group}/ is not readable`);
    }
    for (const entry of entries.sort()) {
      if (!entry.toLowerCase().endsWith(PNG_SUFFIX)) continue;
      const bare = entry.slice(0, -PNG_SUFFIX.length);
      checkBareName(bare);
      let decoded: ReturnType<typeof decodePngRgba8>;
      try {
        decoded = decodePngRgba8(new Uint8Array(readFileSync(join(groupDir, entry))));
      } catch {
        throw new TextureDirError('png', `${group}/ holds a file that does not decode`);
      }
      textures.push({ name: `${group}/${bare}`, width: decoded.width, height: decoded.height, rgba: decoded.rgba });
    }
  }
  return { kind: 'ok', textures };
}
