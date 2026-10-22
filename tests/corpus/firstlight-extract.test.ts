// First-light extraction: reads one map file, validates it, cuts the v0
// window layers and writes the raw bytes for the GPU run. Skipped unless both
// GEORAMA_FIRSTLIGHT_MAP and GEORAMA_FIRSTLIGHT_DIR are set, so `npm test`
// never runs it. The output directory must sit outside the repository root.
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWdMap, validateWdMap } from '../../src/core/formats/wonderdraft-map-file.ts';
import { buildFirstLightLayers, selectWindow, WINDOW_SIZE } from '../../src/core/firstlight/layers.ts';
import type { RgbaRaster } from '../../src/core/firstlight/layers.ts';
import { thresholdFromWaterLevel } from '../../src/renderer/render/compose/classify.ts';
import { projectRoot } from '../helpers/core-gate.ts';

const mapPath = process.env['GEORAMA_FIRSTLIGHT_MAP'] ?? '';
const outDir = process.env['GEORAMA_FIRSTLIGHT_DIR'] ?? '';
const enabled = mapPath !== '' && outDir !== '';

function parseWindow(value: string | undefined, mapWidth: number, mapHeight: number): { x0: number; y0: number } | null {
  if (value === undefined || value === '') return null;
  const parts = value.split(',');
  if (parts.length !== 2) throw new Error('GEORAMA_FIRSTLIGHT_WINDOW must read "x,y"');
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error('GEORAMA_FIRSTLIGHT_WINDOW must hold safe integers >= 0');
  }
  const [x0, y0] = numbers as [number, number];
  if (x0 + WINDOW_SIZE > mapWidth || y0 + WINDOW_SIZE > mapHeight) {
    throw new Error('GEORAMA_FIRSTLIGHT_WINDOW must sit fully inside the map');
  }
  return { x0, y0 };
}

function realpathOfNearestExistingAncestor(target: string): string {
  const missing: string[] = [];
  let current = target;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  const real = realpathSync(current);
  return missing.length > 0 ? path.join(real, ...missing) : real;
}

describe.skipIf(!enabled)('firstlight extraction (GEORAMA_FIRSTLIGHT_MAP and GEORAMA_FIRSTLIGHT_DIR)', () => {
  it('writes the window layers and meta for the GPU run', async () => {
    const resolvedOut = path.resolve(outDir);
    const realOut = realpathOfNearestExistingAncestor(resolvedOut);
    const realRoot = realpathOfNearestExistingAncestor(projectRoot);
    const relative = path.relative(realRoot, realOut);
    if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error('GEORAMA_FIRSTLIGHT_DIR must sit outside the repository root');
    }
    const bytes = await readFile(mapPath);
    const map = readWdMap(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    expect(validateWdMap(map)).toEqual([]);
    expect(map.mask.format).toBe('RGBA8');
    expect(map.ground.format).toBe('RGBA8');
    expect(map.waterTint.format).toBe('RGBA8');
    const thresholdVerdict = thresholdFromWaterLevel(map.waterLevel);
    if (thresholdVerdict.ok !== true) throw new Error('water level gives no threshold');
    const threshold = thresholdVerdict.threshold;
    const asRaster = (raster: { width: number; height: number; data: Uint8Array }): RgbaRaster => ({
      width: raster.width,
      height: raster.height,
      data: raster.data,
    });
    const mask = asRaster(map.mask);
    const picked = parseWindow(process.env['GEORAMA_FIRSTLIGHT_WINDOW'], mask.width, mask.height) ??
      selectWindow(mask, threshold);
    const out = buildFirstLightLayers({
      mask,
      ground: asRaster(map.ground),
      tint: asRaster(map.waterTint),
      threshold,
      x0: picked.x0,
      y0: picked.y0,
      width: WINDOW_SIZE,
      height: WINDOW_SIZE,
    });
    await mkdir(resolvedOut, { recursive: true });
    await writeFile(path.join(resolvedOut, 'mask.rgba'), out.mask.data);
    await writeFile(path.join(resolvedOut, 'ground.rgba'), out.ground.data);
    await writeFile(path.join(resolvedOut, 'water.rgba'), out.water.data);
    await writeFile(
      path.join(resolvedOut, 'meta.json'),
      JSON.stringify(
        {
          width: WINDOW_SIZE,
          height: WINDOW_SIZE,
          threshold,
          x0: picked.x0,
          y0: picked.y0,
          mapWidth: mask.width,
          mapHeight: mask.height,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      `FIRSTLIGHT extract land=${out.stats.land} water=${out.stats.water} coastLand=${out.stats.coastLand} coastWater=${out.stats.coastWater}`,
    );
  }, 1_200_000);
});
