// Card 1.8f, step 2 (RED): placement, the D4 fallback and the empty and invalid modes (detail v9). Written before src/core/labels/layout.ts exists.
// LIMIT and FIT are D4 (drawn straight and reported). Empty text and other INPUT draw nothing (v9).
// With the chord equal to the text length, FIT is not reachable through labelLayout except by rounding, so applyD4 is tested directly.
import { describe, expect, it } from 'vitest';
import { applyD4, chordOf, labelLayout, straightPlacements } from '../../src/core/labels/layout.ts';

const curved = { position: { x: 0, y: 0 }, rotation: 0, size: 12, curve: 0.3, extraSpacingChar: 0 };
const straight = { ...curved, curve: 0 };

describe('labelLayout: placement on the arc (D2, D5)', () => {
  it('a text that fits lays out on the arc with one placement per advance', () => {
    const r = labelLayout(curved, [10, 10, 10], { scale: 1 });
    expect(r.mode).toBe('curved');
    expect(r.placements).toHaveLength(3);
  });

  it('the letter spacing is extra_spacing_char x scale and the chord includes it (D5)', () => {
    const r = labelLayout({ ...curved, extraSpacingChar: 5 }, [10, 10, 10], { scale: 2 });
    expect(r.spacingPx).toBe(10);
    expect(r.chordLength).toBe(30 + 10 * 2);
  });

  it('a curve of 0 places the glyph centres on the straight chord', () => {
    const r = labelLayout(straight, [10, 10, 10], { scale: 1 });
    expect(r.mode).toBe('curved');
    for (const p of r.placements) expect(p.y).toBeCloseTo(0, 9);
    expect(r.placements[0].x).toBeLessThan(r.placements[2].x);
  });
});

describe('labelLayout: LIMIT is D4 (drawn straight and reported)', () => {
  it('more glyphs than maxGlyphs (4096 by default) gives mode fallback with reason LIMIT', () => {
    const r = labelLayout(curved, new Array(4097).fill(1), { scale: 1 });
    expect(r.mode).toBe('fallback');
    expect(r.reason).toBe('LIMIT');
    expect(r.placements).toHaveLength(4097);
  });
});

describe('labelLayout: empty and invalid text draw nothing (detail v9)', () => {
  it('no glyphs gives mode empty with no placements', () => {
    const r = labelLayout(curved, [], { scale: 1 });
    expect(r.mode).toBe('empty');
    expect(r.placements).toHaveLength(0);
  });

  it('an advance of 0 is INPUT and gives mode invalid with no placements', () => {
    const r = labelLayout(curved, [0, 5], { scale: 1 });
    expect(r.mode).toBe('invalid');
    expect(r.placements).toHaveLength(0);
  });
});

describe('straightPlacements: glyph centres on the chord (same semantics as fact 2)', () => {
  it('centre i at cursor + advance/2, with the spacing between glyphs only', () => {
    const c = chordOf(straight, [10, 10, 10], 2); // length 34, from -17 to 17
    const p = straightPlacements(c, [10, 10, 10], 2);
    expect(p).toHaveLength(3);
    expect(p[0].distance).toBeCloseTo(5, 9);
    expect(p[1].distance).toBeCloseTo(17, 9);
    expect(p[2].distance).toBeCloseTo(29, 9);
  });

  it('the first centre lies on the chord at the chord angle', () => {
    const c = chordOf(straight, [10, 10, 10], 2);
    const p = straightPlacements(c, [10, 10, 10], 2);
    expect(p[0].x).toBeCloseTo(-12, 9);
    expect(p[0].y).toBeCloseTo(0, 9);
    expect(p[0].angle).toBeCloseTo(0, 9);
  });
});

describe('applyD4: LIMIT or FIT is drawn straight and reported', () => {
  it('a successful layout is curved', () => {
    expect(applyD4({ ok: true, pathLength: 10, placements: [] })).toEqual({ mode: 'curved' });
  });

  it('FIT falls back to straight with reason FIT', () => {
    expect(applyD4({ ok: false, code: 'FIT' })).toEqual({ mode: 'fallback', reason: 'FIT' });
  });

  it('LIMIT falls back to straight with reason LIMIT', () => {
    expect(applyD4({ ok: false, code: 'LIMIT' })).toEqual({ mode: 'fallback', reason: 'LIMIT' });
  });
});
