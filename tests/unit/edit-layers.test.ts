// Card 2.4, detail v2 (977da8d; status a80183a): acceptance tests A1-A8.
// RED stage: this file imports modules that do not exist yet (src/core/edit/layers.ts).
// A1 covers the listed operations (add, rename, move, visibility, opacity, tile writes);
// removal is covered by A5.
import { describe, expect, it } from 'vitest';
import { TILE } from '../../src/core/edit/tiles.ts';
import type { CellWrite } from '../../src/core/edit/tile-command.ts';
import {
  EditLayerStack,
  MAX_LAYERS,
  MAX_NAME,
  type EditLayer,
  type LayerVerdict,
} from '../../src/core/edit/layers.ts';

const OPTS = { width: 256, height: 256, channels: 1, maxSteps: 1000, maxBytes: 128 * 1024 * 1024 };

function must<T>(v: LayerVerdict<T>): T {
  if (!v.ok) throw new Error(`verdict ${v.code}`);
  return v.value;
}

function codeOf<T>(v: LayerVerdict<T>): string {
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

function need(s: EditLayerStack, id: number): EditLayer {
  const layer = s.layer(id);
  if (layer === undefined) throw new Error(`no layer ${id}`);
  return layer;
}

interface Frame {
  readonly id: number;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly bytes: Uint8Array;
}

function frames(s: EditLayerStack): Frame[] {
  return s.layers().map((l) => ({
    id: l.id,
    name: l.name,
    visible: l.visible,
    opacity: l.opacity,
    bytes: l.grid.snapshot(),
  }));
}

function sameFrames(a: readonly Frame[], b: readonly Frame[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((f, i) => {
    const g = b[i];
    return (
      g !== undefined &&
      f.id === g.id &&
      f.name === g.name &&
      f.visible === g.visible &&
      f.opacity === g.opacity &&
      same(f.bytes, g.bytes)
    );
  });
}

describe('card 2.4 A1: sequence round trip', () => {
  it('undo to the start and redo forward reproduce every recorded state', () => {
    const s = new EditLayerStack(OPTS);
    const steps: Array<(st: EditLayerStack) => LayerVerdict<unknown>> = [
      (st) => st.addLayer('Ground'),
      (st) => st.writeTiles(2, [cell(10, 10, 200)]),
      (st) => st.addLayer('Water', 0),
      (st) => st.renameLayer(1, 'Base'),
      (st) => st.moveLayer(3, 2),
      (st) => st.setVisible(2, false),
      (st) => st.setOpacity(1, 50),
      (st) => st.writeTiles(3, [cell(200, 100, 77), cell(5, 5, 9)]),
    ];
    const recorded: Frame[][] = [frames(s)];
    for (const step of steps) {
      expect(step(s).ok).toBe(true);
      recorded.push(frames(s));
    }
    for (let k = 1; k <= steps.length; k += 1) {
      expect(s.undo().ok).toBe(true);
      expect(sameFrames(frames(s), recorded[steps.length - k])).toBe(true);
    }
    expect(s.canUndo()).toBe(false);
    expect(codeOf(s.undo())).toBe('empty-history');
    for (let k = 1; k <= steps.length; k += 1) {
      expect(s.redo().ok).toBe(true);
      expect(sameFrames(frames(s), recorded[k])).toBe(true);
    }
    expect(s.canRedo()).toBe(false);
  });
});

describe('card 2.4 A2: ids are never reused', () => {
  it('a new layer after undoing a removal and an add gets an id larger than every id seen', () => {
    const s = new EditLayerStack(OPTS);
    const a = must(s.addLayer('A'));
    must(s.removeLayer(a));
    expect(s.undo().ok).toBe(true); // restores A
    expect(s.undo().ok).toBe(true); // removes the add
    const b = must(s.addLayer('B'));
    expect(b).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(1);
  });
});

describe('card 2.4 A3: opacity range', () => {
  it('opacity outside an integer 0-100 is refused and changes nothing', () => {
    const s = new EditLayerStack(OPTS);
    const before = frames(s);
    for (const bad of [101, -1, 1.5, Number.NaN]) {
      expect(codeOf(s.setOpacity(1, bad))).toBe('range');
    }
    expect(sameFrames(frames(s), before)).toBe(true);
    expect(s.canUndo()).toBe(false);
    expect(need(s, 1).opacity).toBe(100);
  });
});

describe('card 2.4 A4: layer cap', () => {
  it('the 64th add (the 65th layer) is refused with limit and changes nothing', () => {
    expect(MAX_LAYERS).toBe(64);
    const s = new EditLayerStack(OPTS);
    for (let i = 0; i < MAX_LAYERS - 1; i += 1) {
      must(s.addLayer(`L${i}`));
    }
    expect(s.layers().length).toBe(MAX_LAYERS);
    expect(codeOf(s.addLayer('overflow'))).toBe('limit');
    expect(s.layers().length).toBe(MAX_LAYERS);
    // The last successful add is still the newest step; the refusal left no step behind.
    expect(s.undo().ok).toBe(true);
    expect(s.layers().length).toBe(MAX_LAYERS - 1);
  });
});

describe('card 2.4 A5: removal and undo', () => {
  it('undo restores the same grid object with every tile byte unchanged', () => {
    const s = new EditLayerStack(OPTS);
    const id = must(s.addLayer('Doomed'));
    must(s.writeTiles(id, [cell(5, 5, 11), cell(200, 5, 22)])); // two tiles: columns 0 and 1
    const grid = need(s, id).grid;
    const bytes = grid.snapshot();
    const order = s.layers().map((l) => l.id);
    must(s.removeLayer(id));
    expect(s.layer(id)).toBeUndefined();
    expect(s.undo().ok).toBe(true);
    expect(s.layers().map((l) => l.id)).toEqual(order);
    expect(need(s, id).grid).toBe(grid);
    expect(same(need(s, id).grid.snapshot(), bytes)).toBe(true);
  });
});

describe('card 2.4 A6: write isolation and refusals', () => {
  it('a write touches only its own layer; refused writes change nothing', () => {
    const s = new EditLayerStack(OPTS);
    const a = 1;
    const b = must(s.addLayer('B'));
    must(s.writeTiles(a, [cell(3, 3, 5)]));
    const aBefore = need(s, a).grid.snapshot();
    must(s.writeTiles(b, [cell(40, 40, 9)]));
    expect(same(need(s, a).grid.snapshot(), aBefore)).toBe(true);
    const bBefore = need(s, b).grid.snapshot();
    expect(
      codeOf(s.writeTiles(b, [{ x: 0, y: 0, channels: 2, value: new Uint8Array([1, 2]) }])),
    ).toBe('channels');
    expect(
      codeOf(s.writeTiles(b, [{ x: 0, y: 0, channels: 1, value: new Uint8Array([1, 2]) }])),
    ).toBe('value-length');
    expect(codeOf(s.writeTiles(b, [cell(999, 0, 1)]))).toBe('range');
    expect(codeOf(s.writeTiles(b, [cell(40, 40, 9)]))).toBe('noop');
    expect(same(need(s, b).grid.snapshot(), bBefore)).toBe(true);
    expect(same(need(s, a).grid.snapshot(), aBefore)).toBe(true);
    // An oversize batch: one write to an absent tile costs TILE * TILE * channels bytes.
    const tight = new EditLayerStack({ ...OPTS, maxBytes: TILE * TILE - 1 });
    const tightBefore = frames(tight);
    expect(codeOf(tight.writeTiles(1, [cell(5, 5, 9)]))).toBe('too-large');
    expect(sameFrames(frames(tight), tightBefore)).toBe(true);
    const fits = new EditLayerStack({ ...OPTS, maxBytes: TILE * TILE });
    expect(codeOf(fits.writeTiles(1, [cell(5, 5, 9)]))).toBe('ok');
  });
});

describe('card 2.4 A7: names', () => {
  it('empty, whitespace-only and 65-character names are refused; 64 characters is accepted', () => {
    expect(MAX_NAME).toBe(64);
    const s = new EditLayerStack(OPTS);
    expect(codeOf(s.addLayer(''))).toBe('name');
    expect(codeOf(s.addLayer('   '))).toBe('name');
    expect(codeOf(s.addLayer('x'.repeat(65)))).toBe('name');
    expect(codeOf(s.renameLayer(1, 'x'.repeat(65)))).toBe('name');
    expect(s.layers().length).toBe(1);
    expect(codeOf(s.renameLayer(1, 'y'.repeat(64)))).toBe('ok');
    expect(need(s, 1).name).toBe('y'.repeat(64));
  });
});

describe('card 2.4 A8: indices and ids', () => {
  it('a toIndex outside 0 to n-1 is index; a no-op move is noop; an unknown id is layer', () => {
    const s = new EditLayerStack(OPTS);
    must(s.addLayer('B')); // ids 1 and 2, so n = 2
    expect(codeOf(s.moveLayer(1, 2))).toBe('index');
    expect(codeOf(s.moveLayer(1, -1))).toBe('index');
    expect(codeOf(s.moveLayer(1, 0))).toBe('noop');
    expect(codeOf(s.moveLayer(99, 0))).toBe('layer');
    expect(codeOf(s.renameLayer(99, 'x'))).toBe('layer');
    expect(codeOf(s.removeLayer(99))).toBe('layer');
    expect(codeOf(s.setVisible(99, false))).toBe('layer');
    expect(codeOf(s.setOpacity(99, 50))).toBe('layer');
    expect(codeOf(s.writeTiles(99, [cell(0, 0, 1)]))).toBe('layer');
    expect(s.layers().map((l) => l.id)).toEqual([1, 2]);
  });
});
