import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import * as c from '../../src/core/formats/godot-var.ts';
import type { GdValue, GodotVarErrorCode } from '../../src/core/formats/godot-var.ts';
import { difference } from '../../scripts/var-check.ts';

const hex = (s: string): Uint8Array => Uint8Array.from(s.replace(/\s/g, '').match(/../g) ?? [], (b) => parseInt(b, 16));
const bytes = (s: string): number[] => Array.from(hex(s));
const f = (...v: number[]): Float32Array => new Float32Array(v);
function check(wire: string, expected: GdValue): void {
  const input = hex(wire);
  expect(c.decodeVariant(input)).toEqual({ value: expected, end: input.length });
  expect(Array.from(c.encodeVariant(expected))).toEqual(Array.from(input));
  expect(c.variantSize(expected)).toBe(input.length);
}
function error(fn: () => unknown, code?: GodotVarErrorCode): c.GodotVarError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(c.GodotVarError);
  const e = caught as c.GodotVarError;
  if (code) expect(e.code).toBe(code);
  expect(Number.isInteger(e.offset)).toBe(true);
  expect(e.offset).toBeGreaterThanOrEqual(0);
  expect(e.path.startsWith('/')).toBe(true);
  return e;
}
function rich(): GdValue {
  return new c.GdDict([
    ['symbols', [new c.GdDict([
      ['position', new c.GdMath('Vector2', f(1, -2))],
      ['text', 'héllo 🗺'], ['nil', null], ['object', new c.GdObject('', [])],
      ['data', Uint8Array.of(0, 1, 2, 255, 8)],
      ['path', new c.GdNodePath(['root'], ['sub', 'property'], 3)],
    ])]],
    ['image', new c.GdObject('Image', [['data', new c.GdDict([['width', 4n], ['height', 0.1]])]])],
    ['pools', [new Int32Array([-1, 2]), f(0, -0, Infinity),
      new c.GdPool('PoolStringArray', ['a', 'é']), new c.GdPool('PoolVector3Array', f(1, 2, 3))]],
  ]);
}

