// Card 1.8f, step 2 (RED): the arc polyline (D2). Written before src/core/labels/curve.ts exists.
// Sagitta |curve| x chord / 2; the sign of curve sets the side; 65 vertices (k = 0 to 64), so vertex 32 is the arc midpoint.
import { describe, expect, it } from 'vitest';
import { curveToPolyline } from '../../src/core/labels/curve.ts';
import { chordOf } from '../../src/core/labels/layout.ts';

const labelAt = (rotation: number) => ({
  position: { x: 0, y: 0 },
  rotation,
  size: 1,
  curve: 0,
  extraSpacingChar: 0,
});

// Horizontal chord from (-40, 0) to (40, 0): length 80.
const chord = chordOf(labelAt(0), [40, 40], 0);
const sagitta = (curve: number) => (Math.abs(curve) * 80) / 2;
const radius = (s: number) => (40 * 40 + s * s) / (2 * s);

describe('curveToPolyline (D2)', () => {
  it('curve 0 is the two-point straight chord, each end outward by the D6 guard', () => {
    const p = curveToPolyline(chord, 0);
    const g = 0.5e-9 * 80; // D6: 0.5e-9 x text length per end (text length 80)
    expect(p).toHaveLength(2);
    expect(p[0].x).toBeLessThan(-40);
    expect(Math.abs(p[0].x - (-40 - g))).toBeLessThanOrEqual(1e-12);
    expect(p[1].x).toBeGreaterThan(40);
    expect(Math.abs(p[1].x - (40 + g))).toBeLessThanOrEqual(1e-12);
    expect(p[0].y).toBeCloseTo(0, 9);
    expect(p[1].y).toBeCloseTo(0, 9);
  });

  it('has 65 vertices by default', () => {
    expect(curveToPolyline(chord, 0.3)).toHaveLength(65);
  });

  it('the chord ends are the first and last vertices', () => {
    const p = curveToPolyline(chord, 0.3);
    expect(p[0].x).toBeCloseTo(-40, 9);
    expect(p[0].y).toBeCloseTo(0, 9);
    expect(p[64].x).toBeCloseTo(40, 9);
    expect(p[64].y).toBeCloseTo(0, 9);
  });

  it('vertex 32 sits at the sagitta |curve| x L / 2 from the chord midpoint (1e-9)', () => {
    const p = curveToPolyline(chord, 0.3);
    expect(p[32].x).toBeCloseTo(0, 9);
    expect(p[32].y).toBeCloseTo(sagitta(0.3), 9); // 12
  });

  it('the sign of curve sets the side', () => {
    const plus = curveToPolyline(chord, 0.3)[32];
    const minus = curveToPolyline(chord, -0.3)[32];
    expect(minus.x).toBeCloseTo(plus.x, 9);
    expect(minus.y).toBeCloseTo(-plus.y, 9);
  });

  it('the side follows the chord direction (chord along +y: offset along -x)', () => {
    const vertical = chordOf(labelAt(90), [40, 40], 0);
    const p = curveToPolyline(vertical, 0.3);
    expect(p[32].x).toBeCloseTo(-sagitta(0.3), 9);
    expect(p[32].y).toBeCloseTo(0, 9);
  });

  it('all vertices lie on one circle within 1e-9', () => {
    const s = sagitta(0.3);
    const cy = s - radius(s);
    for (const v of curveToPolyline(chord, 0.3)) {
      expect(Math.hypot(v.x, v.y - cy)).toBeCloseTo(radius(s), 9);
    }
  });

  it('the 65 vertices are equally spaced in angle around that circle', () => {
    const s = sagitta(0.3);
    const cy = s - radius(s);
    const angles = curveToPolyline(chord, 0.3).map((v) => Math.atan2(v.y - cy, v.x));
    const step = angles[1] - angles[0];
    for (let k = 1; k < angles.length; k++) {
      expect(angles[k] - angles[k - 1]).toBeCloseTo(step, 9);
    }
  });
});
