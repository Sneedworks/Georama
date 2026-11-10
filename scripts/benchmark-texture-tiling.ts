/**
 * Synthetic-only CPU texture tiling microbenchmark. Compare checkouts on one machine/Node version:
 *   node --expose-gc scripts/benchmark-texture-tiling.ts [other-checkout-root]
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), '..') : resolve(process.argv[2]);
const { tileRgba8 } = await import(pathToFileURL(join(root, 'src/core/texture/tiling.ts')).href);

const tw = 128;
const th = 64;
const texture = new Uint8Array(tw * th * 4);
let state = 0x2b7e1516;
for (let i = 0; i < texture.length; i++) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  texture[i] = state & 255;
}
const params = { k: 5, ox: 65535, oy: 65123 };
const cases = [
  { name: 'large 2048x2048', width: 2048, height: 2048 },
  { name: 'tall 512x4096', width: 512, height: 4096 },
  { name: 'small 32x32', width: 32, height: 32 },
  { name: 'one row 4096x1', width: 4096, height: 1 },
];

console.log(`Tiling benchmark | Node ${process.version} | ${process.platform}/${process.arch}`);
console.log('Seeded RGBA texture; tiling only timed; 2 warmups, 7 samples; GC before each when available.');
for (const item of cases) {
  const first = tileRgba8(texture, tw, th, item.width, item.height, params);
  const samples: number[] = [];
  for (let i = 0; i < 9; i++) {
    global.gc?.();
    const start = performance.now();
    const output = tileRgba8(texture, tw, th, item.width, item.height, params);
    const elapsed = performance.now() - start;
    if (output.length !== first.length) throw new Error(`unexpected output size for ${item.name}`);
    if (i >= 2) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  const hash = createHash('sha256').update(first).digest('hex');
  console.log(`${item.name.padEnd(19)} median ${samples[3].toFixed(3)} ms` +
    ` [${samples[0].toFixed(3)}, ${samples[6].toFixed(3)}] | bytes ${first.length} | sha256 ${hash}`);
}
console.log('Observational timing only; CPU scaling, JIT and system activity remain uncontrolled.');
