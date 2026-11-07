// Card 2.3, detail v2.2 (bbaee86): acceptance tests A1, A2, A4, A5 and A6 (the bus). RED stage:
// this file imports modules that do not exist yet (see edit-tiles.test.ts). Synthetic grids only.
import { describe, expect, it } from 'vitest';
import type { Verdict } from '../../src/core/edit/command.ts';
import { CommandBus } from '../../src/core/edit/bus.ts';
import { TILE, TileGrid } from '../../src/core/edit/tiles.ts';
import { buildTileWrite, type CellWrite } from '../../src/core/edit/tile-command.ts';

const MAX_BYTES = 128 * 1024 * 1024;
const D1 = { maxSteps: 200, maxBytes: MAX_BYTES };

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

// Mulberry32: a small seeded generator, so each seed gives the same sequence on every run.
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A write that changes one byte: the new value always differs from the current one.
function changingWrite(grid: TileGrid, rnd: () => number, maxBytes: number) {
  const x = Math.floor(rnd() * grid.width);
  const y = Math.floor(rnd() * grid.height);
  const current = grid.cellValue(x, y)[0];
  // Adds 1 to 255 modulo 256, so the result is never the current value.
  const value = (current + 1 + Math.floor(rnd() * 255)) % 256;
  return must(buildTileWrite(grid, [cell(x, y, value)], maxBytes));
}

describe('card 2.3 A1: exact undo and redo', () => {
  for (const seed of [1, 2, 3]) {
    it(`200 changing writes undo and redo byte for byte (seed ${seed})`, () => {
      const grid = new TileGrid(512, 512, 1);
      const bus = new CommandBus(D1);
      const rnd = prng(seed);
      const states: Uint8Array[] = [grid.snapshot()];
      for (let i = 0; i < 200; i += 1) {
        bus.execute(changingWrite(grid, rnd, D1.maxBytes));
        states.push(grid.snapshot());
      }
      expect(bus.stats().steps).toBe(200);
      for (let i = 200; i >= 1; i -= 1) {
        expect(codeOf(bus.undo())).toBe('ok');
        expect(same(grid.snapshot(), states[i - 1])).toBe(true);
      }
      expect(bus.canUndo()).toBe(false);
      for (let i = 1; i <= 200; i += 1) {
        expect(codeOf(bus.redo())).toBe('ok');
        expect(same(grid.snapshot(), states[i])).toBe(true);
      }
      expect(bus.canRedo()).toBe(false);
    }, 30_000);
  }
});

describe('card 2.3 A2: redo cleared; empty history', () => {
  it('a recorded command after an undo clears redo; empty undo and redo mutate nothing', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus(D1);
    const start = grid.snapshot();
    expect(codeOf(bus.undo())).toBe('empty-history');
    expect(codeOf(bus.redo())).toBe('empty-history');
    expect(same(grid.snapshot(), start)).toBe(true);
    bus.execute(must(buildTileWrite(grid, [cell(1, 1, 1)], D1.maxBytes)));
    expect(codeOf(bus.undo())).toBe('ok');
    expect(bus.canRedo()).toBe(true);
    bus.execute(must(buildTileWrite(grid, [cell(2, 2, 2)], D1.maxBytes)));
    expect(bus.canRedo()).toBe(false);
    const afterB = grid.snapshot();
    expect(codeOf(bus.redo())).toBe('empty-history');
    expect(same(grid.snapshot(), afterB)).toBe(true);
  });
});

describe('card 2.3 A4: bounded history', () => {
  it('(a) D1 bus: after 230 writes, 200 steps are kept, and undoing them restores the state after write 30', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus({ maxSteps: 200, maxBytes: MAX_BYTES });
    const rnd = prng(11);
    const states: Uint8Array[] = [grid.snapshot()];
    for (let i = 1; i <= 230; i += 1) {
      bus.execute(changingWrite(grid, rnd, MAX_BYTES));
      states.push(grid.snapshot());
    }
    expect(bus.stats().steps).toBe(200);
    expect(bus.stats().bytes).toBeLessThanOrEqual(MAX_BYTES);
    for (let i = 230; i >= 31; i -= 1) {
      expect(codeOf(bus.undo())).toBe('ok');
      expect(same(grid.snapshot(), states[i - 1])).toBe(true);
    }
    expect(same(grid.snapshot(), states[30])).toBe(true);
    expect(codeOf(bus.undo())).toBe('empty-history');
  }, 30_000);

  it('(b) byte bound: with maxBytes = 4 x TILE x TILE, the steady state is 4 steps and 4 x TILE x TILE bytes; undo restores the state after write 12', () => {
    const grid = new TileGrid(512, 512, 1);
    const cap = 4 * TILE * TILE;
    const bus = new CommandBus({ maxSteps: 200, maxBytes: cap });
    const states: Uint8Array[] = [grid.snapshot()];
    for (let t = 0; t < 16; t += 1) {
      // Each write sets a non-zero corner cell of a different tile; every tile is absent before the test.
      const x = (t % 4) * TILE;
      const y = Math.floor(t / 4) * TILE;
      bus.execute(must(buildTileWrite(grid, [cell(x, y, 1)], cap)));
      states.push(grid.snapshot());
      expect(bus.stats().steps).toBe(Math.min(t + 1, 4));
      expect(bus.stats().bytes).toBe(Math.min(t + 1, 4) * TILE * TILE);
    }
    for (let i = 0; i < 4; i += 1) {
      expect(codeOf(bus.undo())).toBe('ok');
    }
    expect(same(grid.snapshot(), states[12])).toBe(true);
    expect(bus.canUndo()).toBe(false);
  });
});

