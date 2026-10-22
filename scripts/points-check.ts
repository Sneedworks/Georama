import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { decodeGcpf } from '../src/core/formats/gcpf.ts';
import { GdDict, decodeStoreVar } from '../src/core/formats/godot-var.ts';
import type { GdValue } from '../src/core/formats/godot-var.ts';
import { formatPoints, parsePoints } from '../src/core/formats/wonderdraft-points.ts';
import { WdPointsError } from '../src/core/formats/wonderdraft-points.ts';

/** Collect every points string without retaining the tree. */
function collectPoints(tree: GdValue): { texts: string[]; nonString: number } {
  const texts: string[] = [];
  let nonString = 0;
  const take = (holder: GdValue): void => {
    if (holder instanceof GdDict) {
      const points = holder.get('points');
      if (typeof points === 'string') texts.push(points);
      else if (points !== undefined) nonString++;
    }
  };
  if (tree instanceof GdDict) {
    const paths = tree.get('paths');
    if (Array.isArray(paths)) for (const entry of paths) take(entry);
    const territories = tree.get('territories');
    if (territories instanceof GdDict) {
      const list = territories.get('territories');
      if (Array.isArray(list)) for (const entry of list) take(entry);
    }
  }
  return { texts, nonString };
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let at = 0;
  while (at < n && a.charCodeAt(at) === b.charCodeAt(at)) at++;
  return at;
}

function window(text: string, at: number, radius = 60): string {
  return JSON.stringify(text.slice(Math.max(0, at - radius), at + radius));
}

interface Mismatch {
  file: string;
  kind: string;
  offset: number;
  original: string;
  reformatted: string;
}

const list = process.argv[2];
if (!list) throw new Error('usage: node scripts/points-check.ts <list.txt>');
const lines = readFileSync(list, 'utf8').split(/\r?\n/).filter((line) => line.length > 0);
const unique = new Map<string, string>();
for (const path of lines) unique.set(`${basename(path)}\0${statSync(path).size}`, path);
if (unique.size === 0) throw new Error('empty map list');
console.log(`CORPUS listed=${lines.length} unique=${unique.size} dedupe=basename+size`);

let totalTexts = 0;
let totalParsed = 0;
let totalIdentical = 0;
let totalNonString = 0;
let parseMs = 0;
let formatMs = 0;
let mapErrors = 0;
const mismatches: Mismatch[] = [];

for (const path of unique.values()) {
  const name = basename(path);
  try {
    // One map at a time: file, payload, tree and texts all die in this block.
    const file = readFileSync(path);
    const payload = decodeGcpf(file).payload;
    const { texts, nonString } = collectPoints(decodeStoreVar(payload));
    totalNonString += nonString;
    let identical = 0;
    for (const original of texts) {
      let values: Float32Array | undefined;
      const p0 = performance.now();
      try {
        values = parsePoints(original);
      } catch (e) {
        parseMs += performance.now() - p0;
        if (mismatches.length < 5) {
          const offset = e instanceof WdPointsError ? e.offset : -1;
          mismatches.push({ file: name, kind: 'parse-throw', offset, original, reformatted: '' });
        }
        continue;
      }
      parseMs += performance.now() - p0;
      totalParsed++;
      const f0 = performance.now();
      let reformatted = '';
      try {
        reformatted = formatPoints(values);
      } catch {
        formatMs += performance.now() - f0;
        if (mismatches.length < 5) {
          mismatches.push({ file: name, kind: 'format-throw', offset: -1, original, reformatted: '' });
        }
        continue;
      }
      formatMs += performance.now() - f0;
      if (reformatted === original) {
        identical++;
      } else if (mismatches.length < 5) {
        mismatches.push({ file: name, kind: 'differ', offset: firstDiff(original, reformatted), original, reformatted });
      }
    }
    totalTexts += texts.length;
    totalIdentical += identical;
    console.log(`${name} texts=${texts.length} identical=${identical}`);
  } catch (error) {
    mapErrors++;
    console.error(`ERROR ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`POINTS texts=${totalTexts} parsed=${totalParsed} identical=${totalIdentical} mismatched=${totalTexts - totalIdentical}`);
for (let m = 0; m < mismatches.length; m++) {
  const item = mismatches[m];
  if (item.kind === 'differ') {
    console.log(
      `MISMATCH[${m}] ${item.kind} file=${item.file} firstDiff=${item.offset} original=${window(item.original, item.offset)} reformatted=${window(item.reformatted, item.offset)}`,
    );
  } else {
    console.log(`MISMATCH[${m}] ${item.kind} file=${item.file} offset=${item.offset} original=${window(item.original, Math.max(0, item.offset))}`);
  }
}
if (totalNonString > 0) console.log(`NONSTRING points=${totalNonString}`);
console.log(`TIME parse_ms=${parseMs.toFixed(1)} format_ms=${formatMs.toFixed(1)}`);
console.log(`PEAK-RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(1)}MiB`);
if (mapErrors > 0) process.exitCode = 1;
