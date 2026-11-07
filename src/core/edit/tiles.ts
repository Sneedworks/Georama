// Card 2.3, detail v2.2, D2: a tiled raster store. TILE = 128 cells per side; a tile exists only after a
// write touches it, and an absent tile reads as zeros. Core code: no DOM and no Node APIs.

export const TILE = 128;

// Tile storage lives outside the class, so the grid's public surface is exactly the declared one.
const storage = new WeakMap<TileGrid, Array<Uint8Array | null>>();

/** Row-major index of the tile that holds cell (x, y). */
export function tileIndexOf(grid: TileGrid, x: number, y: number): number {
  return Math.floor(y / TILE) * Math.ceil(grid.width / TILE) + Math.floor(x / TILE);
}

/** Byte offset of cell (x, y)'s first channel inside its tile's bytes. */
export function cellOffset(grid: TileGrid, x: number, y: number): number {
  return ((y % TILE) * TILE + (x % TILE)) * grid.channels;
}

/** Internal to the card: replaces one tile's bytes (null = absent). Used only by Command.apply and Command.revert. */
export function setTile(grid: TileGrid, index: number, bytes: Uint8Array | null): void {
  const tiles = storage.get(grid);
  // Not reachable through the declared API: a command only writes to the grid it was built from.
  if (tiles === undefined) throw new Error('setTile: unknown grid');
  tiles[index] = bytes;
}

export class TileGrid {
  readonly width: number;
  readonly height: number;
  readonly channels: number;

  constructor(width: number, height: number, channels: number) {
    this.width = width;
    this.height = height;
    this.channels = channels;
    const count = Math.ceil(width / TILE) * Math.ceil(height / TILE);
    storage.set(this, new Array<Uint8Array | null>(count).fill(null));
  }

  /** Bytes of tile `index` (row-major), or null when the tile is absent. */
  tileBytes(index: number): Uint8Array | null {
    return storage.get(this)?.[index] ?? null;
  }

  /** The channel values of cell (x, y); zeros when its tile is absent. */
  cellValue(x: number, y: number): Uint8Array {
    const out = new Uint8Array(this.channels);
    const tile = this.tileBytes(tileIndexOf(this, x, y));
    if (tile !== null) {
      const at = cellOffset(this, x, y);
      out.set(tile.subarray(at, at + this.channels));
    }
    return out;
  }

  /** A deep copy of every cell, row-major, for tests and comparisons. */
  snapshot(): Uint8Array {
    const out = new Uint8Array(this.width * this.height * this.channels);
    const rowBytes = this.width * this.channels;
    const tilesAcross = Math.ceil(this.width / TILE);
    const tilesDown = Math.ceil(this.height / TILE);
    for (let ty = 0; ty < tilesDown; ty += 1) {
      for (let tx = 0; tx < tilesAcross; tx += 1) {
        const tile = this.tileBytes(ty * tilesAcross + tx);
        if (tile === null) continue;
        const x0 = tx * TILE;
        const y0 = ty * TILE;
        const cols = Math.min(TILE, this.width - x0);
        const rows = Math.min(TILE, this.height - y0);
        for (let row = 0; row < rows; row += 1) {
          const from = row * TILE * this.channels;
          const to = (y0 + row) * rowBytes + x0 * this.channels;
          out.set(tile.subarray(from, from + cols * this.channels), to);
        }
      }
    }
    return out;
  }
}
