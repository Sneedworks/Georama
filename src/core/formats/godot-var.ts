/** Godot 3 binary Variants. Layout: Godot's MIT core/io/marshalls.cpp.
 * Writer widths follow the measured map contract, not Godot's int32 shortcut.
 * PoolByteArray values borrow the input: keep it alive and do not mutate it. Every other array value (int and
 * real pools, vector and colour pools, math types) is a copy at every input alignment, so writing to it never
 * writes to the input.
 * Ints decode from either width but always encode as i64. Reals decode from
 * either width but encode as f32 iff Math.fround(v) === v (NaN uses f64). Bool decodes from any non-zero u32
 * (as Godot does) and always encodes as 1.
 * Thus noncanonical integer/real widths and bool words intentionally do not round-trip.
 * Offsets are relative to the supplied view, not its backing ArrayBuffer.
 */
export type MathKind = 'Vector2' | 'Rect2' | 'Vector3' | 'Transform2D' | 'Plane' | 'Quat' | 'AABB' | 'Basis' | 'Transform' | 'Color';
export type PoolKind = 'PoolStringArray' | 'PoolVector2Array' | 'PoolVector3Array' | 'PoolColorArray';
export class GdMath {
  kind: MathKind;
  v: Float32Array;
  constructor(kind: MathKind, v: Float32Array) { this.kind = kind; this.v = v; }
}
export class GdNodePath {
  names: string[];
  subnames: string[];
  flags: number;
  constructor(names: string[], subnames: string[], flags = 0) { this.names = names; this.subnames = subnames; this.flags = flags; }
}
export class GdObject {
  cls: string;
  props: Array<[string, GdValue]>;
  constructor(cls: string, props: Array<[string, GdValue]>) { this.cls = cls; this.props = props; }
}
export class GdDict {
  entries: Array<[GdValue, GdValue]>;
  shared: boolean;
  #index?: Map<string, [GdValue, GdValue]>;
  #indexedEntries?: Array<[GdValue, GdValue]>;
  #indexedLength = 0;
  constructor(entries: Array<[GdValue, GdValue]>, shared = false) { this.entries = entries; this.shared = shared; }
  /** First matching string key wins. Treat indexed keys as immutable. */
  private lookup(key: string): [GdValue, GdValue] | undefined {
    if (this.entries.length < 32) return this.entries.find((pair) => pair[0] === key);
    if (!this.#index || this.#indexedEntries !== this.entries || this.#indexedLength !== this.entries.length) {
      this.#index = new Map();
      for (const pair of this.entries) if (typeof pair[0] === 'string' && !this.#index.has(pair[0])) this.#index.set(pair[0], pair);
      this.#indexedEntries = this.entries;
      this.#indexedLength = this.entries.length;
    }
    return this.#index.get(key);
  }
  get(key: string): GdValue | undefined { return this.lookup(key)?.[1]; }
  has(key: string): boolean { return this.lookup(key) !== undefined; }
}
export class GdPool {
  kind: PoolKind;
  data: string[] | Float32Array;
  constructor(kind: PoolKind, data: string[] | Float32Array) { this.kind = kind; this.data = data; }
}
export type GdValue = null | boolean | bigint | number | string | GdMath | GdNodePath | GdObject | GdDict | GdPool | GdValue[] | Uint8Array | Int32Array | Float32Array;
export type GodotVarErrorCode = 'TRUNCATED' | 'BAD_TYPE' | 'UNSUPPORTED' | 'DEPTH' | 'LIMIT' | 'LENGTH' | 'TRAILING' | 'ENCODING';
export class GodotVarError extends Error {
  readonly code: GodotVarErrorCode;
  readonly offset: number;
  readonly path: string;
  constructor(code: GodotVarErrorCode, offset: number, path = '/', detail = '') {
    super(`${code} at ${offset} ${path}${detail ? ': ' + detail : ''}`);
    this.name = 'GodotVarError'; this.code = code; this.offset = offset; this.path = path;
  }
}
export interface DecodeOptions { maxDepth?: number; maxNodes?: number }
const mathKinds: MathKind[] = ['Vector2', 'Rect2', 'Vector3', 'Transform2D', 'Plane', 'Quat', 'AABB', 'Basis', 'Transform', 'Color'];
const mathLengths = [2, 4, 3, 6, 4, 4, 6, 9, 12, 4];
const poolKinds: PoolKind[] = ['PoolStringArray', 'PoolVector2Array', 'PoolVector3Array', 'PoolColorArray'];
const poolWidths = [0, 2, 3, 4];
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const textEncoder = new TextEncoder();
const pad = (n: number): number => (4 - (n % 4)) % 4;
const internMaxLength = 32;
const internMaxEntries = 4096;
interface Marker { label: 'key' | 'value' | 'property'; index: number }
type Segment = string | number | Marker;
function pathOf(segments: Segment[]): string {
  let s = '';
  for (const part of segments) {
    if (typeof part === 'number') s += `[${part}]`;
    else if (typeof part === 'string') s += '/' + part.replace(/~/g, '~0').replace(/\//g, '~1');
    else s += `/@${part.label}[${part.index}]`;
  }
  return s.startsWith('/') ? s : '/' + s;
}
interface ReadFrame {
  type: number;
  value: GdValue[] | GdDict | GdObject;
  n: number;
  i: number;
  key: GdValue;
  phase: boolean;
  marker: Marker;
}
class Reader {
  buf: Uint8Array;
  dv: DataView;
  p: number;
  segments: Segment[] = [];
  frames: ReadFrame[] = [];
  nodes = 0;
  // Per-input, bounded interning: dictionary keys repeat hundreds of thousands of times (<redacted> keys, <redacted> distinct in
  // the largest corpus map), so a hit saves an allocation that would live as long as the decoded tree.
  cache = new Map<number, { start: number; length: number; value: string }>();
  maxDepth: number;
  maxNodes: number;
  constructor(buf: Uint8Array, offset: number, opts: DecodeOptions) {
    this.buf = buf; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); this.p = offset;
    this.maxDepth = opts.maxDepth ?? 64; this.maxNodes = opts.maxNodes ?? 50_000_000;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > buf.length) this.fail('LENGTH', 0, 'invalid offset');
    if (!Number.isSafeInteger(this.maxDepth) || this.maxDepth < 0 || !Number.isSafeInteger(this.maxNodes) || this.maxNodes < 1) this.fail('LIMIT', offset, 'invalid budget');
  }
  fail(code: GodotVarErrorCode, offset = this.p, detail = ''): never { throw new GodotVarError(code, offset, pathOf(this.segments), detail); }
  need(n: number): void { if (n > this.buf.length - this.p) this.fail('TRUNCATED'); }
  u32(): number { this.need(4); const n = this.dv.getUint32(this.p, true); this.p += 4; return n; }
  count(n: number, minimum: number, nodes = 0): void {
    if (n > Math.floor((this.buf.length - this.p) / minimum)) this.fail('LENGTH', this.p - 4, 'count exceeds remaining bytes');
    if (nodes > this.maxNodes - this.nodes) this.fail('LIMIT', this.p - 4, 'node budget');
  }
  string(terminated = false): string {
    const n = this.u32();
    this.need(n + pad(n));
    const start = this.p;
    this.p += n + pad(n);
    // Godot 3.0 pool strings include the C terminator in their length.
    const end = start + n - (terminated && n > 0 && this.buf[start + n - 1] === 0 ? 1 : 0);
    const length = end - start;
    if (length === 0) return '';
    let hash = 0;
    let cached: { start: number; length: number; value: string } | undefined;
    if (length <= internMaxLength) {
      const first = this.dv.getUint32(start, true) & (length < 4 ? 0xffffffff >>> ((4 - length) * 8) : -1);
      hash = Math.imul(length, 0x9e3779b1) ^ first ^ (length >= 4 ? this.dv.getUint32(end - 4, true) : 0);
      cached = this.cache.get(hash);
      if (cached && cached.length === length) {
        // Edge-word hashes can collide: compare EVERY byte before reusing text.
        let i = 0;
        while (i + 4 <= length && this.dv.getUint32(start + i, true) === this.dv.getUint32(cached.start + i, true)) i += 4;
        while (i < length && this.buf[start + i] === this.buf[cached.start + i]) i++;
        if (i === length) return cached.value;
      }
    }
    let value: string;
    try { value = utf8.decode(this.buf.subarray(start, end)); }
    catch { this.fail('ENCODING', start, 'invalid UTF-8'); }
    // First text seen under a hash stays; a colliding second text is simply decoded each time.
    if (length <= internMaxLength && !cached && this.cache.size < internMaxEntries) this.cache.set(hash, { start, length, value });
    return value;
  }
  floats(n: number): Float32Array {
    this.need(n * 4);
    const a = new Float32Array(n);
    const absolute = this.buf.byteOffset + this.p;
    if (littleEndian && absolute % 4 === 0) {
      // Same element type: TypedArray.prototype.set copies the bits, so NaN payloads survive. Reading
      // a.buffer instead would move every small array off the heap, which dominated decode time and GC.
      a.set(new Float32Array(this.buf.buffer, absolute, n));
    } else {
      const target = new Uint8Array(a.buffer);
      const source = this.buf.subarray(this.p, this.p + n * 4);
      if (littleEndian) target.set(source);
      else for (let i = 0; i < source.length; i++) target[i] = source[(i & ~3) + 3 - (i & 3)];
    }
    this.p += n * 4;
    return a;
  }
  prepare(frame: ReadFrame): void {
    const depth = this.frames.length - 1;
    frame.marker.index = frame.i;
    if (frame.type === 19) this.segments[depth] = frame.i;
    else if (frame.type === 18) {
      frame.marker.label = frame.phase ? 'value' : 'key';
      this.segments[depth] = frame.phase && typeof frame.key === 'string' ? frame.key : frame.marker;
    } else {
      frame.marker.label = 'property'; this.segments[depth] = frame.marker;
      frame.key = this.string();
      this.segments[depth] = frame.key as string;
    }
  }
  run(): { value: GdValue; end: number } {
    for (;;) {
      if (this.frames.length > this.maxDepth) this.fail('DEPTH');
      if (++this.nodes > this.maxNodes) this.fail('LIMIT');
      const at = this.p;
      const header = this.u32();
      const type = header & 255;
      if (type > 26) this.fail('BAD_TYPE', at);
      if ((header & ~255) !== 0 && !((type === 2 || type === 3) && (header & ~255) === 65536)) this.fail('UNSUPPORTED', at, 'header flags');
      let value: GdValue;
      let frame: ReadFrame | undefined;
      if (type >= 5 && type <= 14) {
        value = new GdMath(mathKinds[type - 5], this.floats(mathLengths[type - 5]));
      } else switch (type) {
        case 0: value = null; break;
        case 1: value = this.u32() !== 0; break;
        case 2: {
          this.need(header & 65536 ? 8 : 4);
          value = header & 65536 ? this.dv.getBigInt64(this.p, true) : BigInt(this.dv.getInt32(this.p, true));
          this.p += header & 65536 ? 8 : 4; break;
        }
        case 3: {
          this.need(header & 65536 ? 8 : 4);
          value = header & 65536 ? this.dv.getFloat64(this.p, true) : this.dv.getFloat32(this.p, true);
          this.p += header & 65536 ? 8 : 4; break;
        }
        case 4: value = this.string(); break;
        case 15: {
          const first = this.u32();
          if (!(first & 0x80000000)) this.fail('UNSUPPORTED', at, 'old NodePath');
          const names = first & 0x7fffffff;
          const rawSubs = this.u32(); const flags = this.u32();
          const subs = rawSubs + (flags & 2 ? 1 : 0);
          this.count(names + subs, 4);
          const ns: string[] = []; const ss: string[] = [];
          for (let i = 0; i < names; i++) ns.push(this.string());
          for (let i = 0; i < subs; i++) ss.push(this.string());
          value = new GdNodePath(ns, ss, flags); break;
        }
        case 16: this.fail('UNSUPPORTED', at, 'RID');
        case 17: {
          const cls = this.string();
          value = new GdObject(cls, []);
          if (cls !== '') {
            const n = this.u32(); this.count(n, 8, n);
            if (n) frame = { type, value, n, i: 0, key: null, phase: false, marker: { label: 'key', index: 0 } };
          }
          break;
        }
        case 18:
        case 19: {
          const word = this.u32();
          if (type === 19 && word & 0x80000000) this.fail('UNSUPPORTED', at, 'shared Array');
          const n = word & 0x7fffffff;
          this.count(n, type === 18 ? 8 : 4, n * (type === 18 ? 2 : 1));
          value = type === 18 ? new GdDict([], !!(word & 0x80000000)) : [];
          if (n) frame = { type, value, n, i: 0, key: null, phase: false, marker: { label: 'key', index: 0 } };
          break;
        }
        case 20: {
          const n = this.u32(); this.need(n + pad(n));
          value = new Uint8Array(this.buf.buffer, this.buf.byteOffset + this.p, n);
          this.p += n + pad(n); break;
        }
        case 21: {
          const n = this.u32(); this.count(n, 4);
          // Only PoolByteArray borrows the input. An int pool is always a copy, so whether writing to it reaches
          // the input never depends on the input's alignment. A typed-array view needs absolute 4-byte alignment.
          const a = new Int32Array(n);
          const absolute = this.buf.byteOffset + this.p;
          if (littleEndian && absolute % 4 === 0) a.set(new Int32Array(this.buf.buffer, absolute, n));
          else for (let i = 0; i < n; i++) a[i] = this.dv.getInt32(this.p + i * 4, true);
          value = a;
          this.p += n * 4; break;
        }
        case 22: { const n = this.u32(); this.count(n, 4); value = this.floats(n); break; }
        case 23: {
          const n = this.u32(); this.count(n, 4);
          const strings: string[] = [];
          for (let i = 0; i < n; i++) {
            this.segments.push(i); strings.push(this.string(true)); this.segments.pop();
          }
          value = new GdPool('PoolStringArray', strings); break;
        }
        case 24: case 25: case 26: {
          const n = this.u32(); const width = poolWidths[type - 23];
          this.count(n, width * 4); value = new GdPool(poolKinds[type - 23], this.floats(n * width)); break;
        }
        // Unreachable: ids above 26 are rejected before the switch. Kept so a future id cannot fall through unassigned.
        default: this.fail('BAD_TYPE', at);
      }
      if (frame) {
        this.frames.push(frame); this.prepare(frame); continue;
      }
      for (;;) {
        const parent = this.frames[this.frames.length - 1];
        if (!parent) return { value, end: this.p };
        if (parent.type === 19) (parent.value as GdValue[]).push(value);
        else if (parent.type === 18) {
          if (!parent.phase) {
            parent.key = value; parent.phase = true; this.prepare(parent); break;
          }
          (parent.value as GdDict).entries.push([parent.key, value]); parent.phase = false;
        } else (parent.value as GdObject).props.push([parent.key as string, value]);
        if (++parent.i < parent.n) { this.prepare(parent); break; }
        this.frames.pop(); this.segments.pop(); value = parent.value;
      }
    }
  }
}
export function decodeVariant(buf: Uint8Array, offset = 0, opts: DecodeOptions = {}): { value: GdValue; end: number } {
  return new Reader(buf, offset, opts).run();
}
export function decodeStoreVar(payload: Uint8Array, opts: DecodeOptions = {}): GdValue {
  if (payload.length < 4) throw new GodotVarError('TRUNCATED', 0);
  const n = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
  if (n !== payload.length - 4) throw new GodotVarError('LENGTH', 0, '/', 'store_var prefix mismatch');
  const result = decodeVariant(payload, 4, opts);
  if (result.end !== payload.length) throw new GodotVarError('TRAILING', result.end);
  return result.value;
}
interface WriteFrame { value: GdValue[] | GdDict | GdObject; i: number; n: number; type: number; marker: Marker }
class Writer {
  out: Uint8Array | undefined;
  dv: DataView | undefined;
  p: number;
  segments: Segment[] = [];
  constructor(out?: Uint8Array, offset = 0) {
    this.out = out; this.dv = out ? new DataView(out.buffer, out.byteOffset, out.byteLength) : undefined; this.p = offset;
  }
  fail(code: GodotVarErrorCode, detail = ''): never { throw new GodotVarError(code, this.p, pathOf(this.segments), detail); }
  advance(n: number): void {
    this.p += n;
    if (!Number.isSafeInteger(this.p) || this.p > 0xffffffff) this.fail('LIMIT', 'encoded length exceeds u32');
  }
  u32(n: number): void { this.dv?.setUint32(this.p, n, true); this.advance(4); }
  count(n: number, shared = false): void {
    if (!Number.isSafeInteger(n) || n < 0 || n > 0x7fffffff) this.fail('LIMIT', 'count exceeds i31');
    this.u32(n + (shared ? 0x80000000 : 0));
  }
  string(s: string, terminated = false): void {
    if (typeof s !== 'string') this.fail('UNSUPPORTED', 'expected string');
    let n = 0; let ascii = true;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (ch < 128) n++;
      else if (ch < 2048) { n += 2; ascii = false; }
      else if (ch >= 0xd800 && ch <= 0xdfff) {
        const next = s.charCodeAt(i + 1);
        if (ch > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) this.fail('ENCODING', 'lone surrogate');
        i++; n += 4; ascii = false;
      } else { n += 3; ascii = false; }
    }
    const length = n + (terminated ? 1 : 0);
    this.u32(length);
    if (this.out) {
      if (ascii) for (let i = 0; i < n; i++) this.out[this.p + i] = s.charCodeAt(i);
      else textEncoder.encodeInto(s, this.out.subarray(this.p, this.p + n));
    }
    this.advance(length + pad(length));
  }
  raw(data: Uint8Array | Int32Array | Float32Array): void {
    if (this.out) {
      const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (littleEndian || data instanceof Uint8Array) this.out.set(source, this.p);
      else for (let i = 0; i < source.length; i++) this.out[this.p + i] = source[(i & ~3) + 3 - (i & 3)];
    }
    this.advance(data.byteLength);
  }
  node(value: GdValue): WriteFrame | undefined {
    if (value === null) this.u32(0);
    else if (typeof value === 'boolean') { this.u32(1); this.u32(value ? 1 : 0); }
    else if (typeof value === 'bigint') {
      if (value < -(1n << 63n) || value >= 1n << 63n) this.fail('LIMIT', 'integer outside signed 64-bit range');
      this.u32(0x10002); this.dv?.setBigInt64(this.p, value, true); this.advance(8);
    } else if (typeof value === 'number') {
      const narrow = Math.fround(value) === value;
      this.u32(narrow ? 3 : 0x10003);
      if (narrow) this.dv?.setFloat32(this.p, value, true); else this.dv?.setFloat64(this.p, value, true);
      this.advance(narrow ? 4 : 8);
    } else if (typeof value === 'string') { this.u32(4); this.string(value); }
    else if (value instanceof GdMath) {
      const kind = mathKinds.indexOf(value.kind);
      if (kind < 0 || !(value.v instanceof Float32Array) || value.v.length !== mathLengths[kind]) this.fail('LENGTH', 'math component count');
      this.u32(kind + 5); this.raw(value.v);
    } else if (value instanceof GdNodePath) {
      if (!Number.isInteger(value.flags) || value.flags < 0 || value.flags > 0xffffffff) this.fail('LIMIT', 'NodePath flags');
      this.u32(15); this.count(value.names.length, true);
      const subs = value.subnames.length - (value.flags & 2 ? 1 : 0);
      this.count(subs); this.u32(value.flags);
      for (const s of value.names) this.string(s);
      for (const s of value.subnames) this.string(s);
    } else if (value instanceof GdObject) {
      if (value.cls === '' && value.props.length) this.fail('UNSUPPORTED', 'null Object with properties');
      this.u32(17); this.string(value.cls);
      if (value.cls !== '') {
        this.count(value.props.length);
        return { type: 17, value, i: 0, n: value.props.length, marker: { label: 'property', index: 0 } };
      }
    } else if (value instanceof GdDict) {
      this.u32(18); this.count(value.entries.length, value.shared);
      return { type: 18, value, i: 0, n: value.entries.length * 2, marker: { label: 'key', index: 0 } };
    } else if (Array.isArray(value)) {
      this.u32(19); this.count(value.length);
      return { type: 19, value, i: 0, n: value.length, marker: { label: 'key', index: 0 } };
    } else if (value instanceof Uint8Array) {
      this.u32(20); this.count(value.length); this.raw(value); this.advance(pad(value.length));
    } else if (value instanceof Int32Array || value instanceof Float32Array) {
      this.u32(value instanceof Int32Array ? 21 : 22); this.count(value.length); this.raw(value);
    } else if (value instanceof GdPool) {
      const kind = poolKinds.indexOf(value.kind);
      if (kind < 0) this.fail('UNSUPPORTED', 'pool kind');
      this.u32(kind + 23);
      if (kind === 0) {
        if (!Array.isArray(value.data)) this.fail('UNSUPPORTED', 'expected string pool');
        this.count(value.data.length);
        for (let i = 0; i < value.data.length; i++) {
          this.segments.push(i); this.string(value.data[i], true); this.segments.pop();
        }
      } else {
        if (!(value.data instanceof Float32Array) || value.data.length % poolWidths[kind] !== 0) this.fail('LENGTH', 'pool component count');
        this.count(value.data.length / poolWidths[kind]); this.raw(value.data);
      }
    } else this.fail('UNSUPPORTED', 'not a GdValue');
    return undefined;
  }
  run(value: GdValue): number {
    const frames: WriteFrame[] = [];
    const active = new Set<GdValue>();
    let current = value;
    for (;;) {
      const frame = this.node(current);
      if (frame && frame.n) {
        if (active.has(current)) this.fail('DEPTH', 'cyclic value');
        active.add(current); frames.push(frame);
      }
      for (;;) {
        const top = frames[frames.length - 1];
        if (!top) return this.p;
        if (top.i === top.n) { frames.pop(); active.delete(top.value); this.segments.pop(); continue; }
        const i = top.i++;
        if (top.type === 19) { this.segments[frames.length - 1] = i; current = (top.value as GdValue[])[i]; }
        else if (top.type === 18) {
          const pair = (top.value as GdDict).entries[Math.floor(i / 2)];
          top.marker.label = i % 2 ? 'value' : 'key'; top.marker.index = Math.floor(i / 2);
          this.segments[frames.length - 1] = i % 2 && typeof pair[0] === 'string' ? pair[0] : top.marker;
          current = pair[i % 2];
        } else {
          const pair = (top.value as GdObject).props[i];
          this.segments[frames.length - 1] = pair[0]; this.string(pair[0]); current = pair[1];
        }
        break;
      }
    }
  }
}
export function variantSize(value: GdValue): number { return new Writer().run(value); }
function encode(value: GdValue, prefix: boolean): Uint8Array {
  const size = variantSize(value);
  if (size + (prefix ? 4 : 0) > 0xffffffff) throw new GodotVarError('LIMIT', 0);
  let out: Uint8Array;
  try { out = new Uint8Array(new ArrayBuffer(size + (prefix ? 4 : 0))); }
  catch { throw new GodotVarError('LIMIT', 0, '/', 'output allocation'); }
  if (prefix) new DataView(out.buffer).setUint32(0, size, true);
  new Writer(out, prefix ? 4 : 0).run(value);
  return out;
}
export function encodeVariant(value: GdValue): Uint8Array { return encode(value, false); }
export function encodeStoreVar(value: GdValue): Uint8Array { return encode(value, true); }
export function dictToObject(d: GdDict): Record<string, GdValue> {
  const out: Record<string, GdValue> = Object.create(null) as Record<string, GdValue>;
  for (const [key, value] of d.entries) {
    if (typeof key !== 'string') throw new GodotVarError('UNSUPPORTED', 0, '/', 'non-string Dictionary key');
    if (Object.hasOwn(out, key)) throw new GodotVarError('UNSUPPORTED', 0, pathOf([key]), 'duplicate Dictionary key');
    out[key] = value;
  }
  return out;
}
