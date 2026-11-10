// Card 2.3, detail v2.2 (bbaee86): acceptance tests A3, A7, A8 and rule D4 (building is pure).
// RED stage: this file imports modules that do not exist yet (see edit-tiles.test.ts).
import { describe, expect, it, vi } from 'vitest';
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

describe('tile write sparse fast paths', () => {
  it('does not clone an existing tile for a repeated no-op write', () => {
    const grid = new TileGrid(256, 128, 1);
    must(buildTileWrite(grid, [cell(2, 3, 17)], BIG)).apply();
    const before = grid.tileBytes(0)!;
    const clone = vi.spyOn(before, 'slice');

    expect(codeOf(buildTileWrite(grid, [cell(2, 3, 17)], BIG))).toBe('noop');
    expect(clone).not.toHaveBeenCalled();
    expect(grid.tileBytes(0)).toBe(before);
  });

  it('uses the final value for duplicate writes, including a write that cancels an earlier change', () => {
    const grid = new TileGrid(256, 128, 1);
    must(buildTileWrite(grid, [cell(2, 3, 17)], BIG)).apply();
    const before = grid.tileBytes(0)!;
    const clone = vi.spyOn(before, 'slice');

    expect(codeOf(buildTileWrite(grid, [cell(2, 3, 29), cell(2, 3, 17)], BIG))).toBe('noop');
    expect(clone).not.toHaveBeenCalled();
    expect(grid.cellValue(2, 3)).toEqual(new Uint8Array([17]));
    expect(codeOf(buildTileWrite(grid, [cell(130, 3, 8), cell(130, 3, 0)], BIG))).toBe('noop');
    expect(grid.tileBytes(1)).toBeNull();
  });

  it('copies only changed tiles, preserves the byte budget and reverts the final values', () => {
    const grid = new TileGrid(256, 128, 1);
    must(buildTileWrite(grid, [cell(2, 3, 17), cell(130, 3, 8)], BIG)).apply();
    const untouched = grid.tileBytes(0)!;
    const changed = grid.tileBytes(1)!;
    const noOpClone = vi.spyOn(untouched, 'slice');
    const changedClone = vi.spyOn(changed, 'slice');

    const writes = [cell(2, 3, 17), cell(130, 3, 29), cell(130, 3, 10)];
    expect(codeOf(buildTileWrite(grid, writes, 2 * TILE * TILE - 1))).toBe('too-large');
    expect(noOpClone).not.toHaveBeenCalled();
    expect(changedClone).not.toHaveBeenCalled();

    const command = must(buildTileWrite(grid, writes, 2 * TILE * TILE));
    expect(command.bytes).toBe(2 * TILE * TILE);
    expect(command.label).toBe('tile write (1 tile)');
    expect(noOpClone).not.toHaveBeenCalled();
    command.apply();
    expect(grid.cellValue(130, 3)).toEqual(new Uint8Array([10]));
    command.revert();
    expect(grid.tileBytes(0)).toBe(untouched);
    expect(grid.tileBytes(1)).toBe(changed);
  });

  it('detects cancellation even after a stroke becomes dense', () => {
    const grid = new TileGrid(128, 128, 1);
    const dirty = Array.from({ length: 300 }, (_, i) => cell(i % 128, Math.floor(i / 128), 12));
    const restore = Array.from({ length: 300 }, (_, i) => cell(i % 128, Math.floor(i / 128), 0));

    expect(codeOf(buildTileWrite(grid, [...dirty, ...restore], BIG))).toBe('noop');
    expect(grid.tileBytes(0)).toBeNull();

    const command = must(buildTileWrite(grid, [...dirty, cell(0, 0, 19)], BIG));
    expect(command.bytes).toBe(TILE * TILE);
    command.apply();
    expect(grid.cellValue(0, 0)).toEqual(new Uint8Array([19]));
    expect(grid.cellValue(1, 0)).toEqual(new Uint8Array([12]));
    command.revert();
    expect(grid.tileBytes(0)).toBeNull();
  });

  it('matches sequential last-write-wins semantics for multi-channel sparse and dense edits', () => {
    const grid = new TileGrid(256, 256, 4);
    const seed: CellWrite = { x: 15, y: 15, channels: 4, value: new Uint8Array([1, 2, 3, 4]) };
    must(buildTileWrite(grid, [seed], BIG)).apply();
    const before = grid.snapshot();
    const expected = before.slice();
    const writes: CellWrite[] = [];
    let state = 0x13579bdf;
    for (let i = 0; i < 900; i += 1) {
      // Concentrate most writes in one tile so that the dense fallback is exercised.
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const x = i % 5 === 0 ? 128 + (state % 128) : state % 128;
      const y = i % 5 === 0 ? 128 + ((state >>> 8) % 128) : (state >>> 8) % 128;
      const value = new Uint8Array([state & 255, (state >>> 8) & 255, (state >>> 16) & 255, i & 255]);
      writes.push({ x, y, channels: 4, value });
      expected.set(value, (y * grid.width + x) * 4);
    }

    const command = must(buildTileWrite(grid, writes, BIG));
    expect(grid.snapshot()).toEqual(before);
    command.apply();
    expect(grid.snapshot()).toEqual(expected);
    command.revert();
    expect(grid.snapshot()).toEqual(before);
  });
});
