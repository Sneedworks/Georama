import { GdDict, GdMath } from './godot-var.ts';
import type { GdValue } from './godot-var.ts';

export type WdSchemaErrorCode = 'VERSION' | 'TYPE' | 'MISSING' | 'LIMIT' | 'FORMAT';

export class WdSchemaError extends Error {
  readonly code: WdSchemaErrorCode;
  readonly path: string;
  constructor(code: WdSchemaErrorCode, path: string, detail = '') {
    super(`${code} at ${path}: ${detail}`);
    this.name = 'WdSchemaError';
    this.code = code;
    this.path = path;
  }
}

// Frozen: any importer holding the module could otherwise raise a limit at run time.
export const WD_LIMITS = Object.freeze({
  maxSymbols: 2_000_000,
  maxLabels: 100_000,
  maxPaths: 100_000,
  maxTerritories: 100_000,
  maxBoxes: 64,
  maxListLength: 4_096,
  maxStringLength: 16_777_216,
  maxRasterSide: 65_536,
});

export function fail(code: WdSchemaErrorCode, path: string, detail: string): never {
  throw new WdSchemaError(code, path, detail);
}

export const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

export function requireDict(v: GdValue, path: string): GdDict {
  if (!(v instanceof GdDict)) fail('TYPE', path, 'expected Dictionary');
  return v;
}

export function readInt(v: GdValue, path: string): number {
  if (typeof v !== 'bigint') fail('TYPE', path, 'expected Int');
  if (v < -MAX_SAFE_BIG || v > MAX_SAFE_BIG) fail('LIMIT', path, 'Int outside safe range');
  return Number(v);
}

export function reqInt(m: unknown, path: string): number {
  if (typeof m !== 'number' || !Number.isSafeInteger(m)) fail('TYPE', path, 'expected safe integer');
  return m;
}

export function readReal(v: GdValue, path: string): number {
  if (typeof v !== 'number') fail('TYPE', path, 'expected Real');
  if (!Number.isFinite(v)) fail('FORMAT', path, 'non-finite Real');
  return v;
}

export function writeReal(m: unknown, path: string): number {
  if (typeof m !== 'number') fail('TYPE', path, 'expected Real');
  if (!Number.isFinite(m)) fail('FORMAT', path, 'non-finite Real');
  return m;
}

export function readBool(v: GdValue, path: string): boolean {
  if (typeof v !== 'boolean') fail('TYPE', path, 'expected bool');
  return v;
}

export function writeBool(m: unknown, path: string): boolean {
  if (typeof m !== 'boolean') fail('TYPE', path, 'expected bool');
  return m;
}

export function readString(v: GdValue, path: string): string {
  if (typeof v !== 'string') fail('TYPE', path, 'expected String');
  if (v.length > WD_LIMITS.maxStringLength) fail('LIMIT', path, 'String too long');
  return v;
}

export function writeString(m: unknown, path: string): string {
  if (typeof m !== 'string') fail('TYPE', path, 'expected String');
  if (m.length > WD_LIMITS.maxStringLength) fail('LIMIT', path, 'String too long');
  return m;
}

export interface Vec2Like {
  x: number;
  y: number;
}

export interface RgbaLike {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function readVec2(v: GdValue, path: string): Vec2Like {
  if (!(v instanceof GdMath) || v.kind !== 'Vector2' || v.v.length !== 2) {
    fail('TYPE', path, 'expected Vector2');
  }
  const x = v.v[0];
  const y = v.v[1];
  // Same rule as a Real: what cannot be written back is not read (writeVec2 rejects non-finite components).
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('FORMAT', path, 'non-finite Vector2');
  return { x, y };
}

export function writeVec2(m: unknown, path: string): GdMath {
  if (typeof m !== 'object' || m === null) fail('TYPE', path, 'expected Vec2');
  const rec = m as Record<string, unknown>;
  if (typeof rec['x'] !== 'number' || typeof rec['y'] !== 'number') fail('TYPE', path, 'expected Vec2 numbers');
  const x = rec['x'] as number;
  const y = rec['y'] as number;
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('FORMAT', path, 'non-finite Vec2');
  // Godot Vector2 components are stored as float32. Finite JS numbers can
  // overflow during narrowing and would otherwise serialize as Infinity.
  if (!Number.isFinite(Math.fround(x)) || !Number.isFinite(Math.fround(y))) {
    fail('FORMAT', path, 'Vec2 component outside float32 range');
  }
  return new GdMath('Vector2', new Float32Array([x, y]));
}

export function readColor(v: GdValue, path: string): RgbaLike {
  if (!(v instanceof GdMath) || v.kind !== 'Color' || v.v.length !== 4) {
    fail('TYPE', path, 'expected Color');
  }
  const r = v.v[0];
  const g = v.v[1];
  const b = v.v[2];
  const a = v.v[3];
  // Same rule as a Real: what cannot be written back is not read (writeColor rejects non-finite components).
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
    fail('FORMAT', path, 'non-finite Color');
  }
  return { r, g, b, a };
}

