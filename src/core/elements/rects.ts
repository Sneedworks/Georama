// Card 1.9, GREEN (core): rectangles for the grid and scale elements. Detail v2 section 12.1 and errata E2.
// Pure: no DOM, no GL. Edges are integers after snapping; a rectangle is half-open: [x0, x1) by [y0, y1).

export type RectColour = readonly [number, number, number, number];

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly rgba: RectColour;
}

export interface Span {
  readonly lo: number;
  readonly hi: number;
}

/** Half up: Math.floor(v + 0.5). */
export function snapEdge(v: number): number {
  return Math.floor(v + 0.5);
}

/** [snapEdge(a), snapEdge(b)); null if an input is not finite or the snapped span is empty. */
export function spanOfEdges(a: number, b: number): Span | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = snapEdge(a);
  const hi = snapEdge(b);
  return hi > lo ? { lo, hi } : null;
}

/** The span centred on `centre` with `width`; null if an input is not finite or the span is empty. */
export function snapSpan(centre: number, width: number): Span | null {
  if (!Number.isFinite(centre) || !Number.isFinite(width)) return null;
  return spanOfEdges(centre - width / 2, centre + width / 2);
}

/** Intersection with [0, width) x [0, height); null when nothing remains. */
export function clipRect(r: Rect, width: number, height: number): Rect | null {
  const x0 = Math.max(r.x0, 0);
  const y0 = Math.max(r.y0, 0);
  const x1 = Math.min(r.x1, width);
  const y1 = Math.min(r.y1, height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1, rgba: r.rgba };
}

/** Clamp to [0, 1]; a non-finite channel becomes 0 (E2). */
function channel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** [r, g, b, a] from a Wonderdraft colour record; every channel is clamped to [0, 1] (E2). */
export function colourOf(c: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): RectColour {
  return [channel(c.r), channel(c.g), channel(c.b), channel(c.a)];
}
