import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeAssetText, parseSymbolSet, parseThemeFile } from '../../src/core/assets/asset-json.ts';

const userData = process.env.GEORAMA_WONDERDRAFT_USERDATA ?? '';

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

describe.skipIf(!userData)('real user-data asset JSON', () => {
  it('parses every .wonderdraft_symbols and .wonderdraft_theme (counts only)', async () => {
    const assetsDir = path.join(userData, 'assets');
    const files: string[] = [];
    await walk(assetsDir, files);
    const symbolFiles = files.filter((f) => path.basename(f) === '.wonderdraft_symbols');
    const themeFiles = files.filter((f) => f.endsWith('.wonderdraft_theme'));
    let folder = 0;
    let images = 0;
    for (const file of symbolFiles) {
      const parsed = parseSymbolSet(decodeAssetText(await readFile(file)));
      if (parsed.shape === 'folder') folder++;
      else images++;
    }
    let themes = 0;
    for (const file of themeFiles) {
      parseThemeFile(decodeAssetText(await readFile(file)));
      themes++;
    }
    console.log(`symbols=${symbolFiles.length} folder=${folder} images=${images} themes=${themes}`);
    expect(symbolFiles.length).toBe(57);
    expect(folder).toBe(54);
    expect(images).toBe(3);
    expect(themes).toBe(7);
  });
});
