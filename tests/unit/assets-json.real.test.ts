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

// No count is pinned in this file. Every symbol and theme file must parse, and both kinds must be present;
// the counts printed at run time stay on the machine that runs the test.
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
    for (const file of themeFiles) {
      parseThemeFile(decodeAssetText(await readFile(file)));
    }
    console.log(`symbols=${symbolFiles.length} folder=${folder} images=${images} themes=${themeFiles.length}`);
    expect(symbolFiles.length).toBeGreaterThan(0);
    expect(themeFiles.length).toBeGreaterThan(0);
  });
});
