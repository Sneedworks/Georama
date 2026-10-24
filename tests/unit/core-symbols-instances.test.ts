import { describe, expect, it } from 'vitest';
import type { AtlasLookup, SymbolInput } from '../../src/core/symbols/instances.ts';
import { buildInstances } from '../../src/core/symbols/instances.ts';
import { assetKey, resolveRef } from '../../src/core/assets/resolve.ts';
import { classifySymbolTexture } from '../../src/core/symbols/texture-class.ts';

const RESERVED = { key: '', page: 0, x: 0, y: 0, width: 16, height: 16 };

function lookupFor(key: string, w = 16, h = 16, x = 32, y = 8, page = 0): AtlasLookup {
  return {
    pageSize: 64,
    reserved: RESERVED,
    placements: [{ key, page, x, y, width: w, height: h }],
    oversize: [],
  };
}

function sym(over: Partial<SymbolInput> = {}, texture: unknown = 'res://sprites/synthetic/tex_02'): SymbolInput {
  return {
    position: { x: 100, y: 50 },
    rotation: 0,
    scale: { x: 2, y: 1 },
    zIndex: 0,
    offset: { x: 0, y: 0 },
    mirror: false,
    texture,
    sample: null,
    customColors: null,
    ...over,
  };
}

function keyOf(text: string): string {
  return assetKey(resolveRef('symbol', text));
}

describe('finite Float32 GPU instance records (I5)', () => {
  const texture = 'res://sprites/synthetic/tex_02';
  const atlas = lookupFor(keyOf(texture));

  it.each([
    ['Float32 position overflow', sym({ position: { x: 1e308, y: 0 } })],
    ['Float32 scale overflow', sym({ scale: { x: 1e308, y: 1 } })],
    ['translation addition overflow', sym({ position: { x: 1e308, y: 0 }, offset: { x: 1e308, y: 0 } })],
    ['transform multiplication overflow', sym({ scale: { x: 1e308, y: 1 }, offset: { x: 1e308, y: 0 } })],
    ['placeholder position overflow', sym({ position: { x: 1e308, y: 0 } }, { embedded: true })],
  ])('rejects %s without returning partially populated records', (_name, bad) => {
    const verdict = buildInstances([sym(), bad, sym()], atlas);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('INPUT');
    expect(verdict.message).toMatch(/^I5: non-finite instance record at 1 component \d+$/);
  });

  it('rejects a Float32-overflowing atlas placement', () => {
    const invalidAtlas: AtlasLookup = {
      ...atlas,
      placements: [{ ...atlas.placements[0]!, x: 1e308 }],
    };
    const verdict = buildInstances([sym()], invalidAtlas);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain('at 0 component 6');
  });

  it('rejects a Float32-overflowing reserved placement in a placeholder', () => {
    const invalidAtlas: AtlasLookup = { ...atlas, reserved: { ...RESERVED, x: 1e308 } };
    const verdict = buildInstances([sym({}, { embedded: true })], invalidAtlas);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain('at 0 component 6');
  });

  it('accepts large values that remain finite as Float32', () => {
    const verdict = buildInstances([sym({ position: { x: 1e30, y: -1e30 }, scale: { x: 1e30, y: 1 } })], atlas);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(Array.from(verdict.records).every(Number.isFinite)).toBe(true);
  });
});

