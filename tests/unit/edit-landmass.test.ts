// Card 2.5, detail v3.1 (75cb9a9): acceptance tests A1-A10 for the landmass brush.
// Imports src/core/edit/landmass.ts (GREEN 69fc71b; RED revision 10b95bb added A9 and A10).
// Test stacks use maxSteps 1000 and maxBytes 128 * 2^20 (detail section 4).
import { describe, expect, it } from 'vitest';
import { EditLayerStack } from '../../src/core/edit/layers.ts';
import { LAND, strokeWrites, type LandmassVerdict } from '../../src/core/edit/landmass.ts';
import type { CellWrite } from '../../src/core/edit/tile-command.ts';
import { TILE } from '../../src/core/edit/tiles.ts';

const BUDGET = { maxSteps: 1000, maxBytes: 128 * 2 ** 20 };

type AnyVerdict = { readonly ok: true; readonly value?: unknown } | { readonly ok: false; readonly code: string };

function codeOf(v: AnyVerdict): string {
  return v.ok ? 'ok' : v.code;
}

function must<T>(v: LandmassVerdict<T>): T {
  if (!v.ok) throw new Error(`verdict ${v.code}`);
  return v.value;
}

function done(v: AnyVerdict): void {
  if (!v.ok) throw new Error(`verdict ${v.code}`);
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function stack(width: number, height: number, channels = 1): EditLayerStack {
  return new EditLayerStack({ width, height, channels, ...BUDGET });
}

function cells(s: EditLayerStack, id: number): Uint8Array {
  const layer = s.layer(id);
  if (layer === undefined) throw new Error(`no layer ${id}`);
  return layer.grid.snapshot();
}

function strokeOn(
  points: Array<{ x: number; y: number }>,
  radius: number,
  paint: 'land' | 'water',
  width = 256,
  height = 256,
): LandmassVerdict<CellWrite[]> {
  return strokeWrites({ width, height, points, radius, paint });
}

describe('card 2.5 A1: disc painting', () => {
  it('a single-point land stroke paints the radius-1 disc, and a water stroke then clears those cells', () => {
    const s = stack(256, 256);
    done(s.writeTiles(1, must(strokeOn([{ x: 100, y: 100 }], 1, 'land'))));
    const disc: Array<[number, number]> = [
      [100, 100],
      [99, 100],
      [101, 100],
      [100, 99],
      [100, 101],
    ];
    const expected = new Uint8Array(256 * 256);
    for (const [x, y] of disc) {
      expected[y * 256 + x] = LAND;
    }
    expect(same(cells(s, 1), expected)).toBe(true);
    done(s.writeTiles(1, must(strokeOn([{ x: 100, y: 100 }], 1, 'water'))));
    expect(same(cells(s, 1), new Uint8Array(256 * 256))).toBe(true);
  });
});

describe('card 2.5 A2: coverage', () => {
  it('a horizontal stroke paints every path cell and the cells one row above and below', () => {
    const s = stack(256, 256);
    done(s.writeTiles(1, must(strokeOn([{ x: 10, y: 10 }, { x: 60, y: 10 }], 1, 'land'))));
    const bytes = cells(s, 1);
    for (let x = 10; x <= 60; x += 1) {
      expect(bytes[9 * 256 + x]).toBe(LAND);
      expect(bytes[10 * 256 + x]).toBe(LAND);
      expect(bytes[11 * 256 + x]).toBe(LAND);
    }
  });
});

describe('card 2.5 A3: clipping', () => {
  it('cells outside the layer are dropped; the in-layer disc cells of the stroke are painted', () => {
    const s = stack(256, 256);
    const v = strokeOn([{ x: -20, y: 5 }, { x: 5, y: 5 }], 2, 'land');
    expect(codeOf(v)).toBe('ok');
    const writes = must(v);
    for (const w of writes) {
      expect(w.x >= 0 && w.x < 256 && w.y >= 0 && w.y < 256).toBe(true);
    }
    done(s.writeTiles(1, writes));
    // Union of the radius-2 discs centred on the line y = 5, x from -20 to 5, restricted to x >= 0:
    // columns 0 to 5 cover rows 3 to 7; column 6 covers rows 4 to 6; column 7 covers row 5.
    const inUnion = (x: number, y: number): boolean => {
      if (x >= 0 && x <= 5) return y >= 3 && y <= 7;
      if (x === 6) return y >= 4 && y <= 6;
      if (x === 7) return y === 5;
      return false;
    };
    const expected = new Uint8Array(256 * 256);
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        if (inUnion(x, y)) expected[y * 256 + x] = LAND;
      }
    }
    expect(same(cells(s, 1), expected)).toBe(true);
    const far = strokeOn([{ x: -100, y: -100 }, { x: -90, y: -90 }], 3, 'land');
    expect(codeOf(far)).toBe('ok');
    expect(must(far)).toEqual([]);
    expect(codeOf(s.writeTiles(1, must(far)))).toBe('noop');
  });
});

