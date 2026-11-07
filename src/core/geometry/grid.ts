/** Portable, asset-independent map grid geometry. */
export type GridLine = Readonly<{
  axis: 'x' | 'y';
  coordinate: number;
  index: number;
}>;
export type GridResult =
  | Readonly<{ ok: true; lines: readonly GridLine[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;
export type GridOptions = Readonly<{
  minX: number; minY: number; maxX: number; maxY: number;
  originX: number; originY: number;
  stepX: number; stepY: number;
  maxLines?: number;
}>;

/**
 * Returns grid lines in deterministic order (vertical, then horizontal).
 * Lines are anchored at origin + integer * step, not at viewport edges,
 * so adjacent viewports produce matching coordinates.
 */
export function generateGridLines(options: GridOptions): GridResult {
  if (!options) return { ok: false, code: 'INPUT' };
  const { minX, minY, maxX, maxY, originX, originY, stepX, stepY } = options;
  const maxLines = options.maxLines ?? 4096;
  if (![minX, minY, maxX, maxY, originX, originY, stepX, stepY].every(Number.isFinite) ||
      minX > maxX || minY > maxY || stepX <= 0 || stepY <= 0 ||
      !Number.isSafeInteger(maxLines) || maxLines < 1) return { ok: false, code: 'INPUT' };

  const ranges: Array<readonly [number, number, number, number, 'x' | 'y']> = [
    [minX, maxX, originX, stepX, 'x'],
    [minY, maxY, originY, stepY, 'y'],
  ];
  const lines: GridLine[] = [];
  for (const [min, max, origin, step, axis] of ranges) {
    // A boundary quotient may round just above or just below an integer (e.g. 0.1 * 3 / 0.1, 4.3 / 0.1).
    // Begin one index earlier, end one index later, and let the exact coordinate bounds guard decide.
    const first = Math.floor((min - origin) / step);
    const last = Math.floor((max - origin) / step) + 1;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return { ok: false, code: 'LIMIT' };
    if (first > last) continue;
    const count = last - first + 1;
    if (!Number.isSafeInteger(count) || count > maxLines - lines.length) return { ok: false, code: 'LIMIT' };
    for (let index = first; index <= last; index++) {
      const coordinate = origin + index * step;
      if (!Number.isFinite(coordinate)) return { ok: false, code: 'LIMIT' };
      // Guard against floating-point cancellation at large magnitudes.
      if (coordinate < min || coordinate > max) continue;
      lines.push({ axis, coordinate: Object.is(coordinate, -0) ? 0 : coordinate, index });
    }
  }
  return { ok: true, lines };
}