describe('E5 transform (I3/I5)', () => {
  it('rotation 0 scale (2,1) offset (0,0) no mirror gives diag(2,1) t=(100,50)', () => {
    const text = 'res://sprites/synthetic/tex_02';
    const key = keyOf(text);
    expect(classifySymbolTexture(text).class).toBe('asset');
    const v = buildInstances([sym({}, text)], lookupFor(key));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.counts.sprites).toBe(1);
    expect(v.order).toEqual(new Uint32Array([0]));
    const r = v.records;
    expect(r.length).toBe(16);
    expect(r[0]).toBeCloseTo(2, 6);
    expect(r[1]).toBeCloseTo(0, 6);
    expect(r[2]).toBeCloseTo(0, 6);
    expect(r[3]).toBeCloseTo(1, 6);
    expect(r[4]).toBeCloseTo(100, 6);
    expect(r[5]).toBeCloseTo(50, 6);
    expect(r[6]).toBe(32);
    expect(r[7]).toBe(8);
    expect(r[8]).toBe(16);
    expect(r[9]).toBe(16);
    expect(r[10]).toBe(0);
    expect(r[11]).toBe(1);
    expect(r[12]).toBe(1);
    expect(r[13]).toBe(1);
    expect(r[14]).toBe(1);
    expect(r[15]).toBe(0);
  });

  it('mirror gives A00 = -2 (I3)', () => {
    const text = 'res://sprites/synthetic/tex_02';
    const key = keyOf(text);
    const v = buildInstances([sym({ mirror: true }, text)], lookupFor(key));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.records[0]).toBeCloseTo(-2, 6);
    expect(v.records[2]).toBeCloseTo(0, 6);
  });

  it('rotation pi/2 scale (1,1) gives [[0,-1],[1,0]] (I3)', () => {
    const text = 'res://sprites/synthetic/tex_02';
    const key = keyOf(text);
    const v = buildInstances([sym({ rotation: Math.PI / 2, scale: { x: 1, y: 1 } }, text)], lookupFor(key));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.records[0]).toBeCloseTo(0, 6);
    expect(v.records[1]).toBeCloseTo(-1, 6);
    expect(v.records[2]).toBeCloseTo(1, 6);
    expect(v.records[3]).toBeCloseTo(0, 6);
  });

  it('offset (3,4) scale (2,1) rotation 0 gives t=(106,54) (I3)', () => {
    const text = 'res://sprites/synthetic/tex_02';
    const key = keyOf(text);
    const v = buildInstances([sym({ offset: { x: 3, y: 4 } }, text)], lookupFor(key));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.records[4]).toBeCloseTo(106, 6);
    expect(v.records[5]).toBeCloseTo(54, 6);
  });
});

describe('draw order with ties (I6)', () => {
  it('sorts by (zIndex, y, index)', () => {
    const text = 'res://sprites/synthetic/tex_02';
    const key = keyOf(text);
    const atlas = lookupFor(key);
    const symbols: SymbolInput[] = [
      sym({ position: { x: 0, y: 30 }, zIndex: 1 }, text),
      sym({ position: { x: 0, y: 10 }, zIndex: 1 }, text),
      sym({ position: { x: 0, y: 10 }, zIndex: 0 }, text),
      sym({ position: { x: 0, y: 10 }, zIndex: 1 }, text),
    ];
    const v = buildInstances(symbols, atlas);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // index 2 (z 0) first, then y=10 indices 1,3 in index order, then y=30 index 0
    expect(Array.from(v.order)).toEqual([2, 1, 3, 0]);
    // records are in draw order: first record belongs to original index 2
    expect(v.records.length).toBe(4 * 16);
  });
});

