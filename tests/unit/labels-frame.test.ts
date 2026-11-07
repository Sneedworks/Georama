// Card 1.8f, step 5 (RED): pure frame placement, detail v14. The frame state is AtlasItem records, because packAtlas needs the sizes.
// placeFrame reuses packAtlas (src/core/symbols/atlas.ts) unchanged and is not re-tested here.
import { describe, expect, it } from 'vitest';
import { placeFrame } from '../../src/core/labels/frame.ts';
import type { AtlasItem, AtlasOptions } from '../../src/core/symbols/atlas.ts';

const opts: AtlasOptions = { maxSide: 256, maxPages: 1, padding: 0 };
const item = (key: string, size = 32): AtlasItem => ({ key, width: size, height: size });
const label = (id: string, ...items: AtlasItem[]) => ({ id, items });
const keysOf = (items: readonly AtlasItem[]) => items.map((i) => i.key);
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

describe('placeFrame: all fit (detail v14)', () => {
  it('draws all labels with one packing and no clear', () => {
    const plan = placeFrame([label('A', item('A')), label('B', item('B'))], [], opts);
    expect(plan.drawn).toEqual(['A', 'B']);
    expect(plan.dropped).toEqual([]);
    expect(plan.cleared).toBe(false);
    expect(plan.packings).toBe(1);
    expect(keysOf(plan.resident)).toEqual(['A', 'B']);
  });

  it('with a non-empty input resident, the output resident is the union, sorted by key', () => {
    const plan = placeFrame([label('A', item('A')), label('B', item('B'))], [item('R1')], opts);
    expect(plan.drawn).toEqual(['A', 'B']);
    expect(plan.cleared).toBe(false);
    expect(keysOf(plan.resident)).toEqual(['A', 'B', 'R1']);
  });
});

describe('placeFrame: oversize (detail v14)', () => {
  it('drops a label with an oversize item whole and draws the rest', () => {
    const plan = placeFrame([label('A', item('A')), label('X', item('X', 2100)), label('B', item('B'))], [], opts);
    expect(plan.drawn).toEqual(['A', 'B']);
    expect(plan.dropped).toEqual([{ id: 'X', reason: 'oversize' }]);
    expect(plan.cleared).toBe(false);
    expect(plan.packings).toBe(1);
    expect(keysOf(plan.resident)).toEqual(['A', 'B']);
  });

  it('a frame with nothing to pack packs nothing and keeps the resident as given', () => {
    const plan = placeFrame([label('X', item('X', 2100))], [item('R1')], opts);
    expect(plan.drawn).toEqual([]);
    expect(plan.dropped).toEqual([{ id: 'X', reason: 'oversize' }]);
    expect(plan.packings).toBe(0);
    expect(plan.cleared).toBe(false);
    expect(keysOf(plan.resident)).toEqual(['R1']);
  });
});

describe('placeFrame: LIMIT (detail v14)', () => {
  it('a LIMIT from the resident set is cleared and the frame is drawn', () => {
    const resident = many(200, (i) => item(`R${String(i).padStart(3, '0')}`));
    const plan = placeFrame([label('A', item('A'))], resident, opts);
    expect(plan.drawn).toEqual(['A']);
    expect(plan.dropped).toEqual([]);
    expect(plan.cleared).toBe(true);
    expect(plan.packings).toBe(2);
    expect(keysOf(plan.resident)).toEqual(['A']);
  });

  it('after the clear, drops only the label that does not fit at its turn and draws later labels that fit', () => {
    const big = label('big', ...many(300, (i) => item(`G${String(i).padStart(3, '0')}`)));
    const plan = placeFrame([label('A', item('A')), big, label('B', item('B'))], [], opts);
    expect(plan.drawn).toEqual(['A', 'B']);
    expect(plan.dropped).toEqual([{ id: 'big', reason: 'no-fit-after-clear' }]);
    expect(plan.cleared).toBe(true);
    expect(plan.packings).toBe(5);
    expect(keysOf(plan.resident)).toEqual(['A', 'B']);
  });

  it('dropped entries are in frame order across reasons', () => {
    const big = label('big', ...many(300, (i) => item(`G${String(i).padStart(3, '0')}`)));
    const plan = placeFrame([big, label('X', item('X', 2100)), label('B', item('B'))], [], opts);
    expect(plan.drawn).toEqual(['B']);
    expect(plan.dropped).toEqual([
      { id: 'big', reason: 'no-fit-after-clear' },
      { id: 'X', reason: 'oversize' },
    ]);
    expect(plan.cleared).toBe(true);
    expect(plan.packings).toBe(4);
  });
});

describe('placeFrame: shared keys and labels without items (detail v14)', () => {
  it('a key shared by many labels is packed once: all drawn, no clear', () => {
    const labels = many(300, (i) => label(`L${i}`, item('K')));
    const plan = placeFrame(labels, [], opts);
    expect(plan.drawn).toEqual(labels.map((l) => l.id));
    expect(plan.dropped).toEqual([]);
    expect(plan.cleared).toBe(false);
    expect(plan.packings).toBe(1);
    expect(keysOf(plan.resident)).toEqual(['K']);
  });

  it('a label with no items is neither drawn nor dropped', () => {
    const plan = placeFrame([label('E'), label('A', item('A'))], [], opts);
    expect(plan.drawn).toEqual(['A']);
    expect(plan.dropped).toEqual([]);
    expect(plan.packings).toBe(1);
  });
});

describe('placeFrame: determinism (detail v14)', () => {
  it('the same input gives the same plan', () => {
    const frame = [label('A', item('A')), label('big', ...many(300, (i) => item(`G${i}`)))];
    expect(placeFrame(frame, [], opts)).toEqual(placeFrame(frame, [], opts));
  });
});