describe('hand-written Godot 3 wire vectors (ids 0–26)', () => {
  it('keeps NIL and the null Object distinct on the wire and in memory', () => {
    check('00000000', null);
    check('11000000 00000000', new c.GdObject('', []));
    expect(c.decodeVariant(hex('11000000 00000000')).value).not.toBeNull();
    error(() => c.encodeVariant(new c.GdObject('', [['bad', null]])), 'UNSUPPORTED');
  });
  it('bool 1 and always-64-bit int 2, including full signed range', () => {
    check('01000000 00000000', false);
    check('01000000 01000000', true);
    check('02000100 ffffffffffffffff', -1n);
    check('02000100 0000000000000080', -(1n << 63n));
    check('02000100 ffffffffffffff7f', (1n << 63n) - 1n);
    for (const v of [-(1n << 63n) - 1n, 1n << 63n]) error(() => c.encodeVariant(v), 'LIMIT');
  });
  it('real 3 chooses f32 iff exactly representable, including -0, NaN and infinities', () => {
    check('03000000 0000003f', 0.5);
    check('03000100 9a9999999999b93f', 0.1);
    check('03000100 0000001000007041', 16777217);
    check('03000000 00000080', -0);
    check('03000100 000000000000f87f', NaN);
    check('03000000 0000807f', Infinity);
    check('03000000 000080ff', -Infinity);
  });
  it('string 4 lengths 0–5, UTF-8, padding, BOM and embedded NUL', () => {
    check('04000000 00000000', '');
    check('04000000 01000000 61000000', 'a');
    check('04000000 02000000 61620000', 'ab');
    check('04000000 03000000 61626300', 'abc');
    check('04000000 04000000 61626364', 'abcd');
    check('04000000 05000000 6162636465000000', 'abcde');
    check('04000000 06000000 c3a9f09f97800000', 'é🗀');
    check('04000000 04000000 efbbbf61', '\ufeffa');
    check('04000000 03000000 61006200', 'a\0b');
  });
  const math: Array<[c.GdMath['kind'], string, string, number[]]> = [
    ['Vector2', '05000000', '0000803f 00000040', [1, 2]],
    ['Rect2', '06000000', '0000803f 00000040 00004040 00008040', [1, 2, 3, 4]],
    ['Vector3', '07000000', '0000803f 00000040 00004040', [1, 2, 3]],
    ['Transform2D', '08000000', '0000803f 00000040 00004040 00008040 0000a040 0000c040', [1, 2, 3, 4, 5, 6]],
    ['Plane', '09000000', '0000803f 00000040 00004040 00008040', [1, 2, 3, 4]],
    ['Quat', '0a000000', '0000803f 00000040 00004040 00008040', [1, 2, 3, 4]],
    ['AABB', '0b000000', '0000803f 00000040 00004040 00008040 0000a040 0000c040', [1, 2, 3, 4, 5, 6]],
    ['Basis', '0c000000', '0000803f 00000040 00004040 00008040 0000a040 0000c040 0000e040 00000041 00001041', [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ['Transform', '0d000000', '0000803f 00000040 00004040 00008040 0000a040 0000c040 0000e040 00000041 00001041 00002041 00003041 00004041', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
    ['Color', '0e000000', '0000803f 00000040 00004040 00008040', [1, 2, 3, 4]],
  ];
  it.each(math)('math %s has the Godot component order', (kind, header, body, v) => check(header + body, new c.GdMath(kind, f(...v))));
  it('repeated ASCII strings never alias different interiors or bypass fatal UTF-8 validation', () => {
    const a = 'abcdAAAAtail'; const b = 'abcdBBBBtail';
    const tree = [a, b, a, b, 'é', '\ufeff'];
    expect(c.decodeVariant(c.encodeVariant(tree)).value).toEqual(tree);
    const wire = c.encodeVariant([a, b]);
    // Same length and edge words, but a poisoned interior must still be decoded.
    const secondBody = 8 + c.variantSize(a) + 8;
    wire[secondBody + 4] = 255;
    error(() => c.decodeVariant(wire), 'ENCODING');
  });
  it('interning keeps text identical across dictionary keys and NUL-terminated pool entries', () => {
    const tree = ['abc', new c.GdPool('PoolStringArray', ['abc', 'abcd', 'abc', '']), new c.GdDict([['abc', 'abc'], ['abcd', 'abc']])];
    expect(c.decodeVariant(c.encodeVariant(tree)).value).toEqual(tree);
  });
  it('interning is bounded: thousands of distinct keys still decode exactly', () => {
    const keys = Array.from({ length: 6000 }, (_, i) => `k${i}`);
    const wire = c.encodeVariant(new c.GdDict(keys.map((key, i): [string, bigint] => [key, BigInt(i)])));
    // The cache is the only Map the decoder fills; count its insertions before any assertion runs.
    const set = vi.spyOn(Map.prototype, 'set');
    let decoded: GdValue;
    let insertions: number;
    try { decoded = c.decodeVariant(wire).value; insertions = set.mock.calls.length; }
    finally { set.mockRestore(); }
    expect((decoded as c.GdDict).entries.map(([key]) => key)).toEqual(keys);
    expect(insertions).toBeGreaterThan(0);
    expect(insertions).toBeLessThanOrEqual(4096);
  });
  it('NodePath 15, including the obsolete separate property entry', () => {
    check('0f000000 00000080 00000000 00000000', new c.GdNodePath([], [], 0));
    check('0f000000 01000080 01000000 03000000 01000000 61000000 01000000 62000000 01000000 63000000', new c.GdNodePath(['a'], ['b', 'c'], 3));
  });
  it('RID 16 is explicitly unsupported', () => error(() => c.decodeVariant(hex('10000000')), 'UNSUPPORTED'));
  it('Object 17 retains class, property order and duplicates', () => {
    check('11000000 05000000 496d616765000000 02000000 01000000 78000000 00000000 01000000 78000000 01000000 01000000', new c.GdObject('Image', [['x', null], ['x', true]]));
  });
  it('Dictionary 18 retains shared, non-string keys, order and duplicate keys', () => {
    check('12000000 03000080 04000000 01000000 61000000 00000000 02000100 0100000000000000 01000000 01000000 04000000 01000000 61000000 03000000 0000003f', new c.GdDict([['a', null], [1n, true], ['a', 0.5]], true));
  });
  it('Array 19 nests Dictionary, NIL and null Object', () => {
    check('13000000 03000000 12000000 00000000 00000000 11000000 00000000', [new c.GdDict([]), null, new c.GdObject('', [])]);
  });
  it('PoolByteArray 20 includes zero padding', () => check('14000000 03000000 00ff0800', Uint8Array.of(0, 255, 8)));
  it('PoolIntArray 21 and PoolRealArray 22', () => {
    check('15000000 02000000 ffffffff 02000000', new Int32Array([-1, 2]));
    check('16000000 02000000 00000080 0000807f', f(-0, Infinity));
  });
  it('PoolStringArray 23 has Godot 3.0 NUL-terminated UTF-8 entries', () => {
    check('17000000 03000000 01000000 00000000 02000000 61000000 03000000 c3a90000', new c.GdPool('PoolStringArray', ['', 'a', 'é']));
  });
  it('PoolVector2Array 24, PoolVector3Array 25 and PoolColorArray 26', () => {
    check('18000000 01000000 0000803f 00000040', new c.GdPool('PoolVector2Array', f(1, 2)));
    check('19000000 01000000 0000803f 00000040 00004040', new c.GdPool('PoolVector3Array', f(1, 2, 3)));
    check('1a000000 01000000 0000803f 00000040 00004040 00008040', new c.GdPool('PoolColorArray', f(1, 2, 3, 4)));
  });
});

describe('strictness, limits and ownership', () => {
  it('normalises i32 ints and unnecessarily wide reals as documented', () => {
    expect(c.decodeVariant(hex('02000000 ffffffff')).value).toBe(-1n);
    expect(Array.from(c.encodeVariant(c.decodeVariant(hex('02000000 ffffffff')).value))).toEqual(bytes('02000100 ffffffffffffffff'));
    expect(c.decodeVariant(hex('03000100 000000000000e03f')).value).toBe(0.5);
    expect(Array.from(c.encodeVariant(0.5))).toEqual(bytes('03000000 0000003f'));
  });
  it('normalises non-canonical bool words to true, as Godot does, and always encodes a bool as 1', () => {
    for (const word of ['02000000', 'ffffffff', '00000100']) {
      const decoded = c.decodeVariant(hex('01000000' + word)).value;
      expect(decoded).toBe(true);
      expect(Array.from(c.encodeVariant(decoded))).toEqual(bytes('01000000 01000000'));
    }
    expect(c.decodeVariant(hex('01000000 00000000')).value).toBe(false);
  });
  it('only PoolByteArray borrows the input: int pools, real pools and math values are copies at every alignment', () => {
    const cases: Array<[string, (value: GdValue) => Float32Array | Int32Array]> = [
      ['15000000 02000000 ffffffff 02000000', (v) => v as Int32Array],
      ['16000000 02000000 0000803f 000000c0', (v) => v as Float32Array],
      ['05000000 0000803f 000000c0', (v) => (v as c.GdMath).v],
    ];
    for (const [wire, pick] of cases) {
      const encoded = hex(wire);
      // The data starts 4 or 8 bytes into the value, so these offsets give every absolute alignment modulo 4.
      for (const offset of [0, 1, 2, 3, 4, 8]) {
        const source = new Uint8Array(64);
        source.set(encoded, offset);
        const typed = pick(c.decodeVariant(source.subarray(offset, offset + encoded.length)).value);
        expect(typed.buffer).not.toBe(source.buffer);
        const before = Array.from(source);
        typed[0] = 12345;
        expect(Array.from(source)).toEqual(before);
      }
    }
  });
  it('store_var length prefix is exact and no trailing bytes are allowed', () => {
    expect(c.decodeStoreVar(hex('04000000 00000000'))).toBeNull();
    expect(Array.from(c.encodeStoreVar(null))).toEqual(bytes('04000000 00000000'));
    error(() => c.decodeStoreVar(hex('05000000 00000000')), 'LENGTH');
    error(() => c.decodeStoreVar(hex('03000000 00000000')), 'LENGTH');
    error(() => c.decodeStoreVar(hex('08000000 00000000 00000000')), 'TRAILING');
    error(() => c.decodeStoreVar(hex('0000')), 'TRUNCATED');
  });
  it('PoolByteArray borrows the source, including nonzero and unaligned byteOffsets', () => {
    for (const offset of [1, 4, 9]) {
      const source = new Uint8Array(64);
      source.set(hex('14000000 03000000 01020300'), offset);
      const v = c.decodeVariant(source.subarray(offset, offset + 12)).value as Uint8Array;
      expect(v.buffer).toBe(source.buffer);
      expect(v.byteOffset).toBe(offset + 8);
      expect(v).toEqual(Uint8Array.of(1, 2, 3));
    }
    expect(c.decodeVariant(hex('ffffffff 00000000'), 4)).toEqual({ value: null, end: 8 });
  });
  it('math and float pools copy bytes verbatim, preserving quiet and signaling NaNs', () => {
    for (const prefix of ['05000000', '16000000 02000000', '18000000 01000000']) {
      const wire = hex(prefix + '0100807f 4523c17f');
      for (const offset of [0, 1, 4]) {
        const source = new Uint8Array(wire.length + offset);
        source.set(wire, offset);
        const v = c.decodeVariant(source.subarray(offset)).value;
        const a = v instanceof Float32Array ? v : (v as c.GdMath).v ?? (v as c.GdPool).data as Float32Array;
        expect(a.buffer).not.toBe(source.buffer);
        expect(c.encodeVariant(v)).toEqual(wire);
      }
    }
    const misaligned = new Uint8Array(17);
    misaligned.set(hex('15000000 02000000 ffffffff 01000000'), 1);
    expect(c.decodeVariant(misaligned.subarray(1)).value).toEqual(new Int32Array([-1, 1]));
  });
  it('encoders allocate exact dedicated buffers and accept typed-array subviews', () => {
    const source = Uint8Array.of(99, 1, 2, 3, 99);
    const value: GdValue = [source.subarray(1, 4), new Int32Array([99, -1, 2, 99]).subarray(1, 3), f(99, 0.5, -0, 99).subarray(1, 3)];
    for (const encode of [c.encodeVariant, c.encodeStoreVar]) {
      const wire = encode(value);
      expect(wire.byteOffset).toBe(0);
      expect(wire.buffer.byteLength).toBe(wire.byteLength);
      expect(wire.byteLength).toBe(c.variantSize(value) + (encode === c.encodeStoreVar ? 4 : 0));
    }
    const store = c.encodeStoreVar(value);
    const backing = new Uint8Array(store.length + 7);
    backing.set(store, 7);
    expect(c.decodeStoreVar(backing.subarray(7))).toEqual(value);
    const cycle: GdValue[] = []; cycle.push(cycle);
    error(() => c.variantSize(cycle), 'DEPTH');
  });
  it('mismatch diagnostics locate nested Object/Dictionary/Array values and print real byte context', () => {
    const tree = new c.GdDict([['image', new c.GdObject('Image', [['data', [Uint8Array.of(7, 8, 9)]]])]]);
    const input = c.encodeStoreVar(tree);
    const output = input.slice();
    const at = output.length - 3; output[at] ^= 1;
    expect(difference(input, input, tree)).toBeUndefined();
    expect(difference(input, output, tree)).toContain(`DIFF@${at} /image/data[0] input[`);
    expect(difference(input, output, tree)).toContain(' output[');
  });
  it('dictionary convenience access is lazy, first-match, safe for prototype keys', () => {
    const d = new c.GdDict([['x', null], ['x', true], [1n, false]]);
    expect(d.get('x')).toBeNull();
    expect(d.has('x')).toBe(true);
    expect(d.has('missing')).toBe(false);
    expect(d.get('missing')).toBeUndefined();
    error(() => c.dictToObject(d), 'UNSUPPORTED');
    error(() => c.dictToObject(new c.GdDict([[1n, null]])), 'UNSUPPORTED');
    const o = c.dictToObject(new c.GdDict([['__proto__', true], ['constructor', false]]));
    expect(Object.getPrototypeOf(o)).toBeNull();
    expect(o.__proto__).toBe(true);
    const big = new c.GdDict(Array.from({ length: 100 }, (_, i) => [`k${i}`, BigInt(i)]));
    expect(big.get('k99')).toBe(99n);
    expect(big.has('k0')).toBe(true);
  });
});

describe('malformed inputs remain bounded and errors are typed and located', () => {
  it('rejects unknown types, reserved flags and unsupported encodings', () => {
    error(() => c.decodeVariant(hex('1b000000')), 'BAD_TYPE');
    error(() => c.decodeVariant(hex('00010000')), 'UNSUPPORTED');
    error(() => c.decodeVariant(hex('11000100 0000000000000000')), 'UNSUPPORTED');
    error(() => c.decodeVariant(hex('0f000000 00000000')), 'UNSUPPORTED');
    error(() => c.decodeVariant(hex('13000000 00000080 00000000')), 'UNSUPPORTED');
  });
  it('never repairs invalid UTF-8 or lone surrogates and reports the key path', () => {
    for (const body of ['ff000000', 'c0800000', 'eda08000', 'f4908080']) {
      const length = body === 'ff000000' ? '01000000' : body === 'c0800000' ? '02000000' : body === 'eda08000' ? '03000000' : '04000000';
      error(() => c.decodeVariant(hex('04000000' + length + body)), 'ENCODING');
    }
    for (const s of ['\ud800', '\udc00', 'a\ud800b']) error(() => c.encodeVariant(s), 'ENCODING');
    const wire = hex('12000000 01000000 04000000 01000000 78000000 04000000 01000000 ff000000');
    const e = error(() => c.decodeVariant(wire), 'ENCODING');
    expect(e.offset).toBe(28);
    expect(e.path).toBe('/x');
    expect(error(() => c.encodeVariant(new c.GdDict([['x', '\ud800']])), 'ENCODING').path).toBe('/x');
    // Keys are escaped in the path: '~' becomes '~0' and '/' becomes '~1', so the key "a/b~c" reads /a~1b~0c.
    const tricky = hex('12000000 01000000 04000000 05000000 612f627e63000000 04000000 01000000 ff000000');
    expect(error(() => c.decodeVariant(tricky), 'ENCODING').path).toBe('/a~1b~0c');
  });
  it('rejects truncation at EVERY byte offset of a rich sample', () => {
    const sample = c.encodeVariant(rich());
    for (let end = 0; end < sample.length; end++) error(() => c.decodeVariant(sample.subarray(0, end)));
    expect(c.decodeVariant(sample).end).toBe(sample.length);
  });
  it('bounds counts against remaining bytes before allocating', () => {
    for (const header of ['12000000', '13000000', '14000000', '15000000', '16000000', '17000000', '18000000', '19000000', '1a000000']) {
      error(() => c.decodeVariant(hex(header + 'ffffff7f 00000000')));
    }
    // The offset of a LENGTH error is the count word itself (4 bytes into the value), not the byte after it.
    for (const header of ['13000000', '12000000']) {
      expect(error(() => c.decodeVariant(hex(header + 'ffffff7f 00000000')), 'LENGTH').offset).toBe(4);
    }
    error(() => c.decodeVariant(hex('13000000 00000080 00000000')), 'UNSUPPORTED');
    error(() => c.decodeVariant(hex('0f000000 ffffffff ffffffff 02000000')));
    error(() => c.decodeVariant(hex('11000000 01000000 41000000 ffffff7f')));
  });
  it('enforces node and depth budgets without relying on RangeError', () => {
    const nested = new Uint8Array(100000 * 8 + 4);
    const dv = new DataView(nested.buffer);
    for (let i = 0; i < 100000; i++) { dv.setUint32(i * 8, 19, true); dv.setUint32(i * 8 + 4, 1, true); }
    error(() => c.decodeVariant(nested), 'DEPTH');
    expect(c.decodeVariant(nested, 0, { maxDepth: 100000, maxNodes: 100001 }).end).toBe(nested.length);
    error(() => c.decodeVariant(c.encodeVariant([null, true]), 0, { maxNodes: 2 }), 'LIMIT');
    error(() => c.decodeVariant(c.encodeVariant([[null]]), 0, { maxDepth: 1 }), 'DEPTH');
    for (const offset of [-1, 1.5, Infinity, 9]) error(() => c.decodeVariant(hex('00000000'), offset));
  });
  it('2000 seeded mutations yield only values or GodotVarError, each under 100 ms', () => {
    const sample = c.encodeVariant(rich());
    let seed = 0x12345678;
    const next = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
    let longest = 0;
    for (let i = 0; i < 2000; i++) {
      const mutated = sample.slice();
      const changes = 1 + next() % 4;
      for (let j = 0; j < changes; j++) mutated[next() % mutated.length] = next() & 255;
      const start = performance.now();
      try { c.decodeVariant(mutated); } catch (e) { expect(e).toBeInstanceOf(c.GodotVarError); }
      const ms = performance.now() - start;
      longest = Math.max(longest, ms);
      expect(ms).toBeLessThan(100);
    }
    console.log(`MUTATION seed=0x12345678 count=2000 max_ms=${longest.toFixed(3)}`);
  });
});