export function writeColor(m: unknown, path: string): GdMath {
  if (typeof m !== 'object' || m === null) fail('TYPE', path, 'expected Color');
  const rec = m as Record<string, unknown>;
  if (
    typeof rec['r'] !== 'number' || typeof rec['g'] !== 'number' ||
    typeof rec['b'] !== 'number' || typeof rec['a'] !== 'number'
  ) {
    fail('TYPE', path, 'expected Color numbers');
  }
  const r = rec['r'] as number;
  const g = rec['g'] as number;
  const b = rec['b'] as number;
  const a = rec['a'] as number;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) {
    fail('FORMAT', path, 'non-finite Color');
  }
  // Godot Color components are float32; reject finite values that become
  // non-finite on conversion so the writer's output remains readable.
  if (![r, g, b, a].every((component) => Number.isFinite(Math.fround(component)))) {
    fail('FORMAT', path, 'Color component outside float32 range');
  }
  return new GdMath('Color', new Float32Array([r, g, b, a]));
}

export function readPoolBytes(v: GdValue, path: string): Uint8Array {
  if (!(v instanceof Uint8Array)) fail('TYPE', path, 'expected PoolByteArray');
  return v;
}

export function writePoolBytes(m: unknown, path: string): Uint8Array {
  if (!(m instanceof Uint8Array)) fail('TYPE', path, 'expected PoolByteArray');
  return m;
}

export function readArray(v: GdValue, path: string, limit: number): GdValue[] {
  if (!Array.isArray(v)) fail('TYPE', path, 'expected Array');
  if (v.length > limit) fail('LIMIT', path, 'Array too long');
  return v;
}

export function writeRawArray(m: unknown, path: string, limit: number): GdValue {
  if (!Array.isArray(m)) fail('TYPE', path, 'expected Array');
  if (m.length > limit) fail('LIMIT', path, 'Array too long');
  return m as GdValue[];
}

export function readStringList(v: GdValue, path: string): string[] {
  const a = readArray(v, path, WD_LIMITS.maxListLength);
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) out.push(readString(a[i], `${path}[${i}]`));
  return out;
}

export function writeStringList(m: unknown, path: string): GdValue[] {
  if (!Array.isArray(m)) fail('TYPE', path, 'expected Array');
  if (m.length > WD_LIMITS.maxListLength) fail('LIMIT', path, 'Array too long');
  const out: GdValue[] = [];
  for (let i = 0; i < m.length; i++) out.push(writeString(m[i], `${path}[${i}]`));
  return out;
}

export function readBoolList(v: GdValue, path: string): boolean[] {
  const a = readArray(v, path, WD_LIMITS.maxListLength);
  const out: boolean[] = [];
  for (let i = 0; i < a.length; i++) out.push(readBool(a[i], `${path}[${i}]`));
  return out;
}

export function writeBoolList(m: unknown, path: string): GdValue[] {
  if (!Array.isArray(m)) fail('TYPE', path, 'expected Array');
  if (m.length > WD_LIMITS.maxListLength) fail('LIMIT', path, 'Array too long');
  const out: GdValue[] = [];
  for (let i = 0; i < m.length; i++) out.push(writeBool(m[i], `${path}[${i}]`));
  return out;
}

export function readColorList(v: GdValue, path: string): RgbaLike[] {
  const a = readArray(v, path, WD_LIMITS.maxListLength);
  const out: RgbaLike[] = [];
  for (let i = 0; i < a.length; i++) out.push(readColor(a[i], `${path}[${i}]`));
  return out;
}

export function writeColorList(m: unknown, path: string): GdValue[] {
  if (!Array.isArray(m)) fail('TYPE', path, 'expected Array');
  if (m.length > WD_LIMITS.maxListLength) fail('LIMIT', path, 'Array too long');
  const out: GdValue[] = [];
  for (let i = 0; i < m.length; i++) out.push(writeColor(m[i], `${path}[${i}]`));
  return out;
}

export type ReadFn = (v: GdValue, path: string) => unknown;
export type WriteFn = (m: unknown, path: string) => GdValue;

export interface FieldDef {
  key: string;
  prop: string;
  read: ReadFn;
  write: WriteFn;
}

export function camel(key: string): string {
  let out = '';
  let upper = false;
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === '_') {
      upper = true;
      continue;
    }
    out += upper ? ch.toUpperCase() : ch;
    upper = false;
  }
  return out;
}

export function f(key: string, read: ReadFn, write: WriteFn): FieldDef {
  return { key, prop: camel(key), read, write };
}

export function join(path: string, key: string): string {
  return path === '/' ? `/${key}` : `${path}/${key}`;
}

