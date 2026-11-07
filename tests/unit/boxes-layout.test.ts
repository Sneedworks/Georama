import { describe, expect, it } from 'vitest';
import { BoxError, type BoxRecord } from '../../src/core/boxes/record.ts';
import { layoutBox } from '../../src/core/boxes/layout.ts';

function makeRecord(overrides?: Partial<BoxRecord>): BoxRecord {
  return {
    margin: { left: 10, top: 20, right: 34, bottom: 44 },
    patch: { left: 1, top: 2, right: 1, bottom: 2 },
    stretch: { horizontal: 2, vertical: 2 },
    drawCenter: true,
    visible: true,
    image: { width: 6, height: 5, format: 'RGBA8', data: new Uint8Array(6 * 5 * 4) },
    ...overrides,
  };
}

function expectParam(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BoxError);
    expect((error as BoxError).code).toBe('param');
    return;
  }
  throw new Error('expected a BoxError with code param');
}

describe('layoutBox', () => {
  it('produces nine source and nine destination rectangles in row-major order', () => {
    const patches = layoutBox(makeRecord());
    expect(patches).toHaveLength(9);
    for (const p of patches) {
      expect(p.src.x1).toBeGreaterThanOrEqual(p.src.x0);
      expect(p.src.y1).toBeGreaterThanOrEqual(p.src.y0);
      expect(p.dst.x1).toBeGreaterThanOrEqual(p.dst.x0);
      expect(p.dst.y1).toBeGreaterThanOrEqual(p.dst.y0);
    }
  });

  it('keeps the four corners fixed', () => {
    const patches = layoutBox(makeRecord());
    // Texture 6 x 5 with insets left 1, top 2, right 1, bottom 2;
    // box rect (10, 20) to (34, 44).
    expect(patches[0].src).toEqual({ x0: 0, y0: 0, x1: 1, y1: 2 });
    expect(patches[0].dst).toEqual({ x0: 10, y0: 20, x1: 11, y1: 22 });
    expect(patches[2].src).toEqual({ x0: 5, y0: 0, x1: 6, y1: 2 });
    expect(patches[2].dst).toEqual({ x0: 33, y0: 20, x1: 34, y1: 22 });
    expect(patches[6].src).toEqual({ x0: 0, y0: 3, x1: 1, y1: 5 });
    expect(patches[6].dst).toEqual({ x0: 10, y0: 42, x1: 11, y1: 44 });
    expect(patches[8].src).toEqual({ x0: 5, y0: 3, x1: 6, y1: 5 });
    expect(patches[8].dst).toEqual({ x0: 33, y0: 42, x1: 34, y1: 44 });
  });

  it('stretches the edges and the centre to fill the box', () => {
    const patches = layoutBox(makeRecord());
    // Top edge and centre column of the middle row.
    expect(patches[1].src).toEqual({ x0: 1, y0: 0, x1: 5, y1: 2 });
    expect(patches[1].dst).toEqual({ x0: 11, y0: 20, x1: 33, y1: 22 });
    expect(patches[3].src).toEqual({ x0: 0, y0: 2, x1: 1, y1: 3 });
    expect(patches[3].dst).toEqual({ x0: 10, y0: 22, x1: 11, y1: 42 });
    expect(patches[4].src).toEqual({ x0: 1, y0: 2, x1: 5, y1: 3 });
    expect(patches[4].dst).toEqual({ x0: 11, y0: 22, x1: 33, y1: 42 });
    // The destination columns tile the box width exactly: 1 + 22 + 1 = 24.
    expect(patches[4].dst.x1 - patches[4].dst.x0).toBe(22);
  });

  it('sets the box rectangle to the margin rectangle', () => {
    const patches = layoutBox(makeRecord());
    const x0 = Math.min(...patches.map((p) => p.dst.x0));
    const y0 = Math.min(...patches.map((p) => p.dst.y0));
    const x1 = Math.max(...patches.map((p) => p.dst.x1));
    const y1 = Math.max(...patches.map((p) => p.dst.y1));
    expect([x0, y0, x1, y1]).toEqual([10, 20, 34, 44]);
  });

  it('refuses a box rectangle smaller than the insets with param', () => {
    const narrow = makeRecord({ margin: { left: 0, top: 0, right: 1, bottom: 10 } });
    expectParam(() => layoutBox(narrow));
    const short = makeRecord({ margin: { left: 0, top: 0, right: 10, bottom: 3 } });
    expectParam(() => layoutBox(short));
  });

  it('allows a zero-size centre', () => {
    const tight = makeRecord({ margin: { left: 0, top: 0, right: 2, bottom: 4 } });
    const patches = layoutBox(tight);
    expect(patches).toHaveLength(9);
    // Middle column and middle row both collapse (1 + 1 = 2 wide, 2 + 2 = 4 high).
    expect(patches[4].dst).toEqual({ x0: 1, y0: 2, x1: 1, y1: 2 });
    expect(patches[4].src).toEqual({ x0: 1, y0: 2, x1: 5, y1: 3 });
  });

  it('refuses a non-positive margin rectangle with param', () => {
    expectParam(() => layoutBox(makeRecord({ margin: { left: 10, top: 20, right: 10, bottom: 44 } })));
    expectParam(() => layoutBox(makeRecord({ margin: { left: 10, top: 20, right: 34, bottom: 20 } })));
    expectParam(() => layoutBox(makeRecord({ margin: { left: 30, top: 20, right: 10, bottom: 44 } })));
  });
});
