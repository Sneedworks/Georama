// Corpus gate: proves writeWdMap(readWdMap(f)) is byte-identical to f for every
// unique map in <list.txt>, and measures validation, points fidelity and timings.
// Usage: node scripts/wd-check.ts <list.txt>
// One map at a time: references drop out of scope before the next file is read.
// Output holds counts, offsets and key paths only, never map content.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { decodeGcpf } from '../src/core/formats/gcpf.ts';
import { decodeStoreVar } from '../src/core/formats/godot-var.ts';
import { wdMapFromGd, wdMapToGd } from '../src/core/formats/wonderdraft-map.ts';
import type { WdMap } from '../src/core/formats/wonderdraft-map.ts';
import { formatPoints, parsePoints } from '../src/core/formats/wonderdraft-points.ts';
import { readWdMap, validateWdMap, writeWdMap } from '../src/core/formats/wonderdraft-map-file.ts';

interface PerFile {
  name: string;
  bytes: number;
  readMs: number;
  validateMs: number;
  issues: number;
  issueLines: string[];
  writeMs: number;
  diff: number;
  symbols: number;
  labels: number;
  paths: number;
  territories: number;
  fromMs: number;
  toMs: number;
  pointsTexts: number;
  pointsIdentical: number;
}

function ms(t: number): string {
  return t.toFixed(1);
}

function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// Codec time excluded: decode the container and the Variant here, time only the model.
function timeModel(file: Uint8Array): { fromMs: number; toMs: number } {
  const decoded = decodeGcpf(file);
  const root = decodeStoreVar(decoded.payload);
  const t0 = performance.now();
  const map = wdMapFromGd(root);
  const fromMs = performance.now() - t0;
  const t1 = performance.now();
  wdMapToGd(map);
  return { fromMs, toMs: performance.now() - t1 };
}

function pointsFidelity(map: WdMap): { texts: number; identical: number } {
  let texts = 0;
  let identical = 0;
  const take = (text: unknown): void => {
    if (typeof text !== 'string') return;
    texts++;
    try {
      if (formatPoints(parsePoints(text)) === text) identical++;
    } catch {
      // Unparseable or unformattable text counts as not identical.
    }
  };
  for (const p of map.paths) take(p.points);
  for (const t of map.territories.territories) take(t.points);
  return { texts, identical };
}

function checkOne(path: string, file: Uint8Array): PerFile {
  const name = basename(path);
  const tR = performance.now();
  const map = readWdMap(file);
  const readMs = performance.now() - tR;
  const tV = performance.now();
  const found = validateWdMap(map);
  const validateMs = performance.now() - tV;
  const model = timeModel(file);
  const tW = performance.now();
  const out = writeWdMap(map);
  const writeMs = performance.now() - tW;
  const diff = firstDiff(out, file);
  const points = pointsFidelity(map);
  return {
    name,
    bytes: file.length,
    readMs,
    validateMs,
    issues: found.length,
    issueLines: found.map((issue) => `${name} ${issue.path} ${issue.message}`),
    writeMs,
    diff,
    symbols: map.symbols.length,
    labels: map.labels.length,
    paths: map.paths.length,
    territories: map.territories.territories.length,
    fromMs: model.fromMs,
    toMs: model.toMs,
    pointsTexts: points.texts,
    pointsIdentical: points.identical,
  };
}

const listPath = process.argv[2];
if (!listPath) {
  console.error('usage: node scripts/wd-check.ts <list.txt>');
  process.exit(2);
}

const lines = readFileSync(listPath, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
const seen = new Set<string>();
const unique: string[] = [];
for (const p of lines) {
  const size = statSync(p).size;
  const key = `${basename(p)}:${size}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(p);
  }
}

let identical = 0;
let issueTotal = 0;
let pointsTexts = 0;
let pointsIdentical = 0;
let peakRss = 0;
const issueLines: string[] = [];
let maxSymbols: PerFile | undefined;
let maxBytes: PerFile | undefined;

for (const p of unique) {
  const raw = readFileSync(p);
  const file: Uint8Array = raw;
  const r = checkOne(p, file);
  if (r.diff < 0) identical++;
  issueTotal += r.issues;
  for (const line of r.issueLines) {
    if (issueLines.length < 40) issueLines.push(line);
  }
  pointsTexts += r.pointsTexts;
  pointsIdentical += r.pointsIdentical;
  if (!maxSymbols || r.symbols > maxSymbols.symbols) maxSymbols = r;
  if (!maxBytes || r.bytes > maxBytes.bytes) maxBytes = r;
  const verdict = r.diff < 0 ? 'IDENTICAL' : `DIFF@${r.diff}`;
  console.log(
    `${r.name} ${r.bytes} ${ms(r.readMs)} ${ms(r.validateMs)} ${r.issues} ${ms(r.writeMs)}` +
    ` ${verdict} symbols=${r.symbols} labels=${r.labels} paths=${r.paths} territories=${r.territories}`,
  );
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}

console.log(`WDCHECK maps=${unique.length} identical=${identical} issues=${issueTotal}`);
for (const line of issueLines) console.log(`ISSUE ${line}`);
console.log(`POINTS texts=${pointsTexts} identical=${pointsIdentical}`);
if (maxSymbols) {
  console.log(
    `R4 max-symbols ${maxSymbols.name}: symbols=${maxSymbols.symbols}` +
    ` fromGd=${ms(maxSymbols.fromMs)} toGd=${ms(maxSymbols.toMs)}` +
    ` read=${ms(maxSymbols.readMs)} write=${ms(maxSymbols.writeMs)}`,
  );
}
if (maxBytes) {
  console.log(
    `R4 max-bytes ${maxBytes.name}: bytes=${maxBytes.bytes}` +
    ` fromGd=${ms(maxBytes.fromMs)} toGd=${ms(maxBytes.toMs)}` +
    ` read=${ms(maxBytes.readMs)} write=${ms(maxBytes.writeMs)}`,
  );
}
console.log(`RSS peak=${Math.round(peakRss / 1048576)} MB`);
if (identical !== unique.length) process.exit(1);