export function readRecord(dict: GdDict, table: FieldDef[], path: string): Record<string, unknown> {
  const byKey = new Map<string, FieldDef>();
  for (const def of table) byKey.set(def.key, def);
  const seen = new Set<string>();
  const values: Record<string, unknown> = {};
  const order: string[] = [];
  const extra: Array<[GdValue, GdValue]> = [];
  const layout: Array<string | number> = [];
  for (const [k, v] of dict.entries) {
    const def = typeof k === 'string' ? byKey.get(k) : undefined;
    if (def !== undefined) {
      if (seen.has(def.key)) fail('FORMAT', join(path, def.key), 'duplicate key');
      seen.add(def.key);
      values[def.prop] = def.read(v, join(path, def.key));
      order.push(def.key);
      layout.push(def.key);
    } else {
      extra.push([k, v]);
      layout.push(extra.length - 1);
    }
  }
  for (const def of table) {
    if (!seen.has(def.key)) fail('MISSING', join(path, def.key), 'missing key');
  }
  let canonical = extra.length === 0 && order.length === table.length;
  if (canonical) {
    for (let i = 0; i < table.length; i++) {
      if (order[i] !== table[i].key) {
        canonical = false;
        break;
      }
    }
  }
  if (!canonical) {
    values['layout'] = layout;
    values['extra'] = extra;
  }
  if (dict.shared) values['shared'] = true;
  return values;
}

export function writeRecord(model: unknown, table: FieldDef[], path: string): GdDict {
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    fail('TYPE', path, 'expected record');
  }
  const m = model as Record<string, unknown>;
  const byKey = new Map<string, FieldDef>();
  for (const def of table) byKey.set(def.key, def);
  const entries: Array<[GdValue, GdValue]> = [];
  const rawLayout = m['layout'] as Array<string | number> | undefined;
  const rawExtra = m['extra'] as Array<[GdValue, GdValue]> | undefined;
  if (rawExtra !== undefined && !Array.isArray(rawExtra)) fail('FORMAT', path, 'bad extra');
  const extra = rawExtra ?? [];
  // The writer must only produce dictionaries the reader accepts and the codec can encode: every extra entry is a
  // [key, value] pair, and no extra string key may shadow a known field (the reader would reject a duplicate).
  for (let i = 0; i < extra.length; i++) {
    const pair = extra[i];
    if (!Array.isArray(pair) || pair.length !== 2) fail('FORMAT', path, `bad extra entry ${i}`);
    if (typeof pair[0] === 'string' && byKey.has(pair[0])) {
      fail('FORMAT', path, `extra entry ${i} shadows the known key ${pair[0]}`);
    }
  }
  if (rawLayout === undefined) {
    for (const def of table) entries.push([def.key, def.write(m[def.prop], join(path, def.key))]);
    for (const pair of extra) entries.push(pair);
  } else {
    if (!Array.isArray(rawLayout)) fail('FORMAT', path, 'bad layout');
    const layout = rawLayout;
    if (layout.length !== table.length + extra.length) fail('FORMAT', path, 'bad layout length');
    const seenKeys = new Set<string>();
    const usedExtra = new Array<boolean>(extra.length).fill(false);
    for (const item of layout) {
      if (typeof item === 'string') {
        const def = byKey.get(item);
        if (def === undefined || seenKeys.has(item)) fail('FORMAT', path, 'bad layout key');
        seenKeys.add(item);
        entries.push([item, def.write(m[def.prop], join(path, item))]);
      } else if (typeof item === 'number') {
        if (!Number.isInteger(item) || item < 0 || item >= extra.length || usedExtra[item]) {
          fail('FORMAT', path, 'bad layout index');
        }
        usedExtra[item] = true;
        entries.push(extra[item]);
      } else {
        fail('FORMAT', path, 'bad layout item');
      }
    }
  }
  return new GdDict(entries, m['shared'] === true);
}

export function readRecordList<T>(v: GdValue, path: string, table: FieldDef[], limit: number): T[] {
  const a = readArray(v, path, limit);
  const out: T[] = [];
  for (let i = 0; i < a.length; i++) {
    const ep = `${path}[${i}]`;
    out.push(readRecord(requireDict(a[i], ep), table, ep) as unknown as T);
  }
  return out;
}

export function writeRecordList(m: unknown, path: string, table: FieldDef[], limit: number): GdValue[] {
  if (!Array.isArray(m)) fail('TYPE', path, 'expected Array');
  if (m.length > limit) fail('LIMIT', path, 'Array too long');
  const out: GdValue[] = [];
  for (let i = 0; i < m.length; i++) out.push(writeRecord(m[i], table, `${path}[${i}]`));
  return out;
}

export function readVersion(v: GdValue, path: string): number {
  if (typeof v !== 'bigint') fail('TYPE', path, 'expected Int version');
  if (v !== 15n) fail('VERSION', path, 'unsupported version');
  return 15;
}

export function writeVersion(m: unknown, path: string): GdValue {
  if (m !== 15) fail('VERSION', path, 'unsupported version');
  return 15n;
}