describe('card 2.5 A4: refusals', () => {
  it('radius, width, coordinates and point count are checked and refused with their codes', () => {
    const one = [{ x: 5, y: 5 }];
    expect(codeOf(strokeOn(one, 0, 'land'))).toBe('range');
    expect(codeOf(strokeOn(one, 33, 'land'))).toBe('range');
    expect(codeOf(strokeOn(one, 1.5, 'land'))).toBe('range');
    expect(codeOf(strokeOn(one, 1, 'land', 0))).toBe('range');
    expect(codeOf(strokeOn([{ x: 1.5, y: 5 }], 1, 'land'))).toBe('range');
    expect(codeOf(strokeOn([], 1, 'land'))).toBe('range');
    const many = Array.from({ length: 513 }, (_, i) => ({ x: i, y: 5 }));
    expect(codeOf(strokeOn(many, 1, 'land'))).toBe('too-large');
  });
});

describe('card 2.5 A5: work bound', () => {
  it('512 points spaced 60 apart at radius 32 are refused by the work bound', () => {
    const s = stack(2 ** 16, 2 ** 7);
    const points = Array.from({ length: 512 }, (_, i) => ({ x: 60 * i, y: 50 }));
    expect(codeOf(strokeOn(points, 32, 'land', 2 ** 16, 2 ** 7))).toBe('too-large');
    expect(s.canUndo()).toBe(false);
  });
});

describe('card 2.5 A6: cell bound', () => {
  it('radius 32 is refused by the cell bound; radius 8 on the same stroke is ok and writes 2^5 tiles', () => {
    const size = 2 ** 12;
    const s = stack(size, size);
    const stroke = [{ x: 0, y: 50 }, { x: size + 4, y: 50 }];
    expect(codeOf(strokeOn(stroke, 32, 'land', size, size))).toBe('too-large');
    expect(s.canUndo()).toBe(false);
    const control = must(strokeOn(stroke, 8, 'land', size, size));
    expect(codeOf(s.writeTiles(1, control))).toBe('ok');
    const layer = s.layer(1);
    if (layer === undefined) throw new Error('no layer 1');
    let changed = 0;
    for (let i = 0; i < (size / TILE) * (size / TILE); i += 1) {
      const tile = layer.grid.tileBytes(i);
      if (tile !== null) {
        changed += 1;
        expect(tile.length).toBe(TILE * TILE);
      }
    }
    expect(changed).toBe(2 ** 5);
    expect(changed * TILE * TILE).toBeLessThanOrEqual(128 * 2 ** 20);
  });
});

describe('card 2.5 A7: undo and redo', () => {
  it('one undo, a second undo and two redos reproduce every cell exactly', () => {
    const s = stack(256, 256);
    const s0 = cells(s, 1);
    done(s.writeTiles(1, must(strokeOn([{ x: 100, y: 100 }], 8, 'land'))));
    const s1 = cells(s, 1);
    done(s.writeTiles(1, must(strokeOn([{ x: 104, y: 100 }], 8, 'water'))));
    const s2 = cells(s, 1);
    expect(same(s1, s0)).toBe(false);
    expect(same(s2, s1)).toBe(false);
    expect(s.undo().ok).toBe(true);
    expect(same(cells(s, 1), s1)).toBe(true);
    expect(s.undo().ok).toBe(true);
    expect(same(cells(s, 1), s0)).toBe(true);
    expect(s.redo().ok).toBe(true);
    expect(same(cells(s, 1), s1)).toBe(true);
    expect(s.redo().ok).toBe(true);
    expect(same(cells(s, 1), s2)).toBe(true);
  });
});

describe('card 2.5 A8: channels and layers', () => {
  it('a two-channel layer refuses the one-channel writes; an unknown layer id gives layer', () => {
    const writes = must(strokeOn([{ x: 5, y: 5 }], 1, 'land'));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((w) => w.channels === 1)).toBe(true);
    expect(codeOf(stack(256, 256, 2).writeTiles(1, writes))).toBe('channels');
    expect(codeOf(stack(256, 256).writeTiles(99, writes))).toBe('layer');
  });
});

describe('card 2.5 A9: walk steps', () => {
  it('a retracing stroke is refused too-large by its step count; the single segment over the same span is ok', () => {
    const size = 2 ** 12;
    const height = 2 ** 8;
    const span = 2 ** 11 + 2 ** 10;
    expect(codeOf(strokeOn([{ x: 0, y: 50 }, { x: span, y: 50 }], 32, 'land', size, height))).toBe('ok');
    const retrace = [{ x: 0, y: 50 }, { x: span, y: 50 }, { x: 0, y: 50 }];
    expect(codeOf(strokeOn(retrace, 32, 'land', size, height))).toBe('too-large');
  });
});

describe('card 2.5 A10: coordinate limit', () => {
  it('coordinates of magnitude up to 2^40 are accepted; beyond that, and non-integers, give range', () => {
    const size = 2 ** 41;
    const at = (x: number, y: number) => strokeOn([{ x, y }], 1, 'land', size, size);
    expect(must(at(2 ** 40, 0)).length).toBe(4);
    expect(must(at(-(2 ** 40), 0))).toEqual([]);
    expect(codeOf(at(2 ** 40 + 1, 0))).toBe('range');
    expect(codeOf(at(-(2 ** 40) - 1, 0))).toBe('range');
    expect(codeOf(at(1.5, 0))).toBe('range');
  });
});
