// Card 1.9, GREEN (core): grid rectangles. Detail v2 section 12.2 (grid) and errata E1.
// Pure: no DOM, no GL. Lines come from the existing generateGridLines; this file only turns them into rectangles.
import type { WdGrid } from '../formats/wonderdraft-map.ts';
import { generateGridLines } from '../geometry/grid.ts';
import { clipRect, colourOf, type Rect, snapSpan } from './rects.ts';

export interface ElementView {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

export interface ElementReport {
  readonly element: 'grid' | 'scale';
  readonly code: 'pattern' | 'segments' | 'distance' | 'rotation' | 'colours' | 'size' | 'INPUT' | 'LIMIT';
}

export interface ElementOutcome {
  readonly rects: readonly Rect[];
  readonly reports: readonly ElementReport[];
}

/** Scale finite and > 0; offsets finite; width and height safe integers >= 1. */
export function validView(v: ElementView): boolean {
  return (
    Number.isFinite(v.scale) &&
    v.scale > 0 &&
    Number.isFinite(v.offsetX) &&
    Number.isFinite(v.offsetY) &&
    Number.isSafeInteger(v.width) &&
    v.width >= 1 &&
    Number.isSafeInteger(v.height) &&
    v.height >= 1
  );
}

function refuse(element: ElementReport['element'], code: ElementReport['code']): ElementOutcome {
  return { rects: [], reports: [{ element, code }] };
}

/** Grid rectangles over the visible range, vertical lines first (detail 12.2). maxLines defaults to 4096. */
export function gridRects(grid: WdGrid, view: ElementView, maxLines = 4096): ElementOutcome {
  if (!validView(view)) return refuse('grid', 'INPUT'); // E1: the view check runs first.
  if (grid.pattern !== 1) return refuse('grid', 'pattern');
  if (!Number.isFinite(grid.size) || grid.size <= 0 || !Number.isFinite(grid.lineWidth) || grid.lineWidth < 0) {
    return refuse('grid', 'INPUT');
  }

  const { scale, offsetX, offsetY, width, height } = view;
  const lines = generateGridLines({
    minX: -offsetX / scale,
    minY: -offsetY / scale,
    maxX: (width - offsetX) / scale,
    maxY: (height - offsetY) / scale,
    originX: grid.offset.x,
    originY: grid.offset.y,
    stepX: grid.size,
    stepY: grid.size,
    maxLines,
  });
  if (!lines.ok) return refuse('grid', lines.code);

  const colour = colourOf(grid.color);
  const lineWidthPx = grid.lineWidth * scale;
  const rects: Rect[] = [];
  for (const line of lines.lines) {
    const across = snapSpan(line.coordinate * scale + (line.axis === 'x' ? offsetX : offsetY), lineWidthPx);
    if (across === null) continue;
    const rect: Rect =
      line.axis === 'x'
        ? { x0: across.lo, x1: across.hi, y0: 0, y1: height, rgba: colour }
        : { x0: 0, x1: width, y0: across.lo, y1: across.hi, rgba: colour };
    const clipped = clipRect(rect, width, height);
    if (clipped !== null) rects.push(clipped);
  }
  return { rects, reports: [] };
}
