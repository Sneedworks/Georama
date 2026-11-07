// Card 1.8f, step 3 (GREEN): the arc polyline (detail v9, D2). Pure: no DOM, no environment.
// A circular arc with sagitta |curve| x L / 2; the sign of curve sets the side. ARC_VERTICES equally spaced
// vertices in angle, so the arc midpoint is vertex (vertices - 1) / 2 (vertex 32 for 65). Curve 0 is the straight chord.
import type { LabelPoint } from '../geometry/curved-label.ts';

/** The placed chord: length L along the label's rotation (radians), centred on its position (facts 8 and 9, D5). */
export type Chord = Readonly<{ start: LabelPoint; end: LabelPoint; length: number; angle: number }>;

export const ARC_VERTICES = 65;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export function curveToPolyline(chord: Chord, curve: number, vertices: number = ARC_VERTICES): LabelPoint[] {
  if (curve === 0) {
    // D6 rounding guard, straight case only: each end moves outward along the chord by 0.5e-9 x text length,
    // so the straight path is longer than the text and cannot FIT by rounding. Arcs are not guarded.
    const g = 0.5e-9 * chord.length;
    const ux = Math.cos(chord.angle);
    const uy = Math.sin(chord.angle);
    return [
      { x: chord.start.x - g * ux, y: chord.start.y - g * uy },
      { x: chord.end.x + g * ux, y: chord.end.y + g * uy },
    ];
  }
  if (!Number.isInteger(vertices) || vertices < 3 || vertices % 2 === 0) {
    throw new RangeError('curveToPolyline: vertices must be an odd integer of at least 3');
  }
  const L = chord.length;
  const s = (Math.abs(curve) * L) / 2;
  const side = Math.sign(curve);
  const half = L / 2;
  const R = (half * half + s * s) / (2 * s);
  const mid = { x: (chord.start.x + chord.end.x) / 2, y: (chord.start.y + chord.end.y) / 2 };
  const nx = -Math.sin(chord.angle);
  const ny = Math.cos(chord.angle);
  // The centre lies on the opposite side of the chord from the arc midpoint, at distance R - s from the chord midpoint.
  const cx = mid.x - side * (R - s) * nx;
  const cy = mid.y - side * (R - s) * ny;
  const aMid = Math.atan2(side * R * ny, side * R * nx);
  const aEnd = Math.atan2(chord.end.y - cy, chord.end.x - cx);
  const h = (vertices - 1) / 2;
  const step = wrap(aEnd - aMid) / h;
  const out: LabelPoint[] = [];
  for (let k = 0; k < vertices; k++) {
    const a = aMid + (k - h) * step;
    out.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return out;
}