describe('placeholder kinds records and colours (I2/I4/I5)', () => {
  const spriteText = 'res://sprites/synthetic/tex_02';
  const spriteKey = keyOf(spriteText);
  const otherText = 'res://sprites/synthetic/tex_04';
  const otherKey = keyOf(otherText);
  const overText = 'res://sprites/synthetic/tex_01';
  const overKey = keyOf(overText);

  function mixedAtlas(): AtlasLookup {
    return {
      pageSize: 64,
      reserved: RESERVED,
      placements: [{ key: spriteKey, page: 1, x: 4, y: 6, width: 20, height: 12 }],
      oversize: [overKey],
    };
  }

  it.each([
    ['embedded', { a: 1 }, [0, 1, 1, 1]],
    ['invalid', 42, [1, 0, 1, 1]],
    ['unresolved', otherText, [1, 1, 0, 1]],
    ['oversize', overText, [1, 0.5, 0, 1]],
  ] as Array<[string, unknown, number[]]>)('%s placeholder record', (kind, texture, colour) => {
    const atlas = mixedAtlas();
    const s = sym({ position: { x: 7, y: 9 } }, texture);
    const v = buildInstances([s], atlas);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.counts.placeholders[kind as 'embedded' | 'invalid' | 'unresolved' | 'oversize']).toBe(1);
    expect(v.counts.sprites).toBe(0);
    const r = v.records;
    // A = I, t = position
    expect(r[0]).toBeCloseTo(1, 6);
    expect(r[1]).toBeCloseTo(0, 6);
    expect(r[2]).toBeCloseTo(0, 6);
    expect(r[3]).toBeCloseTo(1, 6);
    expect(r[4]).toBeCloseTo(7, 6);
    expect(r[5]).toBeCloseTo(9, 6);
    expect(r[6]).toBe(0);
    expect(r[7]).toBe(0);
    expect(r[8]).toBe(16);
    expect(r[9]).toBe(16);
    expect(r[10]).toBe(0);
    expect(r[11]).toBe(colour[0] as number);
    expect(r[12]).toBe(colour[1] as number);
    expect(r[13]).toBe(colour[2] as number);
    expect(r[14]).toBe(colour[3] as number);
    expect(r[15]).toBe(0);
  });

  it('sprite uses placement uv and white colour', () => {
    const atlas = mixedAtlas();
    const v = buildInstances([sym({}, spriteText)], atlas);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = v.records;
    expect(r[6]).toBe(4);
    expect(r[7]).toBe(6);
    expect(r[8]).toBe(20);
    expect(r[9]).toBe(12);
    expect(r[10]).toBe(1);
    expect(r[11]).toBe(1);
    expect(r[12]).toBe(1);
    expect(r[13]).toBe(1);
    expect(r[14]).toBe(1);
  });
});

describe('I1 INPUT table (I1)', () => {
  it('more than 1000000 symbols gives INPUT without iterating', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sparse = new Array(1_000_001) as unknown as readonly SymbolInput[];
    const atlas: AtlasLookup = { pageSize: 64, reserved: RESERVED, placements: [], oversize: [] };
    const v = buildInstances(sparse, atlas);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
  });

  it('each bad field gives INPUT naming field and index', () => {
    const atlas: AtlasLookup = { pageSize: 64, reserved: RESERVED, placements: [], oversize: [] };
    const good = sym({}, { plain: true });
    const cases: Array<{ name: string; mutate: (s: SymbolInput) => SymbolInput; field: string }> = [
      { name: 'position.x', mutate: (s) => ({ ...s, position: { x: Number.NaN, y: 0 } }), field: 'position.x' },
      { name: 'position.y', mutate: (s) => ({ ...s, position: { x: 0, y: Number.POSITIVE_INFINITY } }), field: 'position.y' },
      { name: 'rotation', mutate: (s) => ({ ...s, rotation: '0' as unknown as number }), field: 'rotation' },
      { name: 'scale.x', mutate: (s) => ({ ...s, scale: { x: 1, y: 2 }, position: s.position, rotation: s.rotation, zIndex: s.zIndex, offset: s.offset, mirror: s.mirror, texture: s.texture, sample: s.sample, customColors: s.customColors } as SymbolInput), field: 'scale.x' },
      { name: 'zIndex float', mutate: (s) => ({ ...s, zIndex: 1.5 }), field: 'zIndex' },
      { name: 'mirror', mutate: (s) => ({ ...s, mirror: 1 as unknown as boolean }), field: 'mirror' },
      { name: 'offset.y', mutate: (s) => ({ ...s, offset: { x: 0, y: Number.NaN } }), field: 'offset.y' },
    ];
    // fix scale.x case to actually break it
    const brokenScale: SymbolInput = { ...good, scale: { x: Number.NaN, y: 1 } };
    const list: SymbolInput[] = [good, brokenScale];
    const v0 = buildInstances(list, atlas);
    expect(v0.ok).toBe(false);
    if (!v0.ok) {
      expect(v0.code).toBe('INPUT');
      expect(v0.message).toContain('scale.x');
      expect(v0.message).toContain('1');
    }
    for (const c of cases) {
      const bad = c.mutate(good);
      // for the scale.x entry above the generic mutate keeps it valid; skip it here
      if (c.name === 'scale.x') continue;
      const v = buildInstances([good, bad, good], atlas);
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.code).toBe('INPUT');
      expect(v.message).toContain(c.field);
      expect(v.message).toContain('1');
    }
    // hostile: missing position object
    const hostile = { ...good, position: null } as unknown as SymbolInput;
    const vh = buildInstances([hostile], atlas);
    expect(vh.ok).toBe(false);
    if (!vh.ok) expect(vh.code).toBe('INPUT');
    // hostile: symbol is null
    const vn = buildInstances([null as unknown as SymbolInput], atlas);
    expect(vn.ok).toBe(false);
    if (!vn.ok) expect(vn.code).toBe('INPUT');
  });
});

