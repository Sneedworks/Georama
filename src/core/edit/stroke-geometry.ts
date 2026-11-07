// Card 2.6, detail v1.11 section 4 (extraction approved at b413894): the stroke geometry shared by the
// landmass brush (card 2.5, src/core/edit/landmass.ts) and the ground tool (card 2.6). The checks, the
// bounds and the cell order are the card 2.5 ones, moved unchanged. Core code: no DOM and no Node APIs.

/** D3: the largest radius, in cells (assumed, not measured). */
export const MAX_RADIUS = 2 ** 5;
/** D4: the most points in one stroke (assumed, not measured). */
export const MAX_POINTS = 2 ** 9;
/** D6: the work bound, line cells times disc cells (assumed, not measured). */
export const MAX_WORK = 2 ** 24;
/** D7: the most distinct in-layer cells one stroke may write (assumed, not measured). */
export const MAX_STROKE_CELLS = 2 ** 18;
/** D4 and D9 (4): the largest coordinate magnitude (owner decision, 2026-11-04). Module-private. */
const COORD_LIMIT = 2 ** 40;

export type StrokeCode = 'range' | 'too-large';

export type StrokeVerdict<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StrokeCode };

export interface StrokeGeometryOptions {
  readonly width: number;
  readonly height: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly radius: number;
}

function fail(code: StrokeCode): StrokeVerdict<never> {
  return { ok: false, code };
}

/** D3: the integer offsets (dx, dy) with dx * dx + dy * dy <= radius * radius. */
function discOffsets(radius: number): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

/**
 * D4: visits the Bresenham cells of one segment in order, both ends included. Stops early, and returns
 * false, as soon as `visit` returns false.
 */
function visitSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => boolean,
): boolean {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (!visit(x, y)) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * The distinct in-layer cells of one stroke (D1 to D9, geometry only), in emission order. Nothing is
 * written here. Check order (D9): radius, layer bounds, point count, coordinates, work (D6), cells (D7).
 */
export function strokeCells(options: StrokeGeometryOptions): StrokeVerdict<{ x: number; y: number }[]> {
  const { width, height, points, radius } = options;

  // D9 (1) and (2).
  if (!Number.isInteger(radius) || radius < 1 || radius > MAX_RADIUS) return fail('range');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) return fail('range');

  // D9 (3) and (4). Each coordinate is an integer of magnitude at most COORD_LIMIT, so every walk value stays exact.
  if (points.length === 0) return fail('range');
  if (points.length > MAX_POINTS) return fail('too-large');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return fail('range');
    if (Math.abs(p.x) > COORD_LIMIT || Math.abs(p.y) > COORD_LIMIT) return fail('range');
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // D4 and D6: the steps are 1 plus the sum over the segments of max(|dx|, |dy|), counted from the endpoints
  // before any walk. A stroke above the limit is refused here, so the walk runs only when its steps are at most
  // lineLimit, and the walk is bounded by lineLimit.
  const offsets = discOffsets(radius);
  const lineLimit = Math.floor(MAX_WORK / offsets.length);
  let steps = 1;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (from === undefined || to === undefined) return fail('range');
    steps += Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  }
  if (steps > lineLimit) return fail('too-large');
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const lineExact = spanX * spanY <= Number.MAX_SAFE_INTEGER;
  const lineSeen = new Set<number | string>();
  const lineX: number[] = [];
  const lineY: number[] = [];
  const addLine = (x: number, y: number): boolean => {
    const key = lineExact ? (x - minX) * spanY + (y - minY) : `${x},${y}`;
    if (lineSeen.has(key)) return true;
    // Guard only: after the step check, the distinct line cells cannot exceed lineLimit, so this cannot refuse.
    if (lineX.length >= lineLimit) return false;
    lineSeen.add(key);
    lineX.push(x);
    lineY.push(y);
    return true;
  };
  const first = points[0];
  if (first === undefined) return fail('range');
  if (!addLine(first.x, first.y)) return fail('too-large');
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (from === undefined || to === undefined) return fail('range');
    if (!visitSegment(from.x, from.y, to.x, to.y, addLine)) return fail('too-large');
  }

  // D5 and D7: stamp each line cell's disc; keep only in-layer cells, each once; refuse past MAX_STROKE_CELLS.
  const cellExact = width * height <= Number.MAX_SAFE_INTEGER;
  const cellSeen = new Set<number | string>();
  const outX: number[] = [];
  const outY: number[] = [];
  for (let i = 0; i < lineX.length; i += 1) {
    const cx = lineX[i];
    const cy = lineY[i];
    if (cx === undefined || cy === undefined) break;
    for (const [dx, dy] of offsets) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const key = cellExact ? x * height + y : `${x},${y}`;
      if (cellSeen.has(key)) continue;
      if (outX.length >= MAX_STROKE_CELLS) return fail('too-large');
      cellSeen.add(key);
      outX.push(x);
      outY.push(y);
    }
  }

  const cells: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < outX.length; i += 1) {
    const x = outX[i];
    const y = outY[i];
    if (x === undefined || y === undefined) break;
    cells.push({ x, y });
  }
  return { ok: true, value: cells };
}
