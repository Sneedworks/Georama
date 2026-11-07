// Card 2.6, detail v1.11 (approved in principle at 2d756e1; status a171766): acceptance tests A1-A10
// for the ground tool; it imports src/core/edit/ground.ts.
// Test stacks use maxSteps 2 ** 10 and maxBytes 2 ** 27 (detail section 5); four channels unless a test says otherwise.
import { describe, expect, it } from 'vitest';
import { groundWrites, type GroundVerdict } from '../../src/core/edit/ground.ts';
import { EditLayerStack } from '../../src/core/edit/layers.ts';
import type { CellWrite } from '../../src/core/edit/tile-command.ts';
import { TILE } from '../../src/core/edit/tiles.ts';

const BUDGET = { maxSteps: 2 ** 10, maxBytes: 2 ** 27 };
const BLACK = { r: 0, g: 0, b: 0 };
const PAINT = { r: 10, g: 20, b: 30 };

type AnyVerdict = { readonly ok: true; readonly value?: unknown } | { readonly ok: false; readonly code: string };

function codeOf(v: AnyVerdict): string {
  return v.ok ? 'ok' : v.code;
}

// Typed on the value: the result is CellWrite[], and a failed verdict throws.
function must(v: GroundVerdict<CellWrite[]>): CellWrite[] {
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

function stack(width: number, height: number, channels = 4): EditLayerStack {
  return new EditLayerStack({ width, height, channels, ...BUDGET });
}

function layerOf(s: EditLayerStack, id = 1) {
  const layer = s.layer(id);
  if (layer === undefined) throw new Error(`no layer ${id}`);
  return layer;
}

function cells(s: EditLayerStack): Uint8Array {
  return layerOf(s).grid.snapshot();
}

function valueAt(s: EditLayerStack, x: number, y: number): number[] {
  return Array.from(layerOf(s).grid.cellValue(x, y));
}

function strokeOn(
  points: Array<{ x: number; y: number }>,
  radius: number,
  colour: { r: number; g: number; b: number } = PAINT,
  width = 2 ** 8,
  height = 2 ** 8,
): GroundVerdict<CellWrite[]> {
  return groundWrites({ width, height, points, radius, colour });
}

/** N(r): the integer offsets with dx squared plus dy squared at most r squared (detail section 3, D6). */
function countDisc(radius: number): number {
  let n = 0;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (dx * dx + dy * dy <= radius * radius) n += 1;
    }
  }
  return n;
}

describe('card 2.6 A1: disc painting', () => {
  it('a single-point stroke paints the radius-1 disc with [10, 20, 30, 255]; every other cell reads zero', () => {
    const size = 2 ** 8;
    const s = stack(size, size);
    done(s.writeTiles(1, must(strokeOn([{ x: 100, y: 100 }], 1))));
    const disc: Array<[number, number]> = [
      [100, 100],
      [99, 100],
      [101, 100],
      [100, 99],
      [100, 101],
    ];
    const expected = new Uint8Array(size * size * 4);
    for (const [x, y] of disc) {
      expected.set([10, 20, 30, 255], (y * size + x) * 4);
    }
    expect(same(cells(s), expected)).toBe(true);
  });
});

describe('card 2.6 A2: coverage', () => {
  it('a horizontal stroke paints every cell from x 10 to 60 in rows 9 to 11 with the colour and alpha 255', () => {
    const s = stack(2 ** 8, 2 ** 8);
    done(s.writeTiles(1, must(strokeOn([{ x: 10, y: 10 }, { x: 60, y: 10 }], 1))));
    for (let x = 10; x <= 60; x += 1) {
      for (let y = 9; y <= 11; y += 1) {
        expect(valueAt(s, x, y)).toEqual([10, 20, 30, 255]);
      }
    }
  });
});

