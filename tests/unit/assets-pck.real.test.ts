import { close, open, read } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PckError, isPckDataPath, loadPckIndex, readPckEntry } from '../../src/core/assets/pck.ts';
import type { ByteSource, PckIndex } from '../../src/core/assets/pck.ts';
import { PngError, validatePng } from '../../src/core/assets/png.ts';

const pckPath = process.env.GEORAMA_WONDERDRAFT_PCK;

/** Positional-read ByteSource over node:fs, built inside this test file. */
function fsSource(path: string, size: number): ByteSource & { reads: number; close: () => Promise<void> } {
  let handle: number | undefined;
  const state = { reads: 0 };
  return {
    size,
    get reads(): number {
      return state.reads;
    },
    async read(offset: number, length: number): Promise<Uint8Array> {
      if (handle === undefined) {
        handle = await new Promise<number>((resolve, reject) => {
          open(path, 'r', (error, fd) => {
            if (error) reject(error);
            else resolve(fd);
          });
        });
      }
      const buffer = new Uint8Array(length);
      const got = await new Promise<number>((resolve, reject) => {
        read(handle as number, buffer, 0, length, offset, (error, bytesRead) => {
          if (error) reject(error);
          else resolve(bytesRead);
        });
      });
      state.reads += 1;
      return got === length ? buffer : buffer.subarray(0, got);
    },
    async close(): Promise<void> {
      if (handle !== undefined) {
        const fd = handle;
        handle = undefined;
        await new Promise<void>((resolve, reject) => {
          close(fd, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    },
  };
}

async function fileSizeOf(path: string): Promise<number> {
  const { stat } = await import('node:fs/promises');
  return (await stat(path)).size;
}

describe.skipIf(!pckPath)('real Wonderdraft.pck', () => {
  it('indexes 2403 entries at Godot 3.0.0', async () => {
    const size = await fileSizeOf(pckPath as string);
    const source = fsSource(pckPath as string, size);
    try {
      const index: PckIndex = await loadPckIndex(source);
      expect([...index.godotVersion]).toEqual([3, 0, 0]);
      expect(index.entries.size).toBe(2403);
    } finally {
      await source.close();
    }
  });

  it('all 1745 data images are structurally valid PNGs', async () => {
    const size = await fileSizeOf(pckPath as string);
    const source = fsSource(pckPath as string, size);
    try {
      const index = await loadPckIndex(source);
      const images: string[] = [];
      for (const path of index.entries.keys()) {
        if (isPckDataPath(path) && path.endsWith('.wonderdraft_image')) images.push(path);
      }
      expect(images.length).toBe(1745);
      let invalid = 0;
      for (const path of images) {
        const bytes = await readPckEntry(source, index, path, 64 * 1024 * 1024);
        try {
          validatePng(bytes);
        } catch (error) {
          if (error instanceof PngError) invalid += 1;
          else throw error;
        }
      }
      expect(invalid).toBe(0);
    } finally {
      await source.close();
    }
  });

  it('refuses a compiled script without touching the source', async () => {
    const size = await fileSizeOf(pckPath as string);
    const source = fsSource(pckPath as string, size);
    try {
      const index = await loadPckIndex(source);
      let script: string | undefined;
      for (const path of index.entries.keys()) {
        if (path.endsWith('.gdc')) {
          script = path;
          break;
        }
      }
      expect(script).toBeDefined();
      const before = source.reads;
      try {
        await readPckEntry(source, index, script as string);
      } catch (error) {
        expect(error).toBeInstanceOf(PckError);
        expect((error as PckError).code).toBe('EXTENSION');
      }
      expect(source.reads).toBe(before);
    } finally {
      await source.close();
    }
  });
});
