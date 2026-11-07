// Card 1.8f, step 2 (RED): chord, pixel size, spacing and the rounding check. Written before src/core/labels/layout.ts exists.
// The chord length is the text length (fact 15, D2, D5). Degrees are converted to radians (fact 8). Pixel space has y down (fact 7).
import { describe, expect, it } from 'vitest';
import { layoutCurvedLabel } from '../../src/core/geometry/curved-label.ts';
import { curveToPolyline } from '../../src/core/labels/curve.ts';
import { chordOf, pixelFontSize, spacingPixels } from '../../src/core/labels/layout.ts';

const labelAt = (rotation: number, extraSpacingChar = 0) => ({
  position: { x: 100, y: 50 },
  rotation,
  size: 12,
  curve: 0,
  extraSpacingChar,
});

describe('chordOf: direction, centre and radians (fact 8)', () => {
  it('rotation 0 runs along +x and is centred on position', () => {
    const c = chordOf(labelAt(0), [10, 10, 10], 0);
    expect(c.start.x).toBeCloseTo(85, 9);
    expect(c.end.x).toBeCloseTo(115, 9);
    expect(c.start.y).toBeCloseTo(50, 9);
    expect(c.end.y).toBeCloseTo(50, 9);
  });

  it('rotation 90 runs along +y in pixel space (y down)', () => {
    const c = chordOf(labelAt(90), [10, 10, 10], 0);
    expect(c.end.y - c.start.y).toBeCloseTo(30, 9);
    expect(Math.abs(c.end.x - c.start.x)).toBeLessThan(1e-9);
  });

  it('rotation -90 runs along -y', () => {
    const c = chordOf(labelAt(-90), [10, 10, 10], 0);
    expect(c.end.y - c.start.y).toBeCloseTo(-30, 9);
    expect(Math.abs(c.end.x - c.start.x)).toBeLessThan(1e-9);
  });

  it('rotation 180 runs along -x', () => {
    const c = chordOf(labelAt(180), [10, 10, 10], 0);
    expect(c.end.x - c.start.x).toBeCloseTo(-30, 9);
    expect(Math.abs(c.end.y - c.start.y)).toBeLessThan(1e-9);
  });

  it('rotation 45 gives equal x and y components (degrees, not radians)', () => {
    const c = chordOf(labelAt(45), [10, 10, 10], 0);
    expect(c.end.x - c.start.x).toBeCloseTo(30 / Math.SQRT2, 9);
    expect(c.end.y - c.start.y).toBeCloseTo(30 / Math.SQRT2, 9);
  });

  it('the chord midpoint is position (anchor 0.5 is an assumption, fact 9)', () => {
    const c = chordOf(labelAt(37), [4, 9, 2], 1.5);
    expect((c.start.x + c.end.x) / 2).toBeCloseTo(100, 9);
    expect((c.start.y + c.end.y) / 2).toBeCloseTo(50, 9);
  });
});

describe('chordOf: length is the text length (D5, fact 15)', () => {
  it('length = sum of advances + spacingPx between glyphs (n-1 gaps)', () => {
    expect(chordOf(labelAt(0), [10, 10, 10], 2).length).toBe(34);
  });

  it('a single glyph has no spacing gap', () => {
    expect(chordOf(labelAt(0), [7], 5).length).toBe(7);
  });

  it('the length uses the same order of additions as the layout (fact 15, lines 41 to 46)', () => {
    const advances = [0.1, 0.2, 0.3, 0.7];
    const spacing = 0.1;
    let textLength = 0;
    for (let i = 0; i < advances.length; i++) {
      textLength += advances[i];
      if (i > 0) textLength += spacing;
    }
    expect(chordOf(labelAt(0), advances, spacing).length).toBe(textLength);
  });
});

describe('pixel size and letter spacing (D5, fact 6)', () => {
  it('pixel font size is size x scale', () => {
    expect(pixelFontSize(12, 2)).toBe(24);
    expect(pixelFontSize(12, 0.5)).toBe(6);
  });

  it('pixel letter spacing is extra_spacing_char x scale', () => {
    expect(spacingPixels(5, 2)).toBe(10);
    expect(spacingPixels(0, 3)).toBe(0);
  });
});

describe('rounding check: a text equal to its chord lays out ok (detail v9, Design)', () => {
  for (const rotation of [0, 45, 90, 180, -90]) {
    it(`rotation ${rotation}, no spacing`, () => {
      const advances = [3.7, 4.9, 2.2];
      const c = chordOf(labelAt(rotation), advances, 0);
      expect(layoutCurvedLabel({ points: curveToPolyline(c, 0), advances }).ok).toBe(true);
    });

    it(`rotation ${rotation}, spacing 1.3 (D5)`, () => {
      const advances = [3.7, 4.9, 2.2];
      const c = chordOf(labelAt(rotation), advances, 1.3);
      expect(layoutCurvedLabel({ points: curveToPolyline(c, 0), advances, letterSpacing: 1.3 }).ok).toBe(true);
    });
  }
});
