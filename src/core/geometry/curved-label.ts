/** Portable, font-independent glyph placement along a polyline. */
export type LabelPoint = Readonly<{ x: number; y: number }>;
export type GlyphPlacement = Readonly<{
  x: number; y: number; angle: number; distance: number; advance: number;
}>;
export type LabelLayoutResult =
  | Readonly<{ ok: true; pathLength: number; placements: readonly GlyphPlacement[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' | 'FIT' }>;

export type LabelLayoutOptions = Readonly<{
  points: readonly LabelPoint[];
  /** One measured advance per glyph, in the same units as path coordinates. */
  advances: readonly number[];
  /** Extra spacing between adjacent glyphs. */
  letterSpacing?: number;
  /** Position along the path: 0=start, 0.5=center, 1=end. */
  anchor?: number;
  maxGlyphs?: number;
}>;

/**
 * Places glyph centers at their measured advances along a path.
 * No font metrics are inferred: callers must supply measured advances.
 * Angle follows the forward segment tangent in the input coordinate system.
 * Zero-length segments are skipped; a glyph at a corner uses the incoming tangent.
 */
export function layoutCurvedLabel(options: LabelLayoutOptions): LabelLayoutResult {
  if (!options || !Array.isArray(options.points) || !Array.isArray(options.advances)) {
    return { ok: false, code: 'INPUT' };
  }
  const { points, advances } = options;
  const spacing = options.letterSpacing ?? 0;
  const anchor = options.anchor ?? 0.5;
  const maxGlyphs = options.maxGlyphs ?? 4096;
  if (points.length < 2 || !Number.isFinite(spacing) || spacing < 0 || !Number.isFinite(anchor) ||
      anchor < 0 || anchor > 1 || !Number.isSafeInteger(maxGlyphs) || maxGlyphs < 1) {
    return { ok: false, code: 'INPUT' };
  }
  if (points.length > 65536 || advances.length > maxGlyphs) return { ok: false, code: 'LIMIT' };
  if (advances.length === 0) return { ok: false, code: 'INPUT' };
  let textLength = 0;
  for (let i = 0; i < advances.length; i++) {
    const advance = advances[i];
    if (!Number.isFinite(advance) || advance <= 0) return { ok: false, code: 'INPUT' };
    textLength += advance;
    if (i > 0) textLength += spacing;
    if (!Number.isFinite(textLength)) return { ok: false, code: 'LIMIT' };
  }
  if (textLength <= 0) return { ok: false, code: 'INPUT' };

  const segments: Array<{ start: number; length: number; a: LabelPoint; b: LabelPoint }> = [];
  let pathLength = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ok: false, code: 'INPUT' };
    if (i === 0) continue;
    const a = points[i - 1];
    const length = Math.hypot(p.x - a.x, p.y - a.y);
    if (!Number.isFinite(length) || !Number.isFinite(pathLength + length)) return { ok: false, code: 'LIMIT' };
    if (length > 0) segments.push({ start: pathLength, length, a, b: p });
    pathLength += length;
  }
  if (pathLength === 0) return { ok: false, code: 'INPUT' };
  if (textLength > pathLength) return { ok: false, code: 'FIT' };

  const offset = (pathLength - textLength) * anchor;
  const placements: GlyphPlacement[] = [];
  let cursor = offset;
  let segmentIndex = 0;
  for (let i = 0; i < advances.length; i++) {
    const advance = advances[i];
    const distance = cursor + advance / 2;
    while (segmentIndex < segments.length - 1 &&
           distance > segments[segmentIndex].start + segments[segmentIndex].length) segmentIndex++;
    const segment = segments[segmentIndex];
    const t = Math.max(0, Math.min(1, (distance - segment.start) / segment.length));
    const x = segment.a.x + (segment.b.x - segment.a.x) * t;
    const y = segment.a.y + (segment.b.y - segment.a.y) * t;
    const angle = Math.atan2(segment.b.y - segment.a.y, segment.b.x - segment.a.x);
    if (![distance, x, y, angle].every(Number.isFinite)) return { ok: false, code: 'LIMIT' };
    placements.push({ x, y, angle, distance, advance });
    cursor += advance + (i < advances.length - 1 ? spacing : 0);
  }
  return { ok: true, pathLength, placements };
}
