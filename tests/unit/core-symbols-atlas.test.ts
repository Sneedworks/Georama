import { describe, expect, it } from 'vitest';
import type { AtlasItem, AtlasOptions } from '../../src/core/symbols/atlas.ts';
import { RESERVED_BLOCK, packAtlas } from '../../src/core/symbols/atlas.ts';

function opts(over: Partial<AtlasOptions> = {}): AtlasOptions {
  return { maxSide: 64, maxPages: 1, padding: 1, ...over };
}

describe('A4 reserved block (A4)', () => {
  it('RESERVED_BLOCK is 16', () => {
    expect(RESERVED_BLOCK).toBe(16);
  });
});

describe('E1 packing with padding (A3/A4)', () => {
  it('exact placements E1', () => {
    const items: AtlasItem[] = [
      { key: 'c', width: 10, height: 10 },
      { key: 'a', width: 20, height: 30 },
      { key: 'b', width: 20, height: 30 },
    ];
    const v = packAtlas(items, { maxSide: 64, maxPages: 1, padding: 1 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pageSize).toBe(64);
    expect(v.pages).toBe(1);
    expect(v.oversize).toEqual([]);
    expect(v.reserved).toEqual({ key: '', page: 0, x: 0, y: 0, width: 16, height: 16 });
    expect(v.placements).toEqual([
      { key: 'a', page: 0, x: 17, y: 0, width: 20, height: 30 },
      { key: 'b', page: 0, x: 38, y: 0, width: 20, height: 30 },
      { key: 'c', page: 0, x: 17, y: 31, width: 10, height: 10 },
    ]);
  });
});

describe('E2 new pages (A3/A4)', () => {
  it('exact placements E2', () => {
    const items: AtlasItem[] = [
      { key: 'd', width: 20, height: 20 },
      { key: 'e', width: 20, height: 20 },
    ];
    const v = packAtlas(items, { maxSide: 32, maxPages: 3, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pageSize).toBe(32);
    expect(v.pages).toBe(3);
    expect(v.oversize).toEqual([]);
    expect(v.placements).toEqual([
      { key: 'd', page: 1, x: 0, y: 0, width: 20, height: 20 },
      { key: 'e', page: 2, x: 0, y: 0, width: 20, height: 20 },
    ]);
  });
});

describe('E3 limit (A3)', () => {
  it('E2 with maxPages 2 gives LIMIT', () => {
    const items: AtlasItem[] = [
      { key: 'd', width: 20, height: 20 },
      { key: 'e', width: 20, height: 20 },
    ];
    const v = packAtlas(items, { maxSide: 32, maxPages: 2, padding: 0 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('LIMIT');
    expect(typeof v.message).toBe('string');
  });
});

describe('E4 oversize (A2/A4)', () => {
  it('exact result E4', () => {
    const items: AtlasItem[] = [
      { key: 'f', width: 33, height: 8 },
      { key: 'g', width: 8, height: 8 },
    ];
    const v = packAtlas(items, { maxSide: 32, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.oversize).toEqual(['f']);
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([{ key: 'g', page: 0, x: 16, y: 0, width: 8, height: 8 }]);
  });

  it('oversize keys sorted ascending', () => {
    const items: AtlasItem[] = [
      { key: 'zebra', width: 100, height: 100 },
      { key: 'apple', width: 100, height: 5 },
      { key: 'mango', width: 5, height: 100 },
      { key: 'ok1', width: 8, height: 8 },
    ];
    const v = packAtlas(items, { maxSide: 32, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.oversize).toEqual(['apple', 'mango', 'zebra']);
  });
});

describe('A1 INPUT table (A1)', () => {
  it('more than 1000000 items gives INPUT without iterating', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sparse = new Array(1_000_001) as unknown as readonly AtlasItem[];
    const v = packAtlas(sparse, opts());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toContain('A1');
  });

  it('bad options give INPUT', () => {
    const good: AtlasItem[] = [{ key: 'k', width: 8, height: 8 }];
    const bad: AtlasOptions[] = [
      { maxSide: 31, maxPages: 1, padding: 0 },
      { maxSide: 16385, maxPages: 1, padding: 0 },
      { maxSide: 32.5, maxPages: 1, padding: 0 },
      { maxSide: Number.NaN, maxPages: 1, padding: 0 },
      { maxSide: 64, maxPages: 0, padding: 0 },
      { maxSide: 64, maxPages: -1, padding: 0 },
      { maxSide: 64, maxPages: 1.5, padding: 0 },
      { maxSide: 64, maxPages: 1, padding: -1 },
      { maxSide: 64, maxPages: 1, padding: 0.5 },
    ];
    for (const o of bad) {
      const v = packAtlas(good, o);
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.code).toBe('INPUT');
      expect(v.message).toContain('A1');
    }
  });

  it('bad items give INPUT in input order', () => {
    const badLists: AtlasItem[][] = [
      [{ key: '', width: 8, height: 8 }],
      [{ key: 42 as unknown as string, width: 8, height: 8 }],
      [{ key: 'k', width: 0, height: 8 }],
      [{ key: 'k', width: -2, height: 8 }],
      [{ key: 'k', width: 8.5, height: 8 }],
      [{ key: 'k', width: 8, height: 0 }],
      [{ key: 'k', width: 8, height: Number.NaN }],
      [
        { key: 'dup', width: 8, height: 8 },
        { key: 'dup', width: 8, height: 8 },
      ],
    ];
    for (const items of badLists) {
      const v = packAtlas(items, opts({ maxSide: 64, maxPages: 4, padding: 0 }));
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.code).toBe('INPUT');
      expect(v.message).toContain('A1');
    }
  });

  it('messages name the rule never a value', () => {
    const v = packAtlas([{ key: 'secret_key_zzz', width: 0, height: 8 }], opts());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain('A1');
    expect(v.message).not.toContain('secret_key_zzz');
  });

  it('empty items are valid', () => {
    const v = packAtlas([], opts());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([]);
    expect(v.oversize).toEqual([]);
  });
});

describe('sort order and determinism (A3)', () => {
  it('sorts by height desc then width desc then key asc', () => {
    const items: AtlasItem[] = [
      { key: 'k2', width: 30, height: 10 },
      { key: 'k1', width: 10, height: 20 },
      { key: 'k3', width: 10, height: 20 },
      { key: 'k0', width: 40, height: 20 },
    ];
    const v = packAtlas(items, { maxSide: 128, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.placements.map((p) => p.key)).toEqual(['k0', 'k1', 'k3', 'k2']);
  });

  it('shuffled input gives identical placements', () => {
    const base: AtlasItem[] = [
      { key: 'a', width: 20, height: 30 },
      { key: 'b', width: 20, height: 30 },
      { key: 'c', width: 10, height: 10 },
      { key: 'd', width: 12, height: 14 },
    ];
    const o: AtlasOptions = { maxSide: 64, maxPages: 4, padding: 1 };
    const v1 = packAtlas(base, o);
    const v2 = packAtlas([...base].reverse(), o);
    const v3 = packAtlas([base[2] as AtlasItem, base[0] as AtlasItem, base[3] as AtlasItem, base[1] as AtlasItem], o);
    expect(v1).toEqual(v2);
    expect(v1).toEqual(v3);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('seeded set of 300 invented sizes (A3/A4)', () => {
  it('non-overlap and bounds, reserved never overlapped', () => {
    const rand = mulberry32(20261020);
    const items: AtlasItem[] = [];
    for (let i = 0; i < 300; i += 1) {
      const w = 1 + Math.floor(rand() * 40);
      const h = 1 + Math.floor(rand() * 40);
      items.push({ key: `seed_${i.toString().padStart(3, '0')}`, width: w, height: h });
    }
    const maxSide = 64;
    const padding = 1;
    const v = packAtlas(items, { maxSide, maxPages: 64, padding });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.oversize).toEqual([]);
    expect(v.placements.length).toBe(300);
    // bounds
    for (const p of v.placements) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(maxSide);
      expect(p.y + p.height).toBeLessThanOrEqual(maxSide);
    }
    // non-overlap per page, including reserved on page 0
    const boxes = (page: number): Array<{ x: number; y: number; w: number; h: number }> => {
      const out: Array<{ x: number; y: number; w: number; h: number }> = [];
      if (page === 0) out.push({ x: 0, y: 0, w: 16, h: 16 });
      for (const p of v.placements) {
        if (p.page === page) out.push({ x: p.x, y: p.y, w: p.width, h: p.height });
      }
      return out;
    };
    for (let page = 0; page < v.pages; page += 1) {
      const list = boxes(page);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const a = list[i] as { x: number; y: number; w: number; h: number };
          const b = list[j] as { x: number; y: number; w: number; h: number };
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });
});

describe('correction 1 mutation gaps (atlas)', () => {
  const RES0 = { key: '', page: 0, x: 0, y: 0, width: 16, height: 16 };

  it('G1: one million items gives invalid key', () => {
    const sparse = new Array(1_000_000) as unknown as readonly AtlasItem[];
    const v = packAtlas(sparse, { maxSide: 64, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('A1: invalid key');
  });

  it('G1: more than one million items gives too many items', () => {
    const sparse = new Array(1_000_001) as unknown as readonly AtlasItem[];
    const v = packAtlas(sparse, { maxSide: 64, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe('INPUT');
    expect(v.message).toEqual('A1: too many items');
  });

  it('G2: maxSide upper bound 16384 packs', () => {
    const v = packAtlas([{ key: 'a', width: 1, height: 1 }], { maxSide: 16384, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pageSize).toBe(16384);
    expect(v.pages).toBe(1);
    expect(v.reserved).toEqual(RES0);
    expect(v.placements).toEqual([{ key: 'a', page: 0, x: 16, y: 0, width: 1, height: 1 }]);
    expect(v.oversize).toEqual([]);
  });

  it('G3: exact-size item uses a fresh page', () => {
    const v = packAtlas([{ key: 'exact', width: 32, height: 32 }], { maxSide: 32, maxPages: 2, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(2);
    expect(v.placements).toEqual([{ key: 'exact', page: 1, x: 0, y: 0, width: 32, height: 32 }]);
    expect(v.oversize).toEqual([]);
  });

  it('G3: tall item fits beside the reserved block', () => {
    const v = packAtlas([{ key: 'tall', width: 8, height: 32 }], { maxSide: 32, maxPages: 1, padding: 0 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([{ key: 'tall', page: 0, x: 16, y: 0, width: 8, height: 32 }]);
    expect(v.oversize).toEqual([]);
  });

  it('G4: exact fit on a shelf', () => {
    const v = packAtlas(
      [
        { key: 'a', width: 20, height: 10 },
        { key: 'b', width: 28, height: 10 },
      ],
      { maxSide: 64, maxPages: 1, padding: 0 },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([
      { key: 'b', page: 0, x: 16, y: 0, width: 28, height: 10 },
      { key: 'a', page: 0, x: 44, y: 0, width: 20, height: 10 },
    ]);
    expect(v.oversize).toEqual([]);
  });

  it('G5: exact fit on a new shelf on both axes', () => {
    const v = packAtlas(
      [
        { key: 'c', width: 16, height: 16 },
        { key: 'd', width: 16, height: 16 },
      ],
      { maxSide: 32, maxPages: 2, padding: 0 },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([
      { key: 'c', page: 0, x: 16, y: 0, width: 16, height: 16 },
      { key: 'd', page: 0, x: 16, y: 16, width: 16, height: 16 },
    ]);
    expect(v.oversize).toEqual([]);
  });

  it('G6: non-array inputs give INPUT', () => {
    const values: unknown[] = [undefined, null, 'abc', {}];
    for (const value of values) {
      const v = packAtlas(value as unknown as readonly AtlasItem[], { maxSide: 64, maxPages: 1, padding: 0 });
      expect(v.ok).toBe(false);
      if (v.ok) continue;
      expect(v.code).toBe('INPUT');
    }
  });

  it('G7: oversize order is ascending', () => {
    const v = packAtlas(
      [
        { key: 'd', width: 33, height: 1 },
        { key: 'a', width: 1, height: 33 },
        { key: 'c', width: 40, height: 1 },
        { key: 'b', width: 1, height: 40 },
      ],
      { maxSide: 32, maxPages: 1, padding: 0 },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([]);
    expect(v.oversize).toEqual(['a', 'b', 'c', 'd']);
  });

  it('G8: key tie-break is ascending', () => {
    const v = packAtlas(
      [
        { key: 'b', width: 20, height: 10 },
        { key: 'a', width: 20, height: 10 },
      ],
      { maxSide: 64, maxPages: 1, padding: 0 },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([
      { key: 'a', page: 0, x: 16, y: 0, width: 20, height: 10 },
      { key: 'b', page: 0, x: 36, y: 0, width: 20, height: 10 },
    ]);
    expect(v.oversize).toEqual([]);
  });

  it('G9: second shelf and fresh-page top', () => {
    const v = packAtlas(
      [
        { key: 'p', width: 20, height: 20 },
        { key: 's', width: 20, height: 8 },
        { key: 't', width: 10, height: 10 },
      ],
      { maxSide: 32, maxPages: 3, padding: 0 },
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(2);
    expect(v.placements).toEqual([
      { key: 'p', page: 1, x: 0, y: 0, width: 20, height: 20 },
      { key: 't', page: 1, x: 20, y: 0, width: 10, height: 10 },
      { key: 's', page: 1, x: 0, y: 20, width: 20, height: 8 },
    ]);
    expect(v.oversize).toEqual([]);
  });
});

describe('gap closure 0.11: fresh page padding and non-array message', () => {
  it('fresh page with padding: first item at 0, continuation at width plus padding', () => {
    const v = packAtlas([{ key: 'a', width: 20, height: 20 }, { key: 'b', width: 8, height: 8 }], { maxSide: 32, maxPages: 2, padding: 1 });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(2);
    expect(v.placements).toEqual([
      { key: 'a', page: 1, x: 0, y: 0, width: 20, height: 20 },
      { key: 'b', page: 1, x: 21, y: 0, width: 8, height: 8 },
    ]);
  });
  it('non-array items give the items rule', () => {
    expect(packAtlas(null as never, opts())).toEqual({ ok: false, code: 'INPUT', message: 'A1: invalid items' });
  });
});

describe('gap closure 0.11 (residual): same-shelf gutter', () => {
  it('pads the next item on a shelf (B 17 + 25 + 1 = 43; A 43 + 20 + 1 = 64 leaves no room, so C wraps to y 10 + 1 = 11)', () => {
    const v = packAtlas(
      [
        { key: 'B', width: 25, height: 10 },
        { key: 'A', width: 20, height: 10 },
        { key: 'C', width: 1, height: 5 },
      ],
      opts({ maxSide: 64, maxPages: 1, padding: 1 }),
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.placements).toEqual([
      { key: 'B', page: 0, x: 17, y: 0, width: 25, height: 10 },
      { key: 'A', page: 0, x: 43, y: 0, width: 20, height: 10 },
      { key: 'C', page: 0, x: 17, y: 11, width: 1, height: 5 },
    ]);
  });
  it('pads every item after the first on a shelf (x 18, 25, 32; the fourth wraps to y 5 + 2 = 7)', () => {
    const v = packAtlas(
      [
        { key: 'P', width: 5, height: 5 },
        { key: 'Q', width: 5, height: 5 },
        { key: 'R', width: 5, height: 5 },
        { key: 'S', width: 5, height: 5 },
      ],
      opts({ maxSide: 40, maxPages: 1, padding: 2 }),
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pages).toBe(1);
    expect(v.placements).toEqual([
      { key: 'P', page: 0, x: 18, y: 0, width: 5, height: 5 },
      { key: 'Q', page: 0, x: 25, y: 0, width: 5, height: 5 },
      { key: 'R', page: 0, x: 32, y: 0, width: 5, height: 5 },
      { key: 'S', page: 0, x: 18, y: 7, width: 5, height: 5 },
    ]);
  });
});
