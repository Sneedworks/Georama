import { describe, expect, it } from 'vitest';
import { clipRect, colourOf, snapEdge, snapSpan, spanOfEdges, type Rect } from '../../src/core/elements/rects.ts';

describe('snapEdge', () => {
  it('rounds half up with Math.floor(v + 0.5)', () => {
    expect(snapEdge(2.5)).toBe(3);
    expect(snapEdge(2.49)).toBe(2);
    expect(snapEdge(-0.5)).toBe(0);
    expect(snapEdge(-1.5)).toBe(-1);
  });
});

describe('spanOfEdges', () => {
  it('returns the half-open snapped span', () => {
    expect(spanOfEdges(0.4, 10.4)).toEqual({ lo: 0, hi: 10 });
  });

  it('returns null for an empty or non-finite span', () => {
    expect(spanOfEdges(5, 5)).toBeNull();
    expect(spanOfEdges(9, 3)).toBeNull();
    expect(spanOfEdges(Number.NaN, 3)).toBeNull();
    expect(spanOfEdges(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('snapSpan', () => {
  it('centres the span on the centre with the given width', () => {
    expect(snapSpan(10, 4)).toEqual({ lo: 8, hi: 12 });
  });

  it('returns null for zero or non-finite width', () => {
    expect(snapSpan(10, 0)).toBeNull();
    expect(snapSpan(10, Number.NaN)).toBeNull();
  });
});

describe('clipRect', () => {
  const rgba = [1, 0, 0, 1] as const;

  it('clips to the target', () => {
    const r: Rect = { x0: -2, y0: 0, x1: 2, y1: 5, rgba };
    expect(clipRect(r, 10, 10)).toEqual({ x0: 0, y0: 0, x1: 2, y1: 5, rgba });
  });

  it('returns null when nothing remains', () => {
    const r: Rect = { x0: 20, y0: 0, x1: 25, y1: 5, rgba };
    expect(clipRect(r, 10, 10)).toBeNull();
  });

  it('clips the vertical extent as well as the horizontal one', () => {
    const tall: Rect = { x0: 0, y0: -3, x1: 4, y1: 500, rgba };
    expect(clipRect(tall, 10, 10)).toEqual({ x0: 0, y0: 0, x1: 4, y1: 10, rgba });
    const below: Rect = { x0: 0, y0: 12, x1: 4, y1: 15, rgba };
    expect(clipRect(below, 10, 10)).toBeNull();
  });
});

describe('colourOf', () => {
  it('returns [r, g, b, a] in order', () => {
    expect(colourOf({ r: 1, g: 0.5, b: 0, a: 1 })).toEqual([1, 0.5, 0, 1]);
  });

  it('clamps each channel to [0, 1] and maps a non-finite channel to 0 (E2)', () => {
    expect(colourOf({ r: 1.2, g: -0.3, b: Number.NaN, a: 0.25 })).toEqual([1, 0, 0, 0.25]);
  });

  it('maps infinite channels to 0 and clamps alpha above 1 (E2)', () => {
    expect(
      colourOf({ r: Number.POSITIVE_INFINITY, g: Number.NEGATIVE_INFINITY, b: 0.5, a: Number.POSITIVE_INFINITY }),
    ).toEqual([0, 0, 0.5, 0]);
    expect(colourOf({ r: 0, g: 0, b: 0, a: 2 })).toEqual([0, 0, 0, 1]);
  });
});
