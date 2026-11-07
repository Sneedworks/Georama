// Card 2.4, detail v2 (977da8d; status a80183a; RED a5af6ff): the editor layer stack on the card 2.3
// command bus. Core code: no DOM and no Node APIs. "EditLayer" is not the map's raster channels
// (src/core/firstlight/layers.ts) nor the format's layers (WdLayers).
import { CommandBus } from './bus.ts';
import type { VerdictCode } from './command.ts';
import { layerCommand } from './layer-commands.ts';
import { TILE, TileGrid } from './tiles.ts';
import { buildTileWrite, type CellWrite } from './tile-command.ts';

/** D7: the most layers a stack holds. */
export const MAX_LAYERS = 64;
/** D5: the longest name, in characters, after trimming. */
export const MAX_NAME = 64;

export type LayerCode =
  | 'range'
  | 'name'
  | 'limit'
  | 'layer'
  | 'index'
  | 'noop'
  | 'too-large'
  | 'channels'
  | 'value-length'
  | 'empty-history';

export type LayerVerdict<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: LayerCode };

export interface EditLayer {
  readonly id: number;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly grid: TileGrid;
}

interface LayerRecord {
  readonly id: number;
  name: string;
  visible: boolean;
  opacity: number;
  readonly grid: TileGrid;
}

function view(record: LayerRecord): EditLayer {
  return { id: record.id, name: record.name, visible: record.visible, opacity: record.opacity, grid: record.grid };
}

function done(): LayerVerdict<void> {
  return { ok: true, value: undefined };
}

function fail(code: LayerCode): LayerVerdict<never> {
  return { ok: false, code };
}

/** D5: the trimmed name, or null when it is empty or longer than MAX_NAME characters. */
function checkName(name: string): string | null {
  const clean = name.trim();
  const length = Array.from(clean).length;
  return length >= 1 && length <= MAX_NAME ? clean : null;
}

/**
 * Maps a bus or tile verdict code onto a layer code. `nested` cannot occur: this stack never opens a
 * transaction, so the bus never returns it here. Reaching it would be a defect, so it throws.
 */
function fromBus(code: VerdictCode): LayerCode {
  switch (code) {
    case 'range':
    case 'channels':
    case 'value-length':
    case 'too-large':
    case 'noop':
    case 'empty-history':
      return code;
    case 'nested':
      throw new Error('layers: nested verdict, but this stack opens no transactions');
  }
}

export class EditLayerStack {
  private readonly width: number;
  private readonly height: number;
  private readonly channels: number;
  private readonly bus: CommandBus;
  /** Bottom to top. */
  private readonly stack: LayerRecord[] = [];
  /** D1: ids come from this counter, which only increases; undo never lowers it. */
  private nextId = 1;

  constructor(options: { width: number; height: number; channels: number; maxSteps: number; maxBytes: number }) {
    this.width = options.width;
    this.height = options.height;
    this.channels = options.channels;
    this.bus = new CommandBus({ maxSteps: options.maxSteps, maxBytes: options.maxBytes });
    // D9: the start layer is not recorded in history, so undo cannot remove it.
    this.stack.push(this.newRecord('Layer 1'));
  }

  layers(): readonly EditLayer[] {
    return this.stack.map(view);
  }

  layer(id: number): EditLayer | undefined {
    const record = this.find(id);
    return record === undefined ? undefined : view(record);
  }

  addLayer(name: string, index?: number): LayerVerdict<number> {
    const clean = checkName(name);
    if (clean === null) return fail('name');
    if (this.stack.length >= MAX_LAYERS) return fail('limit');
    // D2: the default is the top. An index outside 0 to n (insert positions) is refused with `index`.
    const at = index ?? this.stack.length;
    if (!Number.isInteger(at) || at < 0 || at > this.stack.length) return fail('index');
    const record = this.newRecord(clean);
    this.bus.execute(
      layerCommand(
        `add layer ${record.id}`,
        () => {
          this.stack.splice(at, 0, record);
        },
        () => {
          this.stack.splice(this.indexOfOrThrow(record.id), 1);
        },
        0,
      ),
    );
    return { ok: true, value: record.id };
  }

