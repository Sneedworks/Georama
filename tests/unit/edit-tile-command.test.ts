// Card 2.3, detail v2.2 (bbaee86): acceptance tests A3, A7, A8 and rule D4 (building is pure).
// RED stage: this file imports modules that do not exist yet (see edit-tiles.test.ts).
import { describe, expect, it } from 'vitest';
import type { Verdict } from '../../src/core/edit/command.ts';
import { TILE, TileGrid } from '../../src/core/edit/tiles.ts';
import { buildTileWrite, type CellWrite } from '../../src/core/edit/tile-command.ts';

const BIG = 128 * 1024 * 1024;

function must<T>(v: Verdict<T>): T {
  if (!v.ok) throw new Error(`verdict ${v.code}`);
  return v.value;
}

function codeOf<T>(v: Verdict<T>): string {
  return v.ok ? 'ok' : v.code;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function cell(x: number, y: number, value: number): CellWrite {
  return { x, y, channels: 1, value: new Uint8Array([value]) };
}

describe('card 2.3 A3: oversize refused', () => {
  it('a command larger than maxBytes returns too-large and leaves the grid unchanged', () => {
    const grid = new TileGrid(512, 512, 1);
    const before = grid.snapshot();
    // A one-cell write to an absent tile stores one image: TILE * TILE * channels bytes.
    expect(codeOf(buildTileWrite(grid, [cell(5, 5, 9)], TILE * TILE - 1))).toBe('too-large');
    expect(same(grid.snapshot(), before)).toBe(true);
    // Control: the same write fits when maxBytes is exactly one image.
    expect(codeOf(buildTileWrite(grid, [cell(5, 5, 9)], TILE * TILE))).toBe('ok');
  });
});

describe('card 2.3 A7: refusals, one fault per case', () => {
  it('wrong channel count, wrong value length and out-of-range cells return their codes and mutate nothing', () => {
    const grid = new TileGrid(512, 512, 1);
    const before = grid.snapshot();
    const wrongChannels = { x: 1, y: 1, channels: 2, value: new Uint8Array([7]) };
    const wrongLength = { x: 1, y: 1, channels: 1, value: new Uint8Array([7, 8]) };
    expect(codeOf(buildTileWrite(grid, [wrongChannels], BIG))).toBe('channels');
    expect(codeOf(buildTileWrite(grid, [wrongLength], BIG))).toBe('value-length');
    expect(codeOf(buildTileWrite(grid, [cell(512, 0, 7)], BIG))).toBe('range');
    expect(codeOf(buildTileWrite(grid, [cell(0, 512, 7)], BIG))).toBe('range');
    expect(codeOf(buildTileWrite(grid, [cell(-1, 0, 7)], BIG))).toBe('range');
    expect(same(grid.snapshot(), before)).toBe(true);
  });
});

describe('card 2.3 A8: diff size', () => {
  it('a one-cell write to a tile present before the write stores exactly two images', () => {
    const grid = new TileGrid(512, 512, 1);
    must(buildTileWrite(grid, [cell(1, 1, 1)], BIG)).apply(); // seeds tile (0, 0)
    const cmd = must(buildTileWrite(grid, [cell(2, 2, 5)], BIG));
    expect(cmd.bytes).toBe(2 * TILE * TILE * 1);
  });

  it('a four-cell write across the corner of four tiles stores eight images, never a whole-grid copy', () => {
    const grid = new TileGrid(512, 512, 1);
    for (const [x, y] of [[1, 1], [129, 1], [1, 129], [129, 129]]) {
      must(buildTileWrite(grid, [cell(x, y, 1)], BIG)).apply(); // seeds each of the four tiles
    }
    const corner = [cell(127, 127, 2), cell(128, 127, 2), cell(127, 128, 2), cell(128, 128, 2)];
    const cmd = must(buildTileWrite(grid, corner, BIG));
    expect(cmd.bytes).toBe(8 * TILE * TILE * 1);
    expect(cmd.bytes).toBeLessThan(512 * 512 * 1);
  });
});

describe('card 2.3 D4: construction is pure', () => {
  it('building a command writes nothing until it is executed, and revert restores the grid', () => {
    const grid = new TileGrid(512, 512, 1);
    const before = grid.snapshot();
    const cmd = must(buildTileWrite(grid, [cell(3, 3, 4)], BIG));
    expect(same(grid.snapshot(), before)).toBe(true);
    expect(cmd.bytes).toBeGreaterThan(0);
    cmd.apply();
    expect(grid.cellValue(3, 3)).toEqual(new Uint8Array([4]));
    cmd.revert();
    expect(same(grid.snapshot(), before)).toBe(true);
  });
});
