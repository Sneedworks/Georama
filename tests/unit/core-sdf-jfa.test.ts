import { describe, expect, it } from 'vitest';
import { jumpFloodReference, validateClassGrid } from '../../src/core/sdf/jfa.ts';

describe('jfa hand example outline', () => {
  it('marks the coast around a single land texel', () => {
    const width = 4;
    const height = 3;
    const land = new Uint8Array(width * height);
    land[1 * width + 1] = 1;
    const result = jumpFloodReference({ width, height, land });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = [
      [0, 255, 0, 0],
      [255, 255, 255, 0],
      [0, 255, 0, 0],
    ];
    const want = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        want[y * width + x] = rows[y][x];
      }
    }
    expect(Array.from(result.outline)).toEqual(Array.from(want));
  });
});

describe('jfa hand example seeds', () => {
  it('propagates the nearest coast seed with the (dsq, cy, cx) tie rule', () => {
    const width = 4;
    const height = 3;
    const land = new Uint8Array(width * height);
    land[1 * width + 1] = 1;
    const result = jumpFloodReference({ width, height, land });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pairs: ReadonlyArray<readonly [number, number]> = [
      [1, 0], [1, 0], [1, 0], [2, 1],
      [0, 1], [1, 1], [2, 1], [2, 1],
      [0, 1], [1, 2], [2, 1], [2, 1],
    ];
    const want = new Uint16Array(2 * width * height);
    for (let i = 0; i < pairs.length; i++) {
      want[2 * i] = pairs[i][0];
      want[2 * i + 1] = pairs[i][1];
    }
    expect(Array.from(result.seeds)).toEqual(Array.from(want));
  });
});

