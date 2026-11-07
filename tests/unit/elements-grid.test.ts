import { describe, expect, it } from 'vitest';
import type { WdGrid } from '../../src/core/formats/wonderdraft-map.ts';
import { gridRects, validView, type ElementView } from '../../src/core/elements/grid.ts';

const grid: WdGrid = {
  pattern: 1,
  layer: 0,
  size: 64,
  lineWidth: 4,
  color: { r: 1, g: 0, b: 0, a: 1 },
  offset: { x: 0, y: 0 },
};
const view: ElementView = { scale: 1, offsetX: 0, offsetY: 0, width: 256, height: 192 };

describe('validView', () => {
  it('accepts a positive finite view with integer size', () => {
    expect(validView(view)).toBe(true);
  });

  it('rejects a zero scale, a zero width and a non-finite offset', () => {
    expect(validView({ ...view, scale: 0 })).toBe(false);
    expect(validView({ ...view, width: 0 })).toBe(false);
    expect(validView({ ...view, offsetX: Number.NaN })).toBe(false);
  });

  it('rejects a negative or infinite scale, a fractional width and a NaN y offset', () => {
    expect(validView({ ...view, scale: -1 })).toBe(false);
    expect(validView({ ...view, scale: Number.POSITIVE_INFINITY })).toBe(false);
    expect(validView({ ...view, width: 1.5 })).toBe(false);
    expect(validView({ ...view, offsetY: Number.NaN })).toBe(false);
  });
});

describe('gridRects', () => {
  it('draws five vertical lines then four horizontal lines for the fixture', () => {
    const out = gridRects(grid, view);
    expect(out.reports).toEqual([]);
    expect(out.rects).toHaveLength(9);
    const vertical = out.rects.slice(0, 5);
    const horizontal = out.rects.slice(5);
    // x = 0, 64, 128, 192, 256; the edge lines are clipped to the target.
    expect(vertical.map((r) => [r.x0, r.x1])).toEqual([[0, 2], [62, 66], [126, 130], [190, 194], [254, 256]]);
    expect(vertical.every((r) => r.y0 === 0 && r.y1 === 192)).toBe(true);
    // y = 0, 64, 128, 192; the bottom line is clipped to the target height.
    expect(horizontal.map((r) => [r.y0, r.y1])).toEqual([[0, 2], [62, 66], [126, 130], [190, 192]]);
    expect(horizontal.every((r) => r.x0 === 0 && r.x1 === 256)).toBe(true);
    expect(out.rects.every((r) => r.rgba.join() === '1,0,0,1')).toBe(true);
  });

  it('reports pattern and draws nothing for a pattern other than 1', () => {
    expect(gridRects({ ...grid, pattern: 2 }, view)).toEqual({
      rects: [],
      reports: [{ element: 'grid', code: 'pattern' }],
    });
  });

  it('reports INPUT for a non-positive step or a negative line width', () => {
    expect(gridRects({ ...grid, size: 0 }, view).reports).toEqual([{ element: 'grid', code: 'INPUT' }]);
    expect(gridRects({ ...grid, lineWidth: -1 }, view).reports).toEqual([{ element: 'grid', code: 'INPUT' }]);
  });

  it('reports INPUT for a non-finite step or line width', () => {
    expect(gridRects({ ...grid, size: Number.NaN }, view).reports).toEqual([{ element: 'grid', code: 'INPUT' }]);
    expect(gridRects({ ...grid, lineWidth: Number.POSITIVE_INFINITY }, view).reports).toEqual([
      { element: 'grid', code: 'INPUT' },
    ]);
  });

  it('draws nothing and reports nothing for a zero line width', () => {
    expect(gridRects({ ...grid, lineWidth: 0 }, view)).toEqual({ rects: [], reports: [] });
  });

  it('reports LIMIT when the lines exceed maxLines', () => {
    expect(gridRects(grid, view, 3)).toEqual({ rects: [], reports: [{ element: 'grid', code: 'LIMIT' }] });
  });

  it('anchors the lines at the record offset', () => {
    const out = gridRects({ ...grid, offset: { x: 10, y: 0 } }, view);
    expect(out.rects).toHaveLength(8);
    expect(out.rects.slice(0, 4).map((r) => [r.x0, r.x1])).toEqual([[8, 12], [72, 76], [136, 140], [200, 204]]);
  });

  it('anchors the horizontal lines at the record offset y', () => {
    const out = gridRects({ ...grid, offset: { x: 0, y: 10 } }, view);
    expect(out.rects).toHaveLength(8);
    expect(out.rects.slice(5).map((r) => [r.y0, r.y1])).toEqual([[8, 12], [72, 76], [136, 140]]);
  });

  it('applies the view scale and the view y offset to the lines', () => {
    const scaled: ElementView = { scale: 2, offsetX: 0, offsetY: 10, width: 512, height: 384 };
    const out = gridRects(grid, scaled);
    expect(out.reports).toEqual([]);
    expect(out.rects).toHaveLength(8);
    // Vertical: map x 0, 64, 128, 192, 256 at scale 2 (px 0, 128, 256, 384, 512); line width 8 px.
    expect(out.rects.slice(0, 5).map((r) => [r.x0, r.x1])).toEqual([[0, 4], [124, 132], [252, 260], [380, 388], [508, 512]]);
    // Horizontal: map y 0, 64, 128 at scale 2 plus the offset 10 (px 10, 138, 266); line width 8 px.
    expect(out.rects.slice(5).map((r) => [r.y0, r.y1])).toEqual([[6, 14], [134, 142], [262, 270]]);
  });

  it('checks the view first, before the pattern (E1)', () => {
    expect(gridRects({ ...grid, pattern: 2 }, { ...view, scale: 0 })).toEqual({
      rects: [],
      reports: [{ element: 'grid', code: 'INPUT' }],
    });
    expect(gridRects(grid, { ...view, width: 0 }).reports).toEqual([{ element: 'grid', code: 'INPUT' }]);
  });
});
