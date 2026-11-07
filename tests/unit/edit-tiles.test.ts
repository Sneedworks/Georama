// Card 2.3, detail v2.2 (bbaee86): TileGrid (D2). RED stage: this file imports modules that do not
// exist yet, so it fails at import with missing-module errors, as the detail expects.
import { describe, expect, it } from 'vitest';
import type { Verdict } from '../../src/core/edit/command.ts';
import { TILE, TileGrid } from '../../src/core/edit/tiles.ts';
import { buildTileWrite, type CellWrite } from '../../src/core/edit/tile-command.ts';

function must<T>(v: Verdict<T>): T {
  if (!v.ok) throw new Error(`verdict ${v.code}`);
  return v.value;
}

function cell(x: number, y: number, value: number): CellWrite {
  return { x, y, channels: 1, value: new Uint8Array([value]) };
}

function presentTiles(grid: TileGrid): number {
  let present = 0;
  for (let i = 0; i < 16; i += 1) {
    if (grid.tileBytes(i) !== null) present += 1;
  }
  return present;
}

describe('card 2.3 D2: TileGrid', () => {
  it('TILE is 128 cells per side', () => {
    expect(TILE).toBe(128);
  });

  it('a new grid reads as zeros, with every tile absent', () => {
    const grid = new TileGrid(512, 512, 1);
    expect(grid.width).toBe(512);
    expect(grid.height).toBe(512);
    expect(grid.channels).toBe(1);
    expect(grid.snapshot().length).toBe(512 * 512);
    expect(grid.snapshot().every((b) => b === 0)).toBe(true);
    expect(grid.cellValue(0, 0)).toEqual(new Uint8Array([0]));
    expect(presentTiles(grid)).toBe(0);
  });

  it('a write allocates only the tile it touches, which holds TILE x TILE x channels bytes', () => {
    const grid = new TileGrid(512, 512, 1);
    must(buildTileWrite(grid, [cell(0, 0, 9)], TILE * TILE * 4)).apply();
    expect(grid.cellValue(0, 0)).toEqual(new Uint8Array([9]));
    expect(grid.cellValue(1, 0)).toEqual(new Uint8Array([0]));
    expect(presentTiles(grid)).toBe(1);
    // Order-independent: exactly one tile holds bytes, and it is a full TILE x TILE x channels image.
    const images = Array.from({ length: 16 }, (_, i) => grid.tileBytes(i)).filter(
      (t): t is Uint8Array => t !== null,
    );
    expect(images.length).toBe(1);
    expect(images[0]?.length).toBe(TILE * TILE * 1);
  });

  it('cellValue returns one byte per channel', () => {
    const grid = new TileGrid(256, 256, 3);
    expect(grid.cellValue(5, 5)).toEqual(new Uint8Array([0, 0, 0]));
    expect(grid.snapshot().length).toBe(256 * 256 * 3);
  });

  it('snapshot is a deep copy: later writes and edits to it do not reach the other', () => {
    const grid = new TileGrid(512, 512, 1);
    const before = grid.snapshot();
    must(buildTileWrite(grid, [cell(0, 0, 5)], TILE * TILE * 4)).apply();
    expect(before[0]).toBe(0);
    expect(grid.snapshot()[0]).toBe(5);
    before[1] = 77;
    expect(grid.snapshot()[1]).toBe(0);
  });
});