describe('counts invariant on mixed list (I7)', () => {
  it('total equals sprites plus placeholders; unapplied counted', () => {
    const spriteText = 'res://sprites/synthetic/tex_02';
    const spriteKey = keyOf(spriteText);
    const overText = 'res://sprites/synthetic/tex_01';
    const overKey = keyOf(overText);
    const missingText = 'res://sprites/synthetic/tex_04';
    const atlas: AtlasLookup = {
      pageSize: 64,
      reserved: RESERVED,
      placements: [{ key: spriteKey, page: 0, x: 17, y: 0, width: 10, height: 10 }],
      oversize: [overKey],
    };
    const symbols: SymbolInput[] = [
      sym({ sample: { v: 1 }, customColors: null }, spriteText),
      sym({ sample: null, customColors: { c: 1 } }, spriteText),
      sym({}, { held: true }),
      sym({}, 7),
      sym({}, missingText),
      sym({ sample: 0, customColors: false }, overText),
    ];
    const v = buildInstances(symbols, atlas);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.counts.total).toBe(6);
    const sum = v.counts.sprites + v.counts.placeholders.embedded + v.counts.placeholders.invalid + v.counts.placeholders.unresolved + v.counts.placeholders.oversize;
    expect(sum).toBe(v.counts.total);
    expect(v.counts.sprites).toBe(2);
    expect(v.counts.placeholders.embedded).toBe(1);
    expect(v.counts.placeholders.invalid).toBe(1);
    expect(v.counts.placeholders.unresolved).toBe(1);
    expect(v.counts.placeholders.oversize).toBe(1);
    // sample present on indices 0 and 5 (0 counts: 0 is neither null nor undefined)
    expect(v.counts.unapplied.sample).toBe(2);
    expect(v.counts.unapplied.customColors).toBe(2);
  });

  it('null and undefined do not count as applied', () => {
    const atlas: AtlasLookup = { pageSize: 64, reserved: RESERVED, placements: [], oversize: [] };
    const v = buildInstances(
      [sym({ sample: null, customColors: undefined }, { x: 1 }), sym({ sample: undefined, customColors: null }, { y: 2 })],
      atlas,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.counts.unapplied.sample).toBe(0);
    expect(v.counts.unapplied.customColors).toBe(0);
  });
});