describe('jfa validate INPUT rules', () => {
  it('rejects width 0', () => {
    const grid = { width: 0, height: 2, land: new Uint8Array(0) };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('rejects non-integer height', () => {
    const grid = { width: 2, height: 1.5, land: new Uint8Array(3) };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('rejects a land value that is not a Uint8Array', () => {
    const grid = {
      width: 2,
      height: 1,
      land: [0, 1] as unknown as Uint8Array,
    };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('rejects a land array of the wrong length', () => {
    const grid = { width: 2, height: 2, land: new Uint8Array(3) };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('rejects a land value other than 0 or 1', () => {
    const grid = { width: 2, height: 1, land: new Uint8Array([0, 2]) };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });
});

describe('jfa validate LIMIT rules', () => {
  it('rejects width above 16384', () => {
    const width = 16385;
    const height = 1;
    const grid = { width, height, land: new Uint8Array(width * height) };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('LIMIT');
  });

  it('rejects height above 16384', () => {
    const width = 1;
    const height = 16385;
    const grid = { width, height, land: new Uint8Array(width * height) };
    const check = validateClassGrid(grid);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('LIMIT');
  });
});

describe('jfa edge grids', () => {
  it('empty grid has no coast and no seeds', () => {
    const width = 2;
    const height = 3;
    const verdict = jumpFloodReference({ width, height, land: new Uint8Array(width * height) });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(Array.from(verdict.outline)).toEqual(Array.from(new Uint8Array(width * height)));
    expect(Array.from(verdict.seeds)).toEqual(Array.from(new Uint16Array(2 * width * height).fill(65535)));
  });

  it('all-land grid has no coast and no seeds', () => {
    const width = 3;
    const height = 2;
    const verdict = jumpFloodReference({ width, height, land: new Uint8Array(width * height).fill(1) });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(Array.from(verdict.outline)).toEqual(Array.from(new Uint8Array(width * height)));
    expect(Array.from(verdict.seeds)).toEqual(Array.from(new Uint16Array(2 * width * height).fill(65535)));
  });

  it('all-water grid has no coast and no seeds', () => {
    const width = 4;
    const height = 4;
    const verdict = jumpFloodReference({ width, height, land: new Uint8Array(width * height) });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(Array.from(verdict.outline)).toEqual(Array.from(new Uint8Array(width * height)));
    expect(Array.from(verdict.seeds)).toEqual(Array.from(new Uint16Array(2 * width * height).fill(65535)));
  });

  it('1x1 water has no coast and no seed', () => {
    const verdict = jumpFloodReference({ width: 1, height: 1, land: new Uint8Array([0]) });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(Array.from(verdict.outline)).toEqual([0]);
    expect(Array.from(verdict.seeds)).toEqual([65535, 65535]);
  });

  it('1x1 land has no coast and no seed', () => {
    const verdict = jumpFloodReference({ width: 1, height: 1, land: new Uint8Array([1]) });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(Array.from(verdict.outline)).toEqual([0]);
    expect(Array.from(verdict.seeds)).toEqual([65535, 65535]);
  });
});

describe('jfa determinism', () => {
  it('returns identical output on repeated calls', () => {
    const width = 6;
    const height = 5;
    let state = 11;
    const land = new Uint8Array(width * height);
    for (let i = 0; i < land.length; i++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      land[i] = state % 3 === 0 ? 1 : 0;
    }
    const first = jumpFloodReference({ width, height, land });
    const second = jumpFloodReference({ width, height, land });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(Array.from(second.outline)).toEqual(Array.from(first.outline));
    expect(Array.from(second.seeds)).toEqual(Array.from(first.seeds));
  });

  it('does not mutate the input land array', () => {
    const width = 5;
    const height = 4;
    const land = new Uint8Array([0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 0]);
    const before = Array.from(land);
    const verdict = jumpFloodReference({ width, height, land });
    expect(verdict.ok).toBe(true);
    expect(Array.from(land)).toEqual(before);
  });
});

describe('jfa seeded properties against a naive oracle', () => {
  function lcgNext(state: number): number {
    return (state * 1103515245 + 12345) & 0x7fffffff;
  }

  function makeLand(width: number, height: number, seed: number): Uint8Array {
    const land = new Uint8Array(width * height);
    let state = seed;
    for (let i = 0; i < land.length; i++) {
      state = lcgNext(state);
      land[i] = state % 2;
    }
    return land;
  }

  // Independent oracle: a naive implementation of the same section-3 rules
  // (fresh per-pass state, explicit candidate lists, sort by the key).
  // It shares no propagation code with the reference; it agrees byte for
  // byte even where jump flooding only approximates the nearest seed.
  function naiveJfa(
    width: number,
    height: number,
    land: Uint8Array,
  ): { seeds: Uint16Array; outline: Uint8Array } {
    const outline = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        const v = land[p];
        const coast =
          (x > 0 && land[p - 1] !== v) ||
          (x + 1 < width && land[p + 1] !== v) ||
          (y > 0 && land[p - width] !== v) ||
          (y + 1 < height && land[p + width] !== v);
        outline[p] = coast ? 255 : 0;
      }
    }
    let state: Array<{ cx: number; cy: number } | null> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        state.push(outline[y * width + x] === 255 ? { cx: x, cy: y } : null);
      }
    }
    const side = width > height ? width : height;
    const passes = side <= 1 ? 0 : Math.ceil(Math.log2(side));
    for (let k = passes - 1; k >= 0; k--) {
      const s = 2 ** k;
      const next: Array<{ cx: number; cy: number } | null> = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cands: Array<{ cx: number; cy: number }> = [];
          const self = state[y * width + x];
          if (self !== null) cands.push(self);
          for (const dy of [-s, 0, s]) {
            for (const dx of [-s, 0, s]) {
              if (dx === 0 && dy === 0) continue;
              const qx = x + dx;
              const qy = y + dy;
              if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
              const c = state[qy * width + qx];
              if (c !== null) cands.push(c);
            }
          }
          if (cands.length === 0) {
            next.push(null);
          } else {
            const scored = cands.map((c) => ({
              dsq: (c.cx - x) * (c.cx - x) + (c.cy - y) * (c.cy - y),
              cy: c.cy,
              cx: c.cx,
            }));
            scored.sort((a, b) => a.dsq - b.dsq || a.cy - b.cy || a.cx - b.cx);
            next.push({ cx: scored[0].cx, cy: scored[0].cy });
          }
        }
      }
      state = next;
    }
    const seeds = new Uint16Array(2 * width * height);
    for (let p = 0; p < width * height; p++) {
      const c = state[p];
      seeds[2 * p] = c === null ? 65535 : c.cx;
      seeds[2 * p + 1] = c === null ? 65535 : c.cy;
    }
    return { seeds, outline };
  }

  const shapes: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [2, 2],
    [3, 5],
    [5, 3],
    [7, 1],
    [1, 6],
    [8, 8],
    [9, 7],
    [13, 11],
    [17, 13],
    [24, 24],
    [24, 7],
    [7, 24],
  ];
  const seedsPerShape = 4;

  it.each(shapes)('matches the naive oracle on %sx%s grids', (width, height) => {
    for (let s = 0; s < seedsPerShape; s++) {
      const land = makeLand(width, height, 1000 * (width * 131 + height) + 77 * s + 13);
      const got = jumpFloodReference({ width, height, land });
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      const want = naiveJfa(width, height, land);
      expect(Array.from(got.outline)).toEqual(Array.from(want.outline));
      expect(Array.from(got.seeds)).toEqual(Array.from(want.seeds));
    }
  });

  it('outline holds only 0 or 255 and seeds stay in range', () => {
    const width = 21;
    const height = 19;
    const land = makeLand(width, height, 424242);
    const got = jumpFloodReference({ width, height, land });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    for (const v of got.outline) {
      expect(v === 0 || v === 255).toBe(true);
    }
    for (let p = 0; p < width * height; p++) {
      const cx = got.seeds[2 * p];
      const cy = got.seeds[2 * p + 1];
      if (cx === 65535) {
        expect(cy).toBe(65535);
      } else {
        expect(cx).toBeLessThan(width);
        expect(cy).toBeLessThan(height);
      }
    }
  });
});

describe('jfa reference verdict passthrough', () => {
  it('returns the failing INPUT check unchanged', () => {
    const grid = { width: 2, height: 2, land: new Uint8Array(3) };
    const verdict = jumpFloodReference(grid);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('INPUT');
  });

  it('returns the failing LIMIT check unchanged', () => {
    const width = 16385;
    const height = 1;
    const grid = { width, height, land: new Uint8Array(width * height) };
    const verdict = jumpFloodReference(grid);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('LIMIT');
  });
});

describe('jfa strength: mutation gap classes', () => {
  it('coast with only the bottom neighbour differs (row H-2)', () => {
    const v = jumpFloodReference({ width: 1, height: 2, land: new Uint8Array([1, 0]) });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Array.from(v.outline)).toEqual([255, 255]);
    expect(Array.from(v.seeds)).toEqual([0, 0, 0, 1]);
  });

  it('accepts width and height at exactly 16384', () => {
    expect(validateClassGrid({ width: 16384, height: 1, land: new Uint8Array(16384) }).ok).toBe(true);
    expect(validateClassGrid({ width: 1, height: 16384, land: new Uint8Array(16384) }).ok).toBe(true);
  });

  it('refuses a null or undefined grid as INPUT without throwing', () => {
    const raws: ReadonlyArray<unknown> = [null, undefined];
    for (const raw of raws) {
      const g = raw as unknown as Parameters<typeof validateClassGrid>[0];
      expect(() => validateClassGrid(g)).not.toThrow();
      const check = validateClassGrid(g);
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.code).toBe('INPUT');
      const h = raw as unknown as Parameters<typeof jumpFloodReference>[0];
      expect(() => jumpFloodReference(h)).not.toThrow();
      const verdict = jumpFloodReference(h);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.code).toBe('INPUT');
    }
  });

  it('rejects a width that is not an integer', () => {
    const check = validateClassGrid({ width: 1.5, height: 2, land: new Uint8Array(3) });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('rejects height 0', () => {
    const check = validateClassGrid({ width: 2, height: 0, land: new Uint8Array(0) });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('rejects an invalid first land value', () => {
    const check = validateClassGrid({ width: 2, height: 1, land: new Uint8Array([2, 0]) });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.code).toBe('INPUT');
  });

  it('breaks an equal-distance, equal-row tie by the smaller x (key dsq, cy, cx) on the 5 by 4 witness', () => {
    // Land rows y = 0..3: 11111 / 01111 / 01111 / 00010, row-major, width 5.
    // Texel (3,1): candidates (4,2) and (2,2) both sit at dsq 2 with cy 2; the key (dsq, cy, cx) picks
    // the smaller cx, so the seed is (2,2). A candidate order that ignores cx keeps (4,2).
    const width = 5;
    const height = 4;
    const rows = ['11111', '01111', '01111', '00010'];
    const land = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        land[y * width + x] = rows[y][x] === '1' ? 1 : 0;
      }
    }
    const v = jumpFloodReference({ width, height, land });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Array.from(v.outline)).toEqual([255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 255, 255, 255]);
    expect(Array.from(v.seeds)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 4, 2, 0, 1, 1, 1, 1, 1, 2, 2, 4, 2, 0, 2, 1, 2, 2, 2, 2, 2, 4, 2, 0, 2, 1, 3, 2, 3, 3, 3, 4, 3]);
    expect([v.seeds[16], v.seeds[17]]).toEqual([2, 2]);
  });
});
