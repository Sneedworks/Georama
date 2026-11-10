/**
 * Synthetic tile-write microbenchmark: compares an implementation against itself or a checkout
 * of an earlier revision. No user maps or assets are read.
 *
 * Usage: node --expose-gc scripts/benchmark-tile-write.ts [other-checkout-root]
 * Run both revisions on the same machine and Node 22; the results are observational, not a gate.
 */
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CellWrite } from '../src/core/edit/tile-command.ts';

const root = process.argv[2] === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), '..') : resolve(process.argv[2]);
const editModule = join(root, 'src/core/edit');
const { TileGrid } = await import(pathToFileURL(join(editModule, 'tiles.ts')).href);
const { buildTileWrite } = await import(pathToFileURL(join(editModule, 'tile-command.ts')).href);
const maxBytes = 1024 * 1024 * 1024;

function write(x: number, y: number, value: number): CellWrite {
  return { x, y, channels: 4, value: new Uint8Array([value, value, value, value]) };
}

type Workload = { name: string; grid: InstanceType<typeof TileGrid>; writes: CellWrite[]; expectOk: boolean };
const workloads: Workload[] = [];

for (const value of [0, 1]) {
  const grid = new TileGrid(4096, 4096, 4);
  const writes = Array.from({ length: 1024 }, (_, i) =>
    write((i % 32) * 128, Math.floor(i / 32) * 128, value));
  workloads.push({ name: value === 0 ? 'sparse zero no-op' : 'sparse changed', grid, writes, expectOk: value !== 0 });
}

for (const value of [0, 1]) {
  const grid = new TileGrid(128, 128, 4);
  const seed = buildTileWrite(grid, [write(0, 0, 2)], maxBytes);
  if (!seed.ok) throw new Error('failed to seed dense fixture');
  seed.value.apply();
  const writes = Array.from({ length: 128 * 128 }, (_, i) =>
    write(i % 128, Math.floor(i / 128), i === 0 ? 2 : value));
  workloads.push({ name: value === 0 ? 'dense no-op' : 'dense changed', grid, writes, expectOk: value !== 0 });
}

console.log(`Tile write benchmarks | Node ${process.version} | ${process.platform}/${process.arch}`);
console.log('Each fixture is synthetic; only buildTileWrite is timed; 2 warmups, 7 samples.');
console.log(global.gc === undefined ? 'GC uncontrolled' : 'GC forced before each iteration, outside timing');
for (const workload of workloads) {
  const samples: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    global.gc?.();
    const start = performance.now();
    const result = buildTileWrite(workload.grid, workload.writes, maxBytes);
    const ms = performance.now() - start;
    if (result.ok !== workload.expectOk || (!result.ok && result.code !== 'noop')) {
      throw new Error(`unexpected verdict for ${workload.name}`);
    }
    if (i >= 2) samples.push(ms);
  }
  samples.sort((a, b) => a - b);
  console.log(`${workload.name.padEnd(22)} median ${samples[3].toFixed(3)} ms` +
    ` [${samples[0].toFixed(3)}, ${samples[6].toFixed(3)}]`);
}
console.log('JIT, CPU scaling, and system activity are not controlled. No speed threshold is asserted.');