describe('card 2.6 A3: clipping', () => {
  it('cells outside the layer are dropped; a stroke wholly outside is an empty list and writeTiles returns noop', () => {
    const size = 2 ** 8;
    const s = stack(size, size);
    const v = strokeOn([{ x: -20, y: 5 }, { x: 5, y: 5 }], 2);
    expect(codeOf(v)).toBe('ok');
    const writes = must(v);
    for (const w of writes) {
      expect(w.x >= 0 && w.x < size && w.y >= 0 && w.y < size).toBe(true);
    }
    done(s.writeTiles(1, writes));
    // The union of the radius-2 discs centred on y = 5, x from -20 to 5, restricted to x >= 0 (as card 2.5 A3).
    const inUnion = (x: number, y: number): boolean => {
      if (x >= 0 && x <= 5) return y >= 3 && y <= 7;
      if (x === 6) return y >= 4 && y <= 6;
      if (x === 7) return y === 5;
      return false;
    };
    const expected = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (inUnion(x, y)) expected.set([10, 20, 30, 255], (y * size + x) * 4);
      }
    }
    expect(same(cells(s), expected)).toBe(true);
    const far = strokeOn([{ x: -100, y: -100 }, { x: -90, y: -90 }], 3);
    expect(codeOf(far)).toBe('ok');
    expect(must(far)).toEqual([]);
    expect(codeOf(s.writeTiles(1, must(far)))).toBe('noop');
  });
});

describe('card 2.6 A4: refusals', () => {
  it('radius, width, points and colour are checked and refused with their codes', () => {
    const one = [{ x: 5, y: 5 }];
    expect(codeOf(strokeOn(one, 0, BLACK))).toBe('range');
    expect(codeOf(strokeOn(one, 2 ** 5 + 1, BLACK))).toBe('range');
    expect(codeOf(strokeOn(one, 1.5, BLACK))).toBe('range');
    expect(codeOf(strokeOn(one, 1, BLACK, 0))).toBe('range');
    expect(codeOf(strokeOn([{ x: 1.5, y: 5 }], 1, BLACK))).toBe('range');
    expect(codeOf(strokeOn([], 1, BLACK))).toBe('range');
    const many = Array.from({ length: 2 ** 9 + 1 }, (_, i) => ({ x: i, y: 5 }));
    expect(codeOf(strokeOn(many, 1, BLACK))).toBe('too-large');
    expect(codeOf(strokeOn(one, 1, { r: -1, g: 0, b: 0 }))).toBe('range');
    expect(codeOf(strokeOn(one, 1, { r: 0, g: 256, b: 0 }))).toBe('range');
    expect(codeOf(strokeOn(one, 1, { r: 0, g: 0, b: 1.5 }))).toBe('range');
    expect(codeOf(strokeOn(one, 1, { r: 0, g: 0, b: Number.NaN }))).toBe('range');
  });
});

describe('card 2.6 A5: work bound', () => {
  it('2^9 points spaced 60 apart at radius 2^5 are refused by the step bound (check 5)', () => {
    const s = stack(2 ** 16, 2 ** 7);
    const points = Array.from({ length: 2 ** 9 }, (_, i) => ({ x: 60 * i, y: 50 }));
    expect(codeOf(strokeOn(points, 2 ** 5, { r: 1, g: 2, b: 3 }, 2 ** 16, 2 ** 7))).toBe('too-large');
    expect(s.canUndo()).toBe(false);
  });
});

describe('card 2.6 A6: cell bound', () => {
  it('radius 2^5 is refused by the cell bound (check 6); radius 8 on the same stroke is ok and writes 2^5 tiles', () => {
    const size = 2 ** 12;
    const s = stack(size, size);
    const stroke = [{ x: 0, y: 50 }, { x: size + 4, y: 50 }];
    const colour = { r: 1, g: 2, b: 3 };
    expect(codeOf(strokeOn(stroke, 2 ** 5, colour, size, size))).toBe('too-large');
    expect(s.canUndo()).toBe(false);
    const control = must(strokeOn(stroke, 8, colour, size, size));
    expect(control.length).toBe(2 ** 12 * 17);
    expect(codeOf(s.writeTiles(1, control))).toBe('ok');
    const grid = layerOf(s).grid;
    const tileCount = (size / TILE) * (size / TILE);
    let total = 0;
    for (let i = 0; i < tileCount; i += 1) {
      const bytes = grid.tileBytes(i);
      if (i < 2 ** 5) {
        expect(bytes).not.toBeNull();
      }
      total += bytes === null ? 0 : bytes.length;
    }
    expect(total).toBe(2 ** 21);
  });
});

