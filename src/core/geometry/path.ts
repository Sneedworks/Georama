/** Portable, asset-independent path geometry for future textured paths. */
export type Point2 = Readonly<{ x: number; y: number }>;
export type PathSample = Readonly<{
  x: number; y: number;
  tangentX: number; tangentY: number;
  normalX: number; normalY: number;
  distance: number;
  u: number;
}>;
export type PathResult =
  | Readonly<{ ok: true; length: number; samples: readonly PathSample[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;

/** Samples a polyline at fixed arc-length intervals, including both endpoints.
 * Zero-length segments are ignored. The normal is the left-hand perpendicular
 * to the forward tangent in the input coordinate system.
 * u is distance / texturePeriod, so it is continuous across segment joins.
 */
export function samplePath(
  points: readonly Point2[], spacing: number, texturePeriod: number,
  maxSamples = 65536,
): PathResult {
  if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(spacing) || spacing <= 0 ||
      !Number.isFinite(texturePeriod) || texturePeriod <= 0 ||
      !Number.isSafeInteger(maxSamples) || maxSamples < 2) return { ok: false, code: 'INPUT' };
  if (points.length > 65536) return { ok: false, code: 'LIMIT' };
  const lengths: number[] = [];
  const starts: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ok: false, code: 'INPUT' };
    if (i === 0) continue;
    const a = points[i - 1];
    const length = Math.hypot(p.x - a.x, p.y - a.y);
    if (!Number.isFinite(length) || !Number.isFinite(total + length)) return { ok: false, code: 'LIMIT' };
    starts.push(total);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return { ok: false, code: 'INPUT' };
  const count = Math.ceil(total / spacing) + 1;
  if (!Number.isSafeInteger(count) || count > maxSamples) return { ok: false, code: 'LIMIT' };
  const samples: PathSample[] = [];
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const distance = i === count - 1 ? total : i * spacing;
    while (segment < lengths.length - 1 && (lengths[segment] === 0 || distance > starts[segment] + lengths[segment])) segment++;
    if (lengths[segment] === 0) {
      while (segment > 0 && lengths[segment] === 0) segment--;
    }
    const len = lengths[segment];
    if (len === 0) return { ok: false, code: 'INPUT' };
    const a = points[segment];
    const b = points[segment + 1];
    const t = Math.max(0, Math.min(1, (distance - starts[segment]) / len));
    const tangentX = (b.x - a.x) / len;
    const tangentY = (b.y - a.y) / len;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const u = distance / texturePeriod;
    if (![x, y, tangentX, tangentY, u].every(Number.isFinite)) return { ok: false, code: 'LIMIT' };
    samples.push({ x, y, tangentX, tangentY, normalX: -tangentY, normalY: tangentX, distance, u });
  }
  return { ok: true, length: total, samples };
}