describe('card 2.3 A5: noop', () => {
  it('a write that changes no byte returns noop, records nothing, and leaves redo unchanged', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus(D1);
    bus.execute(must(buildTileWrite(grid, [cell(3, 3, 4)], D1.maxBytes)));
    expect(codeOf(bus.undo())).toBe('ok'); // cell (3, 3) reads zero again; the write is now in redo
    expect(bus.canRedo()).toBe(true);
    const before = grid.snapshot();
    expect(codeOf(buildTileWrite(grid, [cell(3, 3, 0)], D1.maxBytes))).toBe('noop');
    expect(bus.stats().steps).toBe(0);
    expect(bus.canRedo()).toBe(true);
    expect(same(grid.snapshot(), before)).toBe(true);
    expect(codeOf(bus.redo())).toBe('ok');
    expect(grid.cellValue(3, 3)).toEqual(new Uint8Array([4]));
  });
});

describe('card 2.3 A6: transactions', () => {
  it('commands inside fn form one undo step', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus(D1);
    const before = grid.snapshot();
    const result = bus.transaction('stroke', (b) => {
      b.execute(must(buildTileWrite(grid, [cell(1, 1, 1)], D1.maxBytes)));
      b.execute(must(buildTileWrite(grid, [cell(2, 2, 2)], D1.maxBytes)));
      b.execute(must(buildTileWrite(grid, [cell(3, 3, 3)], D1.maxBytes)));
    });
    expect(codeOf(result)).toBe('ok');
    expect(bus.stats().steps).toBe(1);
    const after = grid.snapshot();
    expect(codeOf(bus.undo())).toBe('ok');
    expect(same(grid.snapshot(), before)).toBe(true);
    expect(bus.canUndo()).toBe(false);
    expect(codeOf(bus.redo())).toBe('ok');
    expect(same(grid.snapshot(), after)).toBe(true);
  });

  it('a throw inside fn reverts the commands it applied, records nothing, keeps redo, and rethrows', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus(D1);
    bus.execute(must(buildTileWrite(grid, [cell(9, 9, 9)], D1.maxBytes)));
    expect(codeOf(bus.undo())).toBe('ok'); // the write is now in redo
    const before = grid.snapshot();
    expect(() =>
      bus.transaction('boom', (b) => {
        b.execute(must(buildTileWrite(grid, [cell(4, 4, 4)], D1.maxBytes)));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(same(grid.snapshot(), before)).toBe(true);
    expect(bus.stats().steps).toBe(0);
    expect(bus.canRedo()).toBe(true);
    expect(codeOf(bus.redo())).toBe('ok');
    expect(grid.cellValue(9, 9)).toEqual(new Uint8Array([9]));
  });

  it('a transaction that executes no command records no step', () => {
    const bus = new CommandBus(D1);
    expect(codeOf(bus.transaction('none', () => {}))).toBe('ok');
    expect(bus.stats().steps).toBe(0);
  });

  it('a nested transaction returns nested without running its fn', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus(D1);
    let innerRan = false;
    const outer = bus.transaction('outer', (b) => {
      const inner = b.transaction('inner', () => {
        innerRan = true;
      });
      expect(codeOf(inner)).toBe('nested');
      b.execute(must(buildTileWrite(grid, [cell(6, 6, 6)], D1.maxBytes)));
    });
    expect(codeOf(outer)).toBe('ok');
    expect(innerRan).toBe(false);
    expect(bus.stats().steps).toBe(1);
  });

  it('undo and redo inside an open transaction return nested and change nothing', () => {
    const grid = new TileGrid(512, 512, 1);
    const bus = new CommandBus(D1);
    bus.execute(must(buildTileWrite(grid, [cell(7, 7, 7)], D1.maxBytes)));
    const before = grid.snapshot();
    bus.transaction('t', (b) => {
      expect(codeOf(b.undo())).toBe('nested');
      expect(codeOf(b.redo())).toBe('nested');
      expect(same(grid.snapshot(), before)).toBe(true);
      b.execute(must(buildTileWrite(grid, [cell(8, 8, 8)], D1.maxBytes)));
    });
    expect(bus.stats().steps).toBe(2);
  });
});
