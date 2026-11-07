// Card 1.7, step 2 (GREEN): closure and the border wrappers. The closure is the only new rule (B1); everything
// else is the card 1.6 path mechanism, reused unchanged.
import { PathError, pathIndexTable, pathLayerReference, type PathIndexTable, type PathStyle } from '../paths/textured.ts';

/**
 * B1. An odd length is refused first (length). An open outline comes back as the same object. A closed outline comes
 * back as a new array: the input pairs followed by a raw copy of the first pair, before any rounding. An empty closed
 * outline has no first pair to copy, so it stays empty; the path table then refuses it (fewer than two vertices).
 */
export function closeOutline(points: Float32Array, closed: boolean): Float32Array {
  if (points.length % 2 !== 0) throw new PathError('length', 'points must hold x, y pairs (even length)');
  if (!closed) return points;
  if (points.length === 0) return new Float32Array(0);
  const out = new Float32Array(points.length + 2);
  out.set(points);
  out[points.length] = points[0];
  out[points.length + 1] = points[1];
  return out;
}

/** The card 1.6 path table of the closed (or open) outline. */
export function borderIndexTable(
  points: Float32Array,
  closed: boolean,
  width: number,
  period: number,
  style: PathStyle,
): PathIndexTable {
  return pathIndexTable(closeOutline(points, closed), width, period, style);
}

/** The card 1.6 CPU layer reference of the closed (or open) outline. */
export function borderLayerReference(
  points: Float32Array,
  closed: boolean,
  width: number,
  period: number,
  style: PathStyle,
  colour: readonly [number, number, number, number],
): Uint8Array {
  return pathLayerReference(borderIndexTable(points, closed, width, period, style), style, colour);
}