  removeLayer(id: number): LayerVerdict<void> {
    const record = this.find(id);
    if (record === undefined) return fail('layer');
    // D6: the same grid object comes back on undo. Bytes are the stored before-images, which equal
    // the non-null tile bytes; the after-image is absent (costs nothing).
    let removedAt = -1;
    this.bus.execute(
      layerCommand(
        `remove layer ${id}`,
        () => {
          removedAt = this.indexOfOrThrow(id);
          this.stack.splice(removedAt, 1);
        },
        () => {
          this.stack.splice(removedAt, 0, record);
        },
        this.storedBytes(record.grid),
      ),
    );
    return done();
  }

  renameLayer(id: number, name: string): LayerVerdict<void> {
    const record = this.find(id);
    if (record === undefined) return fail('layer');
    const clean = checkName(name);
    if (clean === null) return fail('name');
    const before = record.name;
    this.bus.execute(
      layerCommand(
        `rename layer ${id}`,
        () => {
          record.name = clean;
        },
        () => {
          record.name = before;
        },
        0,
      ),
    );
    return done();
  }

  moveLayer(id: number, toIndex: number): LayerVerdict<void> {
    const from = this.indexOf(id);
    if (from < 0) return fail('layer');
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > this.stack.length - 1) return fail('index');
    if (toIndex === from) return fail('noop');
    this.bus.execute(
      layerCommand(
        `move layer ${id}`,
        () => {
          const [moved] = this.stack.splice(this.indexOfOrThrow(id), 1);
          this.stack.splice(toIndex, 0, moved);
        },
        () => {
          const [moved] = this.stack.splice(this.indexOfOrThrow(id), 1);
          this.stack.splice(from, 0, moved);
        },
        0,
      ),
    );
    return done();
  }

  setVisible(id: number, visible: boolean): LayerVerdict<void> {
    const record = this.find(id);
    if (record === undefined) return fail('layer');
    const before = record.visible;
    this.bus.execute(
      layerCommand(
        `visibility layer ${id}`,
        () => {
          record.visible = visible;
        },
        () => {
          record.visible = before;
        },
        0,
      ),
    );
    return done();
  }

  setOpacity(id: number, percent: number): LayerVerdict<void> {
    const record = this.find(id);
    if (record === undefined) return fail('layer');
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return fail('range');
    const before = record.opacity;
    this.bus.execute(
      layerCommand(
        `opacity layer ${id}`,
        () => {
          record.opacity = percent;
        },
        () => {
          record.opacity = before;
        },
        0,
      ),
    );
    return done();
  }

  writeTiles(id: number, writes: readonly CellWrite[]): LayerVerdict<void> {
    const record = this.find(id);
    if (record === undefined) return fail('layer');
    // D8: the diff is built on this layer's grid only; the bus budget is the stack's maxBytes.
    const built = buildTileWrite(record.grid, writes, this.bus.maxBytes);
    if (!built.ok) return fail(fromBus(built.code));
    this.bus.execute(built.value);
    return done();
  }

  undo(): LayerVerdict<void> {
    const result = this.bus.undo();
    return result.ok ? done() : fail(fromBus(result.code));
  }

  redo(): LayerVerdict<void> {
    const result = this.bus.redo();
    return result.ok ? done() : fail(fromBus(result.code));
  }

  canUndo(): boolean {
    return this.bus.canUndo();
  }

  canRedo(): boolean {
    return this.bus.canRedo();
  }

  private newRecord(name: string): LayerRecord {
    const record: LayerRecord = {
      id: this.nextId,
      name,
      visible: true,
      opacity: 100,
      grid: new TileGrid(this.width, this.height, this.channels),
    };
    this.nextId += 1;
    return record;
  }

  private find(id: number): LayerRecord | undefined {
    return this.stack.find((record) => record.id === id);
  }

  private indexOf(id: number): number {
    return this.stack.findIndex((record) => record.id === id);
  }

  private indexOfOrThrow(id: number): number {
    const at = this.indexOf(id);
    // Invariant: a command runs only on the state it was built for, so its layer is present.
    if (at < 0) throw new Error(`layers: no layer ${id}`);
    return at;
  }

  private storedBytes(grid: TileGrid): number {
    const count = Math.ceil(this.width / TILE) * Math.ceil(this.height / TILE);
    let sum = 0;
    for (let i = 0; i < count; i += 1) {
      const tile = grid.tileBytes(i);
      if (tile !== null) sum += tile.length;
    }
    return sum;
  }
}