describe('correction 1 mutation gaps (instances)', () => {
  const G_RES0 = { key: '', page: 0, x: 0, y: 0, width: 16, height: 16 };
  const G_K1 = assetKey(resolveRef('symbol', 'res://sprites/inv-a'));
  const G_K2 = assetKey(resolveRef('symbol', 'res://sprites/inv-b'));

  function gsym(over: Partial<SymbolInput> = {}): SymbolInput {
    return {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      zIndex: 0,
      offset: { x: 0, y: 0 },
      mirror: false,
      texture: 'res://sprites/inv-a',
      sample: null,
      customColors: null,
      ...over,
    };
  }

  function glk(
    placements: AtlasLookup['placements'],
    reserved: AtlasLookup['reserved'] = G_RES0,
  ): AtlasLookup {
    return { pageSize: 64, reserved, placements, oversize: [] };
  }

  it('G1: one million symbols gives invalid position.x at 0', () => {
    const sparse = new Array(1_000_000) as unknown as readonly SymbolInput[];
    const v = buildInstances(sparse, glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid position.x at 0');
  });

  it('G1: more than one million symbols gives too many symbols', () => {
    const sparse = new Array(1_000_001) as unknown as readonly SymbolInput[];
    const v = buildInstances(sparse, glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: too many symbols');
  });

  it('G6: non-array inputs give INPUT', () => {
    const values: unknown[] = [undefined, null, 'abc', {}];
    for (const value of values) {
      const v = buildInstances(value as unknown as readonly SymbolInput[], glk([]));
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.code).toBe('INPUT');
    }
  });

  it('G10: null scale gives invalid scale.x at 0', () => {
    const v = buildInstances([gsym({ scale: null as unknown as SymbolInput['scale'] })], glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid scale.x at 0');
  });

  it('G10: null offset gives invalid offset.x at 0', () => {
    const v = buildInstances([gsym({ offset: null as unknown as SymbolInput['offset'] })], glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid offset.x at 0');
  });

  it('G11: invalid atlas lookup gives invalid atlas', () => {
    const values: unknown[] = [null, undefined, 5];
    for (const value of values) {
      const v = buildInstances([gsym({})], value as unknown as AtlasLookup);
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.code).toBe('INPUT');
      expect(v.message).toEqual('I1: invalid atlas');
    }
  });

  it('G12: malformed placements are skipped', () => {
    const placements = [
      null,
      undefined,
      'str',
      Object.assign(function () {}, { key: G_K1 }),
      { key: 123 },
    ] as unknown as AtlasLookup['placements'];
    const v = buildInstances([gsym({})], glk(placements, G_RES0));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.counts).toEqual({
      total: 1,
      sprites: 0,
      placeholders: { embedded: 0, invalid: 0, unresolved: 1, oversize: 0 },
      unapplied: { sample: 0, customColors: 0 },
    });
    expect(Array.from(v.records)).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 16, 16, 0, 1, 1, 0, 1, 0]);
  });

  it('G13: every record field with rotation offset and non-origin reserved', () => {
    const P1 = { key: G_K1, page: 1, x: 2, y: 3, width: 10, height: 12 };
    const P2 = { key: G_K2, page: 0, x: 20, y: 21, width: 4, height: 6 };
    const RES13 = { key: '', page: 2, x: 5, y: 7, width: 16, height: 16 };
    const s0 = gsym({
      texture: 'res://sprites/inv-a',
      position: { x: 1, y: 2 },
      rotation: Math.PI / 2,
      scale: { x: 2, y: 1 },
      offset: { x: 3, y: 4 },
      mirror: true,
    });
    const s3 = gsym({ texture: 'res://sprites/inv-b', position: { x: 4, y: 3 }, rotation: Math.PI / 2 });
    const s1 = gsym({ texture: 42, position: { x: 5, y: 6 } });
    const s2 = gsym({ texture: {}, position: { x: 0, y: 0 }, zIndex: 2 });
    const v = buildInstances([s0, s3, s1, s2], glk([P1, P2], RES13));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Array.from(v.order)).toEqual([0, 1, 2, 3]);
    expect(v.counts).toEqual({
      total: 4,
      sprites: 2,
      placeholders: { embedded: 1, invalid: 1, unresolved: 0, oversize: 0 },
      unapplied: { sample: 0, customColors: 0 },
    });
    const expected: readonly (readonly number[])[] = [
      [0, -1, -2, 0, -3, 8, 2, 3, 10, 12, 1, 1, 1, 1, 1, 0],
      [0, -1, 1, 0, 4, 3, 20, 21, 4, 6, 0, 1, 1, 1, 1, 0],
      [1, 0, 0, 1, 5, 6, 5, 7, 16, 16, 2, 1, 0, 1, 1, 0],
      [1, 0, 0, 1, 0, 0, 5, 7, 16, 16, 2, 0, 1, 1, 1, 0],
    ];
    expect(v.records.length).toBe(64);
    for (let r = 0; r < 4; r += 1) {
      const row = expected[r] as readonly number[];
      for (let c = 0; c < 6; c += 1) {
        expect(v.records[r * 16 + c]).toBeCloseTo(row[c] as number, 6);
      }
      for (let c = 6; c < 16; c += 1) {
        expect(v.records[r * 16 + c]).toBe(row[c] as number);
      }
    }
  });

  it('G14: draw order ties match the oracle', () => {
    const syms: SymbolInput[] = Array.from({ length: 300 }, (_, i) =>
      gsym({ texture: 1, zIndex: (i * 7919) % 3, position: { x: 0, y: (i * 104729) % 2 } }),
    );
    const expected = Array.from({ length: 300 }, (_, i) => i).sort((a, b) => {
      const sa = syms[a] as SymbolInput;
      const sb = syms[b] as SymbolInput;
      return sa.zIndex - sb.zIndex || sa.position.y - sb.position.y || a - b;
    });
    const v = buildInstances(syms, glk([]));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Array.from(v.order)).toEqual(expected);
  });

  it('G15: function-valued symbol is invalid position.x at 0', () => {
    const hostile = Object.assign(function () {}, gsym({}));
    const v = buildInstances([hostile as unknown as SymbolInput], glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid position.x at 0');
  });

  it('G15: function-valued position is invalid position.x at 0', () => {
    const hostile = gsym({ position: Object.assign(function () {}, { x: 0, y: 0 }) as unknown as SymbolInput['position'] });
    const v = buildInstances([hostile], glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid position.x at 0');
  });

  it('G15: function-valued scale is invalid scale.x at 0', () => {
    const hostile = gsym({ scale: Object.assign(function () {}, { x: 1, y: 1 }) as unknown as SymbolInput['scale'] });
    const v = buildInstances([hostile], glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid scale.x at 0');
  });

  it('G15: function-valued offset is invalid offset.x at 0', () => {
    const hostile = gsym({ offset: Object.assign(function () {}, { x: 0, y: 0 }) as unknown as SymbolInput['offset'] });
    const v = buildInstances([hostile], glk([]));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('I1: invalid offset.x at 0');
  });
});

describe('correction 2: I1 atlas reserved block', () => {
  const page = (overrides: Record<string, unknown>) => ({ key: '', page: 0, x: 0, y: 0, width: 16, height: 16, ...overrides });
  const lookup = (reserved: unknown): AtlasLookup => ({ pageSize: 64, reserved, placements: [], oversize: [] } as unknown as AtlasLookup);
  const invalid = { ok: false, code: 'INPUT', message: 'I1: invalid atlas' };
  const embedded = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, zIndex: 0, offset: { x: 0, y: 0 }, mirror: false, texture: {}, sample: null, customColors: null } as unknown as SymbolInput;

  it('G-R1a reserved missing: an empty symbol list gives INPUT, not a throw', () => {
    expect(buildInstances([], { pageSize: 64, placements: [], oversize: [] } as unknown as AtlasLookup)).toEqual(invalid);
  });
  it('G-R1b reserved null: an empty symbol list gives INPUT, not a throw', () => {
    expect(buildInstances([], lookup(null))).toEqual(invalid);
  });
  it('G-R1c reserved is a number: an empty symbol list gives INPUT', () => {
    expect(buildInstances([], lookup(5))).toEqual(invalid);
  });
  it('G-R1d reserved without page: an empty symbol list gives INPUT', () => {
    expect(buildInstances([], lookup({ key: '', x: 0, y: 0, width: 16, height: 16 }))).toEqual(invalid);
  });
  it('G-R1e reserved with x NaN: an empty symbol list gives INPUT', () => {
    expect(buildInstances([], lookup(page({ x: Number.NaN })))).toEqual(invalid);
  });
  it('G-R2 a valid symbol with a missing reserved block gives the atlas message, not a symbol message', () => {
    expect(buildInstances([embedded], { pageSize: 64, placements: [], oversize: [] } as unknown as AtlasLookup)).toEqual(invalid);
  });
  it('G-R3 control: a valid reserved block with no symbols is ok with zero counts', () => {
    const v = buildInstances([], lookup(page({})));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.counts.total).toBe(0);
      expect(v.counts.sprites).toBe(0);
    }
  });
  it('G-R1f reserved without y: an empty symbol list gives INPUT', () => {
    expect(buildInstances([], lookup({ key: '', page: 0, x: 0, width: 16, height: 16 }))).toEqual(invalid);
  });
  it('G-R1g reserved without width: an empty symbol list gives INPUT', () => {
    expect(buildInstances([], lookup({ key: '', page: 0, x: 0, y: 0, height: 16 }))).toEqual(invalid);
  });
  it('G-R1h reserved without height: an empty symbol list gives INPUT', () => {
    expect(buildInstances([], lookup({ key: '', page: 0, x: 0, y: 0, width: 16 }))).toEqual(invalid);
  });
});

