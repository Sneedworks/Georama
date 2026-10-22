import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { GdDict, GdObject, decodeStoreVar, decodeVariant, encodeStoreVar, variantSize } from '../src/core/formats/godot-var.ts';
import type { GdValue } from '../src/core/formats/godot-var.ts';

interface ContainerReader { readGcpf(path: string): { data: Uint8Array } }
interface SpikeReader { decodeVar(data: Uint8Array, start: number): { end: number } }
const asBuffer = (a: Uint8Array): Buffer => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const escaped = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

/** Diagnostics run only on a mismatch, never on the timed codec path. */
export function difference(input: Uint8Array, output: Uint8Array, tree: GdValue): string | undefined {
  if (asBuffer(input).equals(asBuffer(output))) return undefined;
  let at = 0;
  while (at < Math.min(input.length, output.length) && input[at] === output[at]) at++;
  function locate(value: GdValue, start: number, path: string): string {
    let cursor = start;
    const children: Array<[GdValue, string, number]> = [];
    if (value instanceof GdDict) {
      cursor += 8;
      for (let i = 0; i < value.entries.length; i++) {
        const [key, child] = value.entries[i];
        children.push([key, `${path}/@key[${i}]`, cursor]); cursor += variantSize(key);
        children.push([child, typeof key === 'string' ? `${path}/${escaped(key)}` : `${path}/@value[${i}]`, cursor]); cursor += variantSize(child);
        if (cursor > at) break;
      }
    } else if (Array.isArray(value)) {
      cursor += 8;
      for (let i = 0; i < value.length; i++) {
        children.push([value[i], `${path}[${i}]`, cursor]); cursor += variantSize(value[i]);
        if (cursor > at) break;
      }
    } else if (value instanceof GdObject && value.cls !== '') {
      cursor += 4 + variantSize(value.cls); // header + class string (without its Variant header) + count
      for (const [name, child] of value.props) {
        cursor += variantSize(name) - 4;
        children.push([child, `${path}/${escaped(name)}`, cursor]); cursor += variantSize(child);
        if (cursor > at) break;
      }
    }
    for (const [child, childPath, offset] of children) {
      if (at >= offset && at < offset + variantSize(child)) return locate(child, offset, childPath);
    }
    return path || '/';
  }
  const path = at < 4 ? '/' : locate(tree, 4, '');
  const from = Math.max(0, at - 16); const to = at + 17;
  return `DIFF@${at} ${path} input[${from}:${to}]=${asBuffer(input.subarray(from, to)).toString('hex')} output[${from}:${to}]=${asBuffer(output.subarray(from, to)).toString('hex')}`;
}

function nodeCount(tree: GdValue): number {
  let count = 0;
  const stack = [tree];
  while (stack.length) {
    const value = stack.pop(); count++;
    if (value instanceof GdDict) for (const [key, child] of value.entries) stack.push(key, child);
    else if (value instanceof GdObject) for (const [, child] of value.props) stack.push(child);
    else if (Array.isArray(value)) for (const child of value) stack.push(child);
  }
  return count;
}
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[1];
async function main(): Promise<void> {
  const list = process.argv[2];
  if (!list) throw new Error('usage: node scripts/var-check.ts <list.txt>');
  const { readGcpf } = await import(new URL('../spike/gcpf.mjs', import.meta.url).href) as ContainerReader;
  const { decodeVar } = await import(new URL('../spike/godot-var.mjs', import.meta.url).href) as SpikeReader;
  // Explicit full collection between maps: never retain the preceding map/tree/output.
  setFlagsFromString('--expose-gc');
  const collect = runInNewContext('gc') as () => void;
  const unique = new Map<string, string>();
  const lines = readFileSync(list, 'utf8').split(/\r?\n/).filter((line) => line.length > 0);
  for (const path of lines) unique.set(`${basename(path)}\0${statSync(path).size}`, path);
  let totalNodes = 0; let totalBytes = 0; let largest = ''; let largestBytes = -1;
  let largestEncode = 0; let largestDecode = 0; let identical = 0;
  let largestFile = ''; let largestFileBytes = -1; let largestFileEncode = 0; let largestFileDecode = 0;
  function checkOne(path: string): void {
    const payload = readGcpf(path).data;
    const start = performance.now(); const tree = decodeStoreVar(payload); const decoded = performance.now() - start;
    const encodeStart = performance.now(); const output = encodeStoreVar(tree); const encoded = performance.now() - encodeStart;
    const diff = difference(payload, output, tree);
    const nodes = nodeCount(tree); totalNodes += nodes; totalBytes += payload.length;
    console.log(`${JSON.stringify(path)} payload=${payload.length} nodes=${nodes} decode_ms=${decoded.toFixed(3)} encode_ms=${encoded.toFixed(3)} ${diff ?? 'IDENTICAL'}`);
    if (diff) throw new Error(diff);
    identical++;
    if (payload.length > largestBytes) { largest = path; largestBytes = payload.length; largestDecode = decoded; largestEncode = encoded; }
    const fileBytes = statSync(path).size;
    if (fileBytes > largestFileBytes) { largestFile = path; largestFileBytes = fileBytes; largestFileDecode = decoded; largestFileEncode = encoded; }
  }
  for (const path of unique.values()) { collect(); checkOne(path); }
  collect();
  if (!largest) throw new Error('empty map list');
  function benchmark(path: string, label: string, decoded: number, encoded: number): void {
    const payload = readGcpf(path).data;
    function timed(fn: () => { end: number }): number {
      collect(); const start = performance.now(); const result = fn(); const ms = performance.now() - start;
      if (result.end !== payload.length) throw new Error(`benchmark parse ended at ${result.end}, expected ${payload.length}`);
      return ms;
    }
    // Both readers start at 4 (the store_var length word is not a Variant).
    timed(() => decodeVariant(payload, 4)); timed(() => decodeVar(payload, 4));
    const ours: number[] = []; const spike: number[] = [];
    for (let i = 0; i < 3; i++) {
      ours.push(timed(() => decodeVariant(payload, 4))); spike.push(timed(() => decodeVar(payload, 4)));
    }
    const ratio = median(ours) / median(spike);
    console.log(`LARGEST_${label} ${JSON.stringify(path)} file_bytes=${statSync(path).size} payload=${payload.length} decode_ms=${decoded.toFixed(3)} encode_ms=${encoded.toFixed(3)}`);
    console.log(`BENCH_${label} warmup=1 runs=3 start=4 codec_ms=[${ours.map((n) => n.toFixed(3))}] spike_ms=[${spike.map((n) => n.toFixed(3))}] codec_median_ms=${median(ours).toFixed(3)} spike_median_ms=${median(spike).toFixed(3)} ratio=${ratio.toFixed(3)}`);
    if (ratio > 3 || encoded > 1500) throw new Error(`performance limits exceeded: decode ratio=${ratio}, encode_ms=${encoded}`);
  }
  // Measure both meanings of largest, without retaining two payloads at once.
  benchmark(largest, 'PAYLOAD', largestDecode, largestEncode); collect();
  if (largestFile !== largest) { benchmark(largestFile, 'FILE', largestFileDecode, largestFileEncode); collect(); }
  console.log(`TOTAL listed=${lines.length} unique=${unique.size} identical=${identical} bytes=${totalBytes} nodes=${totalNodes} peak_RSS_MiB=${(process.resourceUsage().maxRSS / 1024).toFixed(1)}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
}
