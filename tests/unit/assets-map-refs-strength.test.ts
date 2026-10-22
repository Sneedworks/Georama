import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { collectMapAssetRefs } from '../../src/core/assets/map-refs.ts';
import type { MapAssetInput, MapAssetGroup } from '../../src/core/assets/map-refs.ts';
import { GdObject } from '../../src/core/formats/godot-var.ts';

const pool = ['', 'a', 'z', 'Z', 'A', 'é', 'e' + String.fromCharCode(0x301), '  spaced  ', '%2e%2e', 'x%2Fy', '__proto__', 'constructor', 'kind' + String.fromCharCode(0) + 'ref', '😀', String.fromCharCode(0xd800), 'x#y?z', 'x/y', 'A:B', 'p' + String.fromCharCode(0x5c) + 'q', String.fromCharCode(10), '.', '..', 'x'.repeat(600)];
let seed = 0x6789abcd;
function rand(n: number): number { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; }
function model(n: number) {
  const image = new GdObject('ImageTexture', []);
  return {
    theme: { waterTexture: pool[rand(pool.length)], groundTexture: pool[rand(pool.length)] },
    frame: { texture: pool[rand(pool.length)], enabled: false },
    paths: Array.from({ length: n }, () => ({ style: pool[rand(pool.length)] })),
    territories: { territories: Array.from({ length: n }, () => ({ style: pool[rand(pool.length)] })) },
    symbols: Array.from({ length: n }, (_, i) => ({ texture: i % 5 === 0 ? image : pool[rand(pool.length)] })),
  };
}
function oracle(m: MapAssetInput) {
  const rows: Array<[string, string, string]> = [
    ['water-texture', m.theme.waterTexture, '/theme/water_texture'],
    ['ground-texture', m.theme.groundTexture, '/theme/ground_texture'],
    ['frame-texture', m.frame.texture, '/frame/texture'],
    ...m.paths.map((x, i): [string, string, string] => ['path-style', x.style, `/paths/${i}/style`]),
    ...m.territories.territories.map((x, i): [string, string, string] => ['border-style', x.style, `/territories/territories/${i}/style`]),
  ];
  const embedded: string[] = [];
  m.symbols.forEach((x, i) => { if (typeof x.texture === 'string') rows.push(['symbol', x.texture, `/symbols/${i}/texture`]); else embedded.push(`/symbols/${i}/texture`); });
  const groups: Array<{kind: string; reference: string; locations: string[]}> = [];
  // Independent brute-force grouping, fixed spec-kind order and native primitive-string sorting.
  for (const kind of ['border-style', 'frame-texture', 'ground-texture', 'path-style', 'symbol', 'water-texture']) {
    const refs = [...new Set(rows.filter(r => r[0] === kind).map(r => r[1]))].sort();
    for (const reference of refs) groups.push({ kind, reference, locations: rows.filter(r => r[0] === kind && r[1] === reference).map(r => r[2]) });
  }
  return { groups, embeddedSymbolLocations: embedded };
}

describe('parent map reference strength', () => {
  it('matches independent whole-output oracle across shuffled, repeated, unicode and sort-run-boundary inputs', () => {
    for (const size of [0, 1, 2, 31, 32, 33, 63, 64, 65, 127, 128, 257]) for (let repeat = 0; repeat < 4; repeat++) {
      const input = model(size);
      assert.deepEqual(collectMapAssetRefs(input), oracle(input));
    }
    const input = model(0);
    input.paths = pool.map(style => ({ style }));
    input.symbols = pool.map(texture => ({ texture }));
    assert.deepEqual(collectMapAssetRefs(input), oracle(input));
  });

  it('does not freeze any caller-owned record, list, nested element or embedded object and does not retain them', () => {
    const input = model(16);
    const before = new Map<object, boolean>();
    function visit(v: unknown): void { if (v === null || typeof v !== 'object' || before.has(v)) return; before.set(v, Object.isFrozen(v)); for (const child of Object.values(v)) visit(child); }
    visit(input);
    const expected = oracle(input);
    const first = collectMapAssetRefs(input);
    for (const [obj, frozen] of before) assert.equal(Object.isFrozen(obj), frozen);
    input.theme.waterTexture = 'changed-after-collection';
    input.frame.texture = 'changed-frame';
    input.paths.splice(0);
    input.territories.territories[0].style = 'changed-border';
    input.symbols.splice(0);
    assert.deepEqual(first, expected);
    const second = collectMapAssetRefs(input);
    assert.deepEqual(second, oracle(input));
    assert.notEqual(second, first);
    assert.notEqual(second.groups, first.groups);
    assert.notEqual(second.embeddedSymbolLocations, first.embeddedSymbolLocations);
  });

  it('treats shared embedded ImageTexture contents as opaque without inspecting or serializing them', () => {
    const touched: string[] = [];
    const embedded = new Proxy(new GdObject('ImageTexture', []), {
      get(target, key, receiver) { touched.push(String(key)); return Reflect.get(target, key, receiver); },
      ownKeys(target) { touched.push('ownKeys'); return Reflect.ownKeys(target); },
    });
    const input = model(0);
    input.symbols = [{ texture: embedded }, { texture: 'external' }, { texture: embedded }];
    const output = collectMapAssetRefs(input);
    assert.deepEqual(touched, []);
    assert.deepEqual(output.embeddedSymbolLocations, ['/symbols/0/texture', '/symbols/2/texture']);
    assert.deepEqual(output.groups.filter(g => g.kind === 'symbol'), [{ kind: 'symbol', reference: 'external', locations: ['/symbols/1/texture'] }]);
  });

  it('supplies a conforming total-order comparator if it uses record sorting, including reflexivity and both directions', () => {
    const input = model(65);
    const original = Object.getOwnPropertyDescriptor(Array.prototype, 'sort');
    assert.ok(original);
    const nativeSort = original.value as (this: unknown[], cmp?: (a: unknown, b: unknown) => number) => unknown[];
    function sign(a: MapAssetGroup, b: MapAssetGroup): number {
      if (a.kind !== b.kind) return [a.kind, b.kind].sort()[0] === a.kind ? -1 : 1;
      if (a.reference !== b.reference) return [a.reference, b.reference].sort()[0] === a.reference ? -1 : 1;
      return 0;
    }
    // Audit the dependency's comparator contract, not its exact +/- magnitude or implementation strategy.
    try {
      Object.defineProperty(Array.prototype, 'sort', { ...original, value: function (this: unknown[], cmp?: (a: unknown, b: unknown) => number) {
        const records = this.length > 0 && this.every(x => x !== null && typeof x === 'object' && 'kind' in x && 'reference' in x && 'locations' in x);
        if (records && cmp) for (const a of this) for (const b of this) assert.equal(Math.sign(cmp(a, b)), sign(a as MapAssetGroup, b as MapAssetGroup));
        return Reflect.apply(nativeSort, this, [cmp]);
      } });
      assert.deepEqual(collectMapAssetRefs(input), oracle(input));
    } finally { Object.defineProperty(Array.prototype, 'sort', original); }
  });
});
