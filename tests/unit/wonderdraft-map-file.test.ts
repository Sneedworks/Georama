import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { GcpfError, encodeGcpf } from '../../src/core/formats/gcpf.ts';
import { GdDict, GodotVarError, encodeStoreVar } from '../../src/core/formats/godot-var.ts';
import type { GdValue } from '../../src/core/formats/godot-var.ts';
import { WD_LIMITS, WdSchemaError, wdMapToGd } from '../../src/core/formats/wonderdraft-map.ts';
import type { WdMap } from '../../src/core/formats/wonderdraft-map.ts';
import { readWdMap, validateWdMap, writeWdMap } from '../../src/core/formats/wonderdraft-map-file.ts';
import { makeSyntheticRoot } from '../helpers/wd-synthetic.ts';

function syntheticFile(): Uint8Array {
  return encodeGcpf(encodeStoreVar(makeSyntheticRoot()));
}

function freshMap(): WdMap {
  return readWdMap(syntheticFile());
}

/** -1 when identical, otherwise the first differing offset (length mismatch counts). */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe('wonderdraft map file', () => {
  it('round-trips a synthetic file byte-identically', () => {
    const file = syntheticFile();
    const out = writeWdMap(readWdMap(file));
    expect(firstDiff(out, file)).toBe(-1);
    expect(out.length).toBe(file.length);
  });

  it('validateWdMap accepts a valid map', () => {
    expect(validateWdMap(freshMap())).toEqual([]);
  });

  it('V1: non-positive mapWidth yields exactly one issue at /mapWidth', () => {
    const map = freshMap();
    map.mapWidth = NaN;
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/mapWidth');
    expect(typeof issues[0].message).toBe('string');
  });

  it('V1+V6: an invalid integer map size reports only V1, never a V6 cascade', () => {
    const map = freshMap();
    map.mapWidth = -1;
    map.mapHeight = 4;
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/mapWidth');
  });

  it('V2: out-of-range waterLevel yields exactly one issue at /waterLevel', () => {
    const map = freshMap();
    map.waterLevel = 2;
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/waterLevel');
  });

  it('V3: non-finite Vec2 component yields exactly one issue at the field', () => {
    const map = freshMap();
    map.symbols[0].position.x = NaN;
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/symbols[0]/position');
  });

  it('V4: negative path width yields exactly one issue at the field', () => {
    const map = freshMap();
    map.paths[0].width = -1;
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/paths[0]/width');
  });

  it('V5: short raster data yields exactly one issue at /mask/data', () => {
    const map = freshMap();
    map.mask.data = map.mask.data.subarray(0, map.mask.data.length - 1);
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/mask/data');
  });

  it('V6: ground dimensions off the integer map size yield exactly one issue at /ground', () => {
    const map = freshMap();
    map.mapWidth = 2;
    map.mapHeight = 2;
    map.ground.height = 3;
    map.ground.data = new Uint8Array(2 * 3 * 4);
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/ground');
  });

  it('V7: uneven layers arrays yield exactly one issue at /layers', () => {
    const map = freshMap();
    map.layers.names = [...map.layers.names, 'Extra'];
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/layers');
  });

  it('V8: too many paths yield exactly one issue at /paths', () => {
    const map = freshMap();
    map.paths = new Array(100001) as WdMap['paths'];
    const issues = validateWdMap(map);
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe('/paths');
  });

  it('hostile: empty input throws GcpfError in under 200 ms', () => {
    const t0 = performance.now();
    expect(() => readWdMap(new Uint8Array(0))).toThrowError(GcpfError);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: 3 bytes throw GcpfError in under 200 ms', () => {
    const t0 = performance.now();
    expect(() => readWdMap(new Uint8Array([1, 2, 3]))).toThrowError(GcpfError);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: wrong magic throws GcpfError in under 200 ms', () => {
    const t0 = performance.now();
    expect(() => readWdMap(new Uint8Array(32))).toThrowError(GcpfError);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: truncated Variant payload throws GodotVarError in under 200 ms', () => {
    const full = encodeStoreVar(makeSyntheticRoot());
    const file = encodeGcpf(full.subarray(0, 10));
    const t0 = performance.now();
    expect(() => readWdMap(file)).toThrowError(GodotVarError);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: non-dictionary payload throws WdSchemaError TYPE at / in under 200 ms', () => {
    const file = encodeGcpf(encodeStoreVar(42n));
    const t0 = performance.now();
    let caught: unknown;
    try {
      readWdMap(file);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof WdSchemaError).toBe(true);
    expect((caught as WdSchemaError).code).toBe('TYPE');
    expect((caught as WdSchemaError).path).toBe('/');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: version-16 file throws WdSchemaError VERSION in under 200 ms', () => {
    const root = makeSyntheticRoot();
    const entries = root.entries.map(([k, v]): [GdValue, GdValue] => (k === 'version' ? [k, 16n] : [k, v]));
    const file = encodeGcpf(encodeStoreVar(new GdDict(entries, root.shared)));
    const t0 = performance.now();
    let caught: unknown;
    try {
      readWdMap(file);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof WdSchemaError).toBe(true);
    expect((caught as WdSchemaError).code).toBe('VERSION');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: extra byte after the footer throws WdSchemaError FORMAT at / in under 200 ms', () => {
    const file = syntheticFile();
    const plus = new Uint8Array(file.length + 1);
    plus.set(file);
    const t0 = performance.now();
    let caught: unknown;
    try {
      readWdMap(plus);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof WdSchemaError).toBe(true);
    expect((caught as WdSchemaError).code).toBe('FORMAT');
    expect((caught as WdSchemaError).path).toBe('/');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('hostile: damaged footer throws WdSchemaError FORMAT at / in under 200 ms', () => {
    const bad = syntheticFile().slice();
    bad[bad.length - 1] ^= 1;
    const t0 = performance.now();
    let caught: unknown;
    try {
      readWdMap(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof WdSchemaError).toBe(true);
    expect((caught as WdSchemaError).code).toBe('FORMAT');
    expect((caught as WdSchemaError).path).toBe('/');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('rasters borrow the decoded payload instead of copying it', () => {
    const map = freshMap();
    expect(map.mask.data.buffer.byteLength).toBeGreaterThan(map.mask.data.byteLength);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Test strength. The first tests of this module killed 19 of 112 mutants of it (a generated table: every check call
// of the validator removed in turn, plus every boundary, guard and footer rule). Each invariant is now pinned on
// both sides of its boundary, for every record kind and raster, and the file layer is fuzzed.
// ---------------------------------------------------------------------------------------------------------------

/** Model bookkeeping and raw, uninterpreted values: they are not wire fields and the validator never reads them. */
const NOT_FIELDS = new Set([
  'layout', 'extra', 'shared', 'dataPropIndex', 'imageProps', 'windroses', 'trace', 'boxes', 'labelPresets', 'colorGrading',
]);

interface Leaf {
  path: string;
  /** Where the validator reports it: a component of a Vec2 or Rgba belongs to the field of its parent. */
  field: string;
  get: () => number;
  set: (value: number) => void;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v) || ArrayBuffer.isView(v)) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

const isComponentObject = (o: Record<string, unknown>): boolean => {
  const keys = Object.keys(o).sort().join('');
  return (keys === 'xy' || keys === 'abgr') && Object.values(o).every((x) => typeof x === 'number');
};

/** Every number in the typed part of a model, with the path of the field it belongs to. */
function numberLeaves(root: object): Leaf[] {
  const out: Leaf[] = [];
  const visit = (holder: Record<string | number, unknown>, key: string | number, path: string, field: string): void => {
    const v = holder[key];
    if (typeof v === 'number') {
      out.push({ path, field, get: () => holder[key] as number, set: (x) => { holder[key] = x; } });
    } else if (Array.isArray(v)) {
      v.forEach((_, i) => visit(v as unknown as Record<number, unknown>, i, `${path}[${i}]`, `${path}[${i}]`));
    } else if (isPlain(v)) {
      const component = isComponentObject(v);
      for (const k of Object.keys(v)) {
        if (NOT_FIELDS.has(k)) continue;
        visit(v, k, `${path}/${k}`, component ? path : `${path}/${k}`);
      }
    }
  };
  const top = root as Record<string, unknown>;
  for (const k of Object.keys(top)) if (!NOT_FIELDS.has(k)) visit(top, k, `/${k}`, `/${k}`);
  return out;
}

const paths = (issues: Array<{ path: string }>): string[] => issues.map((i) => i.path);

describe('validateWdMap V3: every Real, Vec2 and Rgba field of every record', () => {
  // The oracle is the writer, not a list of field names copied from the validator: whatever wdMapToGd refuses as a
  // non-finite Real, Vec2 or Color (code FORMAT; an Int field is TYPE and outside V3) must be one issue at the field.
  it.each([['NaN', NaN], ['Infinity', Infinity]])('%s in any such field is exactly one issue at that field', (_name, value) => {
    const map = freshMap();
    let checked = 0;
    for (const leaf of numberLeaves(map)) {
      const before = leaf.get();
      leaf.set(value);
      let code = 'accepted';
      try {
        wdMapToGd(map);
      } catch (error) {
        code = error instanceof WdSchemaError ? error.code : 'other';
      }
      const issues = validateWdMap(map);
      leaf.set(before);
      if (code === 'FORMAT') {
        checked++;
        expect(paths(issues), `${leaf.path} = ${value}`).toEqual([leaf.field]);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(100);
    expect(validateWdMap(map)).toEqual([]);
  });

  it('reports one issue per field, never one per component', () => {
    const map = freshMap();
    map.theme.pathColor = { r: NaN, g: NaN, b: NaN, a: NaN };
    map.waterOffset = { x: Infinity, y: NaN };
    expect(paths(validateWdMap(map)).sort()).toEqual(['/theme/pathColor', '/waterOffset']);
  });

  it('checks every element of a colour list, the first one included', () => {
    const map = freshMap();
    const colors = map.theme.groundColors;
    expect(colors.length).toBeGreaterThan(1);
    colors[0] = { r: NaN, g: 0, b: 0, a: 1 };
    colors[colors.length - 1] = { r: 0, g: 0, b: Infinity, a: 1 };
    expect(paths(validateWdMap(map)).sort()).toEqual([`/theme/groundColors[0]`, `/theme/groundColors[${colors.length - 1}]`]);
  });
});

describe('validateWdMap V1 and V2: the map size and the water level', () => {
  it.each([
    ['mapWidth', '/mapWidth'],
    ['mapHeight', '/mapHeight'],
  ] as const)('V1: %s must be finite and above zero', (name, path) => {
    for (const bad of [0, -1, -1e-9, NaN, Infinity, -Infinity]) {
      const map = freshMap();
      map[name] = bad;
      expect(paths(validateWdMap(map)), `${name} = ${bad}`).toEqual([path]);
    }
    for (const good of [1e-9, 0.5, 4000]) {
      const map = freshMap();
      map[name] = good;
      expect(validateWdMap(map), `${name} = ${good}`).toEqual([]);
    }
  });

  it('V2: waterLevel must be finite and within [0, 1], both ends included', () => {
    for (const bad of [-0.0001, 1.0001, NaN, Infinity, -Infinity]) {
      const map = freshMap();
      map.waterLevel = bad;
      expect(paths(validateWdMap(map)), `waterLevel = ${bad}`).toEqual(['/waterLevel']);
    }
    for (const good of [0, 1, 0.5]) {
      const map = freshMap();
      map.waterLevel = good;
      expect(validateWdMap(map), `waterLevel = ${good}`).toEqual([]);
    }
  });
});

describe('validateWdMap V4: sizes are not negative', () => {
  const sizes: Array<[string, (m: WdMap, v: number) => void, string]> = [
    ['symbol radius', (m, v) => { m.symbols[1].radius = v; }, '/symbols[1]/radius'],
    ['path width', (m, v) => { m.paths[0].width = v; }, '/paths[0]/width'],
    ['territory width', (m, v) => { m.territories.territories[0].width = v; }, '/territories/territories[0]/width'],
    ['label size', (m, v) => { m.labels[1].size = v; }, '/labels[1]/size'],
  ];
  it.each(sizes)('%s: below zero is one issue, zero and positive values are fine', (_name, set, path) => {
    const bad = freshMap();
    set(bad, -1);
    expect(paths(validateWdMap(bad))).toEqual([path]);
    for (const good of [0, 7]) {
      const map = freshMap();
      set(map, good);
      expect(validateWdMap(map), `value ${good}`).toEqual([]);
    }
  });
});

describe('validateWdMap V5 and V6: rasters', () => {
  const names = ['mask', 'ground', 'waterTint'] as const;

  it.each(names)('V5: %s data one byte short or one byte long is one issue at /%s/data', (name) => {
    for (const delta of [-1, 1]) {
      const map = freshMap();
      map[name].data = new Uint8Array(map[name].data.length + delta);
      expect(paths(validateWdMap(map)), `${name} ${delta}`).toEqual([`/${name}/data`]);
    }
  });

  function resize(map: WdMap, name: (typeof names)[number], width: number, height: number): void {
    map[name].width = width;
    map[name].height = height;
    map[name].data = new Uint8Array(width * height * 4);
  }

  it.each(['mask', 'ground'] as const)('V6: %s must match the integer map size, in width, in height or in both', (name) => {
    for (const [w, h] of [[3, 2], [2, 3], [3, 3], [1, 2], [2, 1], [1, 1]] as const) {
      const map = freshMap();
      map.mapWidth = 2;
      map.mapHeight = 2;
      resize(map, name, w, h);
      expect(paths(validateWdMap(map)), `${name} ${w}x${h}`).toEqual([`/${name}`]);
    }
    const same = freshMap();
    same.mapWidth = 2;
    same.mapHeight = 2;
    expect(validateWdMap(same)).toEqual([]);
  });

  it('V6: waterTint may differ from the map size (2 of the 57 corpus maps do), and a fractional map size is not compared', () => {
    const map = freshMap();
    map.mapWidth = 2;
    map.mapHeight = 2;
    resize(map, 'waterTint', 5, 1);
    expect(validateWdMap(map)).toEqual([]);
    const fractional = freshMap();
    fractional.mapWidth = 3.5;
    expect(fractional.mask.width).toBe(2);
    expect(validateWdMap(fractional)).toEqual([]);
  });
});

describe('validateWdMap V7 and V8: list lengths and limits', () => {
  it.each(['names', 'visibility', 'lock'] as const)('V7: layers.%s one longer than the other two is one issue at /layers', (list) => {
    const map = freshMap();
    (map.layers[list] as unknown[]) = [...(map.layers[list] as unknown[]), map.layers[list][0]];
    expect(paths(validateWdMap(map))).toEqual(['/layers']);
  });

  it('V7: three lists of equal length are fine, whatever the length', () => {
    const map = freshMap();
    map.layers.names = [...map.layers.names, 'Extra'];
    map.layers.visibility = [...map.layers.visibility, true];
    map.layers.lock = [...map.layers.lock, false];
    expect(validateWdMap(map)).toEqual([]);
  });

  const lists: Array<[string, (m: WdMap, n: number) => void, string, number]> = [
    ['symbols', (m, n) => { m.symbols = new Array(n) as WdMap['symbols']; }, '/symbols', WD_LIMITS.maxSymbols],
    ['labels', (m, n) => { m.labels = new Array(n) as WdMap['labels']; }, '/labels', WD_LIMITS.maxLabels],
    ['paths', (m, n) => { m.paths = new Array(n) as WdMap['paths']; }, '/paths', WD_LIMITS.maxPaths],
    ['territories', (m, n) => { m.territories.territories = new Array(n) as WdMap['territories']['territories']; }, '/territories/territories', WD_LIMITS.maxTerritories],
    ['boxes', (m, n) => { m.boxes = new Array(n) as WdMap['boxes']; }, '/boxes', WD_LIMITS.maxBoxes],
  ];
  it.each(lists)('V8: %s is fine at its limit and one issue one above it', (_name, set, path, limit) => {
    const atLimit = freshMap();
    set(atLimit, limit);
    expect(validateWdMap(atLimit)).toEqual([]);
    const over = freshMap();
    set(over, limit + 1);
    expect(paths(validateWdMap(over))).toEqual([path]);
  });

  it.each(lists.filter(([, , path]) => path !== '/boxes'))('V8: an over-limit %s list is reported once and its elements are not walked', (_name, set, path, limit) => {
    const arrays: Record<string, (m: WdMap) => unknown[]> = {
      '/symbols': (m) => m.symbols,
      '/labels': (m) => m.labels,
      '/paths': (m) => m.paths,
      '/territories/territories': (m) => m.territories.territories,
    };
    const over = freshMap();
    set(over, limit + 1);
    // An empty record is wrong in every field a walker looks at, so a walk would add many issues.
    arrays[path](over)[0] = {};
    expect(paths(validateWdMap(over))).toEqual([path]);
  });

  it('V8: every list has its own limit (a symbol list longer than the path limit is fine)', () => {
    const map = freshMap();
    map.symbols = new Array(WD_LIMITS.maxPaths + 1) as WdMap['symbols'];
    expect(validateWdMap(map)).toEqual([]);
  });
});

describe('validateWdMap is pure and never throws', () => {
  const garbage: unknown[] = [
    null, undefined, 42, 'x', [], {}, { symbols: [null] }, { symbols: [{ position: null }] }, { theme: 5 },
    { layers: { names: 'x', visibility: [], lock: [] } }, { mask: { width: 2, height: 2, data: 5 } },
    Object.defineProperty({}, 'mapWidth', { get() { throw new Error('boom'); } }),
  ];
  it.each(garbage.map((g, i) => [i, g] as const))('garbage #%s gives a list of well-formed issues', (_i, g) => {
    const issues = validateWdMap(g as WdMap);
    expect(Array.isArray(issues)).toBe(true);
    for (const issue of issues) {
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.message).toBe('string');
    }
  });

  it('anything that is not an object is exactly one issue at the root', () => {
    for (const notAMap of [null, undefined, 42, 'x', true, [], [{}]]) {
      expect(paths(validateWdMap(notAMap as unknown as WdMap)), String(notAMap)).toEqual(['/']);
    }
  });

  it('a size that is not even a number is reported once, as not finite, and not again as negative', () => {
    const map = freshMap();
    (map.paths[0] as { width: unknown }).width = '-1';
    (map.symbols[0] as { radius: unknown }).radius = -1n;
    expect(paths(validateWdMap(map)).sort()).toEqual(['/paths[0]/width', '/symbols[0]/radius']);
  });

  it('does not modify the map', () => {
    const map = freshMap();
    map.waterLevel = NaN;
    map.symbols[0].radius = -1;
    const before = structuredClone(map);
    expect(validateWdMap(map).length).toBeGreaterThan(0);
    expect(map).toEqual(before);
  });
});

function outcome(bytes: Uint8Array): string {
  try {
    readWdMap(bytes);
    return 'ok';
  } catch (error) {
    if (error instanceof GcpfError) return `GcpfError/${error.code}`;
    if (error instanceof GodotVarError) return `GodotVarError/${error.code}`;
    if (error instanceof WdSchemaError) return `WdSchemaError/${error.code}@${error.path}`;
    return `OTHER ${String(error).slice(0, 80)}`;
  }
}

describe('readWdMap footer and container cases (rule R2: nothing is dropped silently)', () => {
  const base = syntheticFile();
  const cases: Array<[string, (f: Uint8Array) => Uint8Array, string]> = [
    ['one byte after the footer', (f) => Uint8Array.from([...f, 0]), 'WdSchemaError/FORMAT@/'],
    ['four bytes after the footer', (f) => Uint8Array.from([...f, 1, 2, 3, 4]), 'WdSchemaError/FORMAT@/'],
    ['last footer byte changed', (f) => { const c = f.slice(); c[c.length - 1] ^= 1; return c; }, 'WdSchemaError/FORMAT@/'],
    ['first footer byte changed', (f) => { const c = f.slice(); c[c.length - 4] ^= 1; return c; }, 'WdSchemaError/FORMAT@/'],
    ['footer one byte short', (f) => f.slice(0, f.length - 1), 'WdSchemaError/FORMAT@/'],
    ['footer missing', (f) => f.slice(0, f.length - 4), 'WdSchemaError/FORMAT@/'],
    ['container cut inside the last block', (f) => f.slice(0, f.length - 5), 'GcpfError/TRUNCATED'],
    ['empty input', () => new Uint8Array(0), 'GcpfError/TRUNCATED'],
  ];
  it.each(cases)('%s', (_name, damage, expected) => {
    expect(outcome(damage(base))).toBe(expected);
  });

  it('the undamaged file reads', () => {
    expect(outcome(base)).toBe('ok');
  });
});

describe('readWdMap on mutated files (rule R1: only the three typed errors may escape)', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mutate(bytes: Uint8Array, next: () => number): Uint8Array {
    const pick = (n: number): number => Math.floor(next() * n);
    const out = Array.from(bytes);
    switch (pick(5)) {
      case 0: out[pick(out.length)] ^= 1 << pick(8); break;
      case 1: out.length = pick(out.length); break;
      case 2: out.splice(pick(out.length), 0, ...Array.from({ length: 1 + pick(8) }, () => pick(256))); break;
      case 3: { const i = pick(out.length); const j = pick(out.length); [out[i], out[j]] = [out[j], out[i]]; break; }
      default: { const i = pick(out.length); out.splice(pick(out.length), 0, ...out.slice(i, i + 64)); break; }
    }
    return Uint8Array.from(out);
  }

  const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

  it('300 mutated containers and 300 mutated payloads: typed errors only, and a second trip that is stable', () => {
    const next = mulberry32(0x0ddba11);
    const variant = encodeStoreVar(makeSyntheticRoot());
    const file = encodeGcpf(variant);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 600; i++) {
      const input = i % 2 === 0 ? mutate(file, next) : encodeGcpf(mutate(variant, next));
      const result = outcome(input);
      const kind = result.split('/')[0].split(' ')[0];
      counts[kind] = (counts[kind] ?? 0) + 1;
      expect(kind, `case ${i}: ${result}`).not.toBe('OTHER');
      if (result === 'ok') {
        const first = writeWdMap(readWdMap(input));
        expect(equal(writeWdMap(readWdMap(first)), first), `case ${i} second trip`).toBe(true);
      }
    }
    // The run must reach every layer, or it proves nothing about the layers it skipped.
    expect(counts['GcpfError'] ?? 0).toBeGreaterThan(0);
    expect(counts['GodotVarError'] ?? 0).toBeGreaterThan(0);
    expect(counts['WdSchemaError'] ?? 0).toBeGreaterThan(0);
    expect(counts['ok'] ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Second round, from the quality review of ada150f (24 mutants of its own, 12 killed): the order of the issues, the
// division of labour between the validator and the writer, and the three limits that are not walked.
// ---------------------------------------------------------------------------------------------------------------

describe('validateWdMap lists its issues in a fixed, documented order', () => {
  it('V1 and V2 first, then the V3 fields in record order, then V5, V6, V7 and V8', () => {
    const map = freshMap();
    map.mapWidth = 2;
    map.mapHeight = 2;
    map.waterStain = NaN;
    map.waterOffset = { x: NaN, y: 0 };
    map.theme.waterHue = NaN;
    map.frame.size = NaN;
    (map.grid as unknown as { size: number }).size = NaN;
    (map.scale as unknown as { rotation: number }).rotation = NaN;
    map.paths[0].width = -1;
    map.territories.territories[0].opacity = NaN;
    map.symbols[0].rotation = NaN;
    map.labels[0].rotation = NaN;
    map.ground.data = new Uint8Array(map.ground.data.length - 1);
    map.waterTint.data = new Uint8Array(map.waterTint.data.length - 1);
    map.mask.width = 3;
    map.mask.height = 2;
    map.mask.data = new Uint8Array(3 * 2 * 4);
    map.layers.names = [...map.layers.names, 'Extra'];
    map.boxes = new Array(WD_LIMITS.maxBoxes + 1) as WdMap['boxes'];
    expect(paths(validateWdMap(map))).toEqual([
      '/waterStain', '/waterOffset', '/theme/waterHue', '/frame/size', '/grid/size', '/scale/rotation',
      '/paths[0]/width', '/territories/territories[0]/opacity', '/symbols[0]/rotation', '/labels[0]/rotation',
      '/ground/data', '/waterTint/data', '/mask', '/layers', '/boxes',
    ]);
  });

  it('mapWidth, mapHeight and waterLevel come before everything else', () => {
    const map = freshMap();
    map.waterLevel = 2;
    map.mapHeight = 0;
    map.mapWidth = 0;
    map.waterStain = NaN;
    expect(paths(validateWdMap(map))).toEqual(['/mapWidth', '/mapHeight', '/waterLevel', '/waterStain']);
  });

  it('issues inside a list follow the list order', () => {
    const map = freshMap();
    map.symbols[1].radius = -1;
    map.symbols[0].radius = -1;
    expect(paths(validateWdMap(map))).toEqual(['/symbols[0]/radius', '/symbols[1]/radius']);
  });
});

describe('the validator checks values; the writer is the gate for containers of the wrong kind', () => {
  // A wrong-kind container is a type defect, not a numeric one. The validator stays silent and never throws on it
  // (R3: nothing is invented), and writeWdMap refuses the same model with a typed TYPE error, so nothing wrong is
  // saved. If the validator ever learns to report these, this table is the place to change on purpose.
  const cases: Array<[string, (m: WdMap) => void]> = [
    ['theme is a number', (m) => { (m as unknown as { theme: unknown }).theme = 5; }],
    ['theme is null', (m) => { (m as unknown as { theme: unknown }).theme = null; }],
    ['theme is missing', (m) => { (m as unknown as { theme: unknown }).theme = undefined; }],
    ['theme is a list', (m) => { (m as unknown as { theme: unknown }).theme = []; }],
    ['frame is a string', (m) => { (m as unknown as { frame: unknown }).frame = 'x'; }],
    ['grid is a number', (m) => { (m as unknown as { grid: unknown }).grid = 7; }],
    ['grid is missing', (m) => { (m as unknown as { grid: unknown }).grid = undefined; }],
    ['scale is a string', (m) => { (m as unknown as { scale: unknown }).scale = 'x'; }],
    ['scale is missing', (m) => { (m as unknown as { scale: unknown }).scale = undefined; }],
    ['theme.groundColors is a string', (m) => { (m.theme as unknown as { groundColors: unknown }).groundColors = 'abc'; }],
    ['theme.groundColors is null', (m) => { (m.theme as unknown as { groundColors: unknown }).groundColors = null; }],
    ['theme.groundColors is missing', (m) => { (m.theme as unknown as { groundColors: unknown }).groundColors = undefined; }],
    ['theme.groundColors is a record', (m) => { (m.theme as unknown as { groundColors: unknown }).groundColors = {}; }],
    ['theme.waterColors is a number', (m) => { (m.theme as unknown as { waterColors: unknown }).waterColors = 5; }],
    ['theme.symbolCustomColors is a string', (m) => { (m.theme as unknown as { symbolCustomColors: unknown }).symbolCustomColors = 'abc'; }],
    ['scale.colors is a string', (m) => { (m.scale as unknown as { colors: unknown }).colors = 'abc'; }],
    ['symbols is a string', (m) => { (m as unknown as { symbols: unknown }).symbols = 'x'; }],
    ['symbols is null', (m) => { (m as unknown as { symbols: unknown }).symbols = null; }],
    ['symbols is a record', (m) => { (m as unknown as { symbols: unknown }).symbols = {}; }],
    ['paths is a string', (m) => { (m as unknown as { paths: unknown }).paths = 'x'; }],
    ['labels is a number', (m) => { (m as unknown as { labels: unknown }).labels = 5; }],
    ['territories is a number', (m) => { (m as unknown as { territories: unknown }).territories = 5; }],
    ['territories.territories is a string', (m) => { (m.territories as unknown as { territories: unknown }).territories = 'x'; }],
    ['a symbol is null', (m) => { (m.symbols as unknown[])[1] = null; }],
    ['a symbol has no sample entry', (m) => { (m.symbols[0] as unknown as { sample: unknown }).sample = undefined; }],
    ['a symbol has no customColors entry', (m) => { (m.symbols[0] as unknown as { customColors: unknown }).customColors = undefined; }],
    ['a symbol customColors is a string', (m) => { (m.symbols[0] as unknown as { customColors: unknown }).customColors = 'abc'; }],
    ['layers is a number', (m) => { (m as unknown as { layers: unknown }).layers = 5; }],
    ['layers.names is a string', (m) => { (m.layers as unknown as { names: unknown }).names = 'x'; }],
    ['mask is a number', (m) => { (m as unknown as { mask: unknown }).mask = 5; }],
    ['mask.data is a number', (m) => { (m.mask as unknown as { data: unknown }).data = 5; }],
    ['mask.width is a string that is not a number', (m) => { (m.mask as unknown as { width: unknown }).width = 'x'; }],
    ['boxes is a string', (m) => { (m as unknown as { boxes: unknown }).boxes = 'x'; }],
  ];

  it.each(cases)('%s: the validator is silent and does not throw, the writer refuses with TYPE', (_name, edit) => {
    const map = freshMap();
    edit(map);
    expect(validateWdMap(map)).toEqual([]);
    let thrown: unknown;
    try {
      writeWdMap(map);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WdSchemaError);
    expect((thrown as WdSchemaError).code).toBe('TYPE');
  });

  it('nullable records are silent whether they are null or missing', () => {
    const base = freshMap();
    const nulls = readWdMap(encodeGcpf(encodeStoreVar(makeSyntheticRoot({ gridNull: true, scaleNull: true }))));
    expect(nulls.grid).toBeNull();
    expect(nulls.scale).toBeNull();
    expect(validateWdMap(nulls)).toEqual([]);
    expect(base.symbols.some((s) => s.sample === null)).toBe(true);
    expect(validateWdMap(base)).toEqual([]);
  });
});

describe('validateWdMap: a Vec2 or an Rgba is a record, whatever properties another kind of value carries', () => {
  it('an array that merely carries x and y is not a Vec2', () => {
    const map = freshMap();
    map.waterOffset = Object.assign([], { x: 1, y: 2 }) as unknown as WdMap['waterOffset'];
    expect(paths(validateWdMap(map))).toEqual(['/waterOffset']);
  });

  it('an array that merely carries r, g, b and a is not an Rgba', () => {
    const map = freshMap();
    map.theme.pathColor = Object.assign([], { r: 0, g: 0, b: 0, a: 1 }) as unknown as WdMap['theme']['pathColor'];
    expect(paths(validateWdMap(map))).toEqual(['/theme/pathColor']);
  });
});
