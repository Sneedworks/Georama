// Card 2.3, detail v2.2 (section 3; D3, D4; A3, A5, A7, A8): build a tile-diff command without writing.
// Core code: no DOM and no Node APIs.
import type { Command, Verdict, VerdictCode } from './command.ts';
import { TILE, cellOffset, setTile, tileIndexOf, type TileGrid } from './tiles.ts';

export interface CellWrite {
  readonly x: number;
  readonly y: number;
  /** The channel count the caller believes the grid has. */
  readonly channels: number;
  readonly value: Uint8Array;
}

function fail(code: VerdictCode): Verdict<never> {
  return { ok: false, code };
}

function inRange(grid: TileGrid, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface TileImages {
  readonly index: number;
  readonly before: Uint8Array | null;
  readonly after: Uint8Array;
}

/**
 * Builds the command for `writes` without changing `grid` (D4). Checks run per write, in this order:
 * channels, value-length, range. Then the tile images are computed: too-large when the command's bytes
 * exceed `maxBytes`, noop when no byte changes (D3).
 */
export function buildTileWrite(grid: TileGrid, writes: readonly CellWrite[], maxBytes: number): Verdict<Command> {
  for (const write of writes) {
    if (write.channels !== grid.channels) return fail('channels');
    if (write.value.length !== grid.channels) return fail('value-length');
    if (!inRange(grid, write.x, write.y)) return fail('range');
  }

  // Working copies of the touched tiles; the grid itself is not written here.
  const touched = new Map<number, { before: Uint8Array | null; after: Uint8Array }>();
  for (const write of writes) {
    const index = tileIndexOf(grid, write.x, write.y);
    let entry = touched.get(index);
    if (entry === undefined) {
      const before = grid.tileBytes(index);
      const after = before === null ? new Uint8Array(TILE * TILE * grid.channels) : before.slice();
      entry = { before, after };
      touched.set(index, entry);
    }
    entry.after.set(write.value, cellOffset(grid, write.x, write.y));
  }

  // D3: keep only the tiles whose bytes change. An absent tile reads as zeros.
  const changed: TileImages[] = [];
  for (const [index, entry] of touched) {
    const unchanged =
      entry.before === null ? entry.after.every((b) => b === 0) : sameBytes(entry.before, entry.after);
    if (!unchanged) changed.push({ index, before: entry.before, after: entry.after });
  }

  let bytes = 0;
  for (const tile of changed) {
    bytes += (tile.before === null ? 0 : tile.before.length) + tile.after.length;
  }
  if (bytes > maxBytes) return fail('too-large');
  if (changed.length === 0) return fail('noop');

  const command: Command = {
    label: `tile write (${changed.length} tile${changed.length === 1 ? '' : 's'})`,
    bytes,
    apply(): void {
      for (const tile of changed) setTile(grid, tile.index, tile.after);
    },
    revert(): void {
      for (const tile of changed) setTile(grid, tile.index, tile.before);
    },
  };
  return { ok: true, value: command };
}