describe('gap closure 0.11: draw order and function-valued atlas', () => {
  const lookup = { pageSize: 64, reserved: { key: '', page: 0, x: 0, y: 0, width: 16, height: 16 }, placements: [], oversize: [] };
  it('draw order permutes records: slot k holds order[k]', () => {
    const a = sym({ position: { x: 5, y: 6 }, zIndex: 1 }, { a: 1 });
    const b = sym({ position: { x: 7, y: 8 }, zIndex: 0 }, { a: 2 });
    const v = buildInstances([a, b], lookup);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Array.from(v.order)).toEqual([1, 0]);
    expect(v.records[4]).toBe(7);
    expect(v.records[5]).toBe(8);
    expect(v.records[11]).toBe(0);
    expect(v.records[12]).toBe(1);
    expect(v.records[13]).toBe(1);
    expect(v.records[14]).toBe(1);
    expect(v.records[20]).toBe(5);
    expect(v.records[21]).toBe(6);
  });
  it('function-valued atlas gives invalid atlas', () => {
    const fn = Object.assign(function () {}, lookup);
    expect(buildInstances([], fn as never)).toEqual({ ok: false, code: 'INPUT', message: 'I1: invalid atlas' });
  });
});

describe('gap closure 0.11 (residual): placeholder uv from a non-square reserved block', () => {
  it('fills the uv slots in order x, y, width, height, page (hand-derived)', () => {
    const lookup: AtlasLookup = {
      pageSize: 64,
      reserved: { key: '', page: 1, x: 3, y: 5, width: 16, height: 8 },
      placements: [],
      oversize: [],
    };
    const sym: SymbolInput = {
      position: { x: 7, y: 9 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      zIndex: 0,
      offset: { x: 0, y: 0 },
      mirror: false,
      texture: {},
      sample: null,
      customColors: null,
    };
    const v = buildInstances([sym], lookup);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Array.from(v.records)).toEqual([1, 0, 0, 1, 7, 9, 3, 5, 16, 8, 1, 0, 1, 1, 1, 0]);
  });
});
