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

interface PendingTile {
  readonly before: Uint8Array | null;
  readonly cells: Map<number, Uint8Array>;
  after?: Uint8Array;
}

// A dense stroke is cheaper to finish with direct typed-array writes than thousands of Map entries.
const SPARSE_CELL_LIMIT = 64;

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

  // Keep only the final differences per cell. Repeated writes may restore the original value;
  // those cells (and potentially whole tiles) need no copy or byte-for-byte tile scan.
  const touched = new Map<number, PendingTile>();
  for (const write of writes) {
    const index = tileIndexOf(grid, write.x, write.y);
    let entry = touched.get(index);
    if (entry === undefined) {
      entry = { before: grid.tileBytes(index), cells: new Map() };
      touched.set(index, entry);
    }
    const offset = cellOffset(grid, write.x, write.y);
    if (entry.after !== undefined) {
      entry.after.set(write.value, offset);
      continue;
    }
    let differs = false;
    for (let channel = 0; channel < grid.channels; channel += 1) {
      if (write.value[channel] !== (entry.before?.[offset + channel] ?? 0)) {
        differs = true;
        break;
      }
    }
    if (differs) entry.cells.set(offset, write.value);
    else entry.cells.delete(offset);

    if (entry.cells.size > SPARSE_CELL_LIMIT) {
      // Dense fallback retains last-write-wins. A final full comparison still detects cancellation.
      const after = entry.before === null ? new Uint8Array(TILE * TILE * grid.channels) : entry.before.slice();
      for (const [cellOffset, value] of entry.cells) after.set(value, cellOffset);
      entry.cells.clear();
      entry.after = after;
    }
  }

  // D3: skip tiles with no net differences; sparse entries can be budgeted before any copying.
  const changedEntries: Array<{ index: number; entry: PendingTile }> = [];
  let bytes = 0;
  for (const [index, entry] of touched) {
    const unchanged = entry.after === undefined
      ? entry.cells.size === 0
      : entry.before === null ? entry.after.every((b) => b === 0) : sameBytes(entry.before, entry.after);
    if (unchanged) continue;
    changedEntries.push({ index, entry });
    const tileSize = entry.before === null ? TILE * TILE * grid.channels : entry.before.length;
    bytes += (entry.before === null ? 0 : entry.before.length) + tileSize;
  }
  if (bytes > maxBytes) return fail('too-large');
  if (changedEntries.length === 0) return fail('noop');

  const changed: TileImages[] = changedEntries.map(({ index, entry }) => {
    const after = entry.after ?? (entry.before === null
      ? new Uint8Array(TILE * TILE * grid.channels) : entry.before.slice());
    if (entry.after === undefined) {
      for (const [offset, value] of entry.cells) after.set(value, offset);
    }
    return { index, before: entry.before, after };
  });

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