describe('card 2.6 A7: undo and redo', () => {
  it('one undo per stroke; the bytes after each undo and redo equal the recorded states exactly', () => {
    const size = 2 ** 8;
    const s = stack(size, size);
    const initial = cells(s);
    done(s.writeTiles(1, must(strokeOn([{ x: 100, y: 100 }], 8, { r: 200, g: 100, b: 50 }))));
    const afterFirst = cells(s);
    done(s.writeTiles(1, must(strokeOn([{ x: 104, y: 100 }], 8, { r: 0, g: 255, b: 0 }))));
    const afterSecond = cells(s);
    expect(same(afterSecond, afterFirst)).toBe(false);
    done(s.undo());
    expect(same(cells(s), afterFirst)).toBe(true);
    done(s.undo());
    expect(same(cells(s), initial)).toBe(true);
    done(s.redo());
    expect(same(cells(s), afterFirst)).toBe(true);
    done(s.redo());
    expect(same(cells(s), afterSecond)).toBe(true);
  });
});

describe('card 2.6 A8: channels, value length and layers', () => {
  it('a one-channel layer refuses the writes with channels; a short value gives value-length; an unknown id gives layer', () => {
    const size = 2 ** 8;
    const one = new EditLayerStack({ width: size, height: size, channels: 1, ...BUDGET });
    const writes = must(strokeOn([{ x: 100, y: 100 }], 1));
    expect(codeOf(one.writeTiles(1, writes))).toBe('channels');
    expect(codeOf(one.writeTiles(1, must(strokeOn([{ x: -5, y: -5 }], 1))))).toBe('noop');
    const four = stack(size, size);
    expect(codeOf(four.writeTiles(1, [{ x: 0, y: 0, channels: 4, value: new Uint8Array(3) }]))).toBe('value-length');
    expect(codeOf(four.writeTiles(999, [{ x: 0, y: 0, channels: 4, value: new Uint8Array(4) }]))).toBe('layer');
  });
});

describe('card 2.6 A9: walk steps', () => {
  it('a retracing stroke is refused by the step bound (check 5); the single segment is ok with its cell count', () => {
    const width = 2 ** 12;
    const height = 2 ** 8;
    const colour = { r: 1, g: 1, b: 1 };
    const retrace = [{ x: 0, y: 50 }, { x: 2 ** 11 + 2 ** 10, y: 50 }, { x: 0, y: 50 }];
    expect(codeOf(strokeOn(retrace, 2 ** 5, colour, width, height))).toBe('too-large');
    const segment = [{ x: 0, y: 50 }, { x: 2 ** 11 + 2 ** 10, y: 50 }];
    const v = strokeOn(segment, 2 ** 5, colour, width, height);
    expect(codeOf(v)).toBe('ok');
    const disc = 2 * 2 ** 5 + 1;
    const expected = (2 ** 11 + 2 ** 10 + 1) * disc + (countDisc(2 ** 5) - disc) / 2;
    expect(must(v).length).toBe(expected);
    expect(must(v).length).toBeLessThanOrEqual(2 ** 18);
  });
});

describe('card 2.6 A10: coordinate limit', () => {
  it('coordinates beyond 2^40 in magnitude, and non-integers, are refused with range', () => {
    const limit = 2 ** 40;
    const size = 2 ** 41;
    const colour = { r: 1, g: 1, b: 1 };
    const at = (x: number): GroundVerdict<CellWrite[]> =>
      groundWrites({ width: size, height: size, points: [{ x, y: 0 }], radius: 1, colour });
    expect(must(at(limit)).length).toBe(4);
    expect(must(at(-limit))).toEqual([]);
    expect(codeOf(at(limit + 1))).toBe('range');
    expect(codeOf(at(-limit - 1))).toBe('range');
    expect(codeOf(at(1.5))).toBe('range');
  });
});
