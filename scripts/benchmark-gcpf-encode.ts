/**
 * Synthetic-only GCPF encoder performance and allocation observations.
 * Compare two checkouts with the same Node version and machine:
 *   node --expose-gc scripts/benchmark-gcpf-encode.ts [other-checkout-root]
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), '..') : resolve(process.argv[2]);
const { encodeGcpf } = await import(pathToFileURL(join(root, 'src/core/formats/gcpf.ts')).href);
const NativeUint8Array = Uint8Array;

const zeros = new NativeUint8Array(8 * 1024 * 1024);
const random = new NativeUint8Array(zeros.length);
let state = 0x12345678;
for (let i = 0; i < random.length; i++) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  random[i] = state & 255;
}
const mixed = new NativeUint8Array(256 * 1024);
for (let i = 0; i < mixed.length; i++) mixed[i] = i % 4 === 0 ? random[i] : i % 16;

console.log(`GCPF encode | Node ${process.version} | ${process.platform}/${process.arch}`);
console.log('Synthetic inputs; encode only timed; 2 warmups, 7 samples; GC before each when available.');
for (const [name, input] of [['zeros-8MiB', zeros], ['random-8MiB', random], ['mixed-256KiB', mixed]] as const) {
  const first = encodeGcpf(input);
  const samples: number[] = [];
  for (let i = 0; i < 9; i++) {
    global.gc?.();
    const start = performance.now();
    const result = encodeGcpf(input);
    const ms = performance.now() - start;
    if (result.length !== first.length) throw new Error(`inconsistent output length: ${name}`);
    if (i >= 2) samples.push(ms);
  }
  samples.sort((a, b) => a - b);

  // This observes numeric Uint8Array allocations, not total-process peak RSS.
  const allocations: number[] = [];
  const ObservedUint8Array = new Proxy(NativeUint8Array, {
    construct(target, args) {
      if (typeof args[0] === 'number') allocations.push(args[0]);
      return Reflect.construct(target, args, target);
    },
  });
  globalThis.Uint8Array = ObservedUint8Array;
  try { encodeGcpf(input); }
  finally { globalThis.Uint8Array = NativeUint8Array; }

  const digest = createHash('sha256').update(first).digest('hex');
  console.log(`${name.padEnd(14)} encoded ${first.length} B | median ${samples[3].toFixed(3)} ms` +
    ` | largest explicit allocation ${Math.max(...allocations)} B` +
    ` | sum explicit allocations ${allocations.reduce((a, b) => a + b, 0)} B | sha256 ${digest}`);
}
console.log('Times depend on JIT, GC, CPU scaling and system load. Allocation counts exclude slice, Uint32Array and engine internals.');
