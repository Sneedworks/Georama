// Card 1.8f, step 5b (RED), detail v16 (review PASS at 8852a4f): glyph quads for the label pass.
// Pure: the quad maths lives in src/core/labels/quads.ts (DOM-free).
import { describe, expect, it } from 'vitest';
import { fillSpriteLayout, glyphQuad, outlinePad, outlineSpriteLayout } from '../../src/core/labels/quads.ts';
import type { AtlasPlacement } from '../../src/core/symbols/atlas.ts';

const cell: AtlasPlacement = { key: 'k', page: 0, x: 32, y: 64, width: 10, height: 20 };

function expectPoint(p: { x: number; y: number }, x: number, y: number): void {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
}

describe('glyphQuad: corners (detail v16, step 5b item 1)', () => {
  it('zero rotation: the box offset by the placement point less the origin, in corner order', () => {
    const q = glyphQuad({ x: 100, y: 50, angle: 0 }, { width: 10, height: 20 }, { x: 5, y: 10 }, cell, 256);
    expectPoint(q.corners[0], 95, 40);
    expectPoint(q.corners[1], 105, 40);
    expectPoint(q.corners[2], 105, 60);
    expectPoint(q.corners[3], 95, 60);
  });

  it('quarter turn: the corners rotate about the placement point (y down)', () => {
    const q = glyphQuad({ x: 100, y: 50, angle: Math.PI / 2 }, { width: 10, height: 20 }, { x: 5, y: 10 }, cell, 256);
    expectPoint(q.corners[0], 110, 45);
    expectPoint(q.corners[1], 110, 55);
    expectPoint(q.corners[2], 90, 55);
    expectPoint(q.corners[3], 90, 45);
  });

  it('centred origin: opposite corners average to the placement point at any angle', () => {
    const q = glyphQuad({ x: 100, y: 50, angle: 0.7 }, { width: 10, height: 20 }, { x: 5, y: 10 }, cell, 256);
    expectPoint({ x: (q.corners[0].x + q.corners[2].x) / 2, y: (q.corners[0].y + q.corners[2].y) / 2 }, 100, 50);
    expectPoint({ x: (q.corners[1].x + q.corners[3].x) / 2, y: (q.corners[1].y + q.corners[3].y) / 2 }, 100, 50);
  });
});

describe('glyphQuad: uvs (detail v16, step 5b item 1)', () => {
  it('uvs are the atlas cell in page units, in corner order', () => {
    const q = glyphQuad({ x: 0, y: 0, angle: 0 }, { width: 10, height: 20 }, { x: 5, y: 10 }, cell, 256);
    expect(q.uvs).toEqual([
      { u: 32 / 256, v: 64 / 256 },
      { u: 42 / 256, v: 64 / 256 },
      { u: 42 / 256, v: 84 / 256 },
      { u: 32 / 256, v: 84 / 256 },
    ]);
  });

  it('rotation does not change the uvs: the quad turns, the texture does not', () => {
    const flat = glyphQuad({ x: 0, y: 0, angle: 0 }, { width: 10, height: 20 }, { x: 5, y: 10 }, cell, 256);
    const turned = glyphQuad({ x: 100, y: 50, angle: Math.PI / 2 }, { width: 10, height: 20 }, { x: 5, y: 10 }, cell, 256);
    expect(turned.uvs).toEqual(flat.uvs);
  });
});

describe('glyphQuad: fill and outline share the placement point (detail v16, step 5b item 2)', () => {
  it('the outline quad is the fill quad grown by the pad on each side', () => {
    const at = { x: 50, y: 50, angle: 0 };
    const fill = glyphQuad(at, { width: 8, height: 12 }, { x: 4, y: 9 }, cell, 256);
    const outline = glyphQuad(at, { width: 12, height: 16 }, { x: 6, y: 11 }, cell, 256);
    const pad = 2;
    expectPoint(outline.corners[0], fill.corners[0].x - pad, fill.corners[0].y - pad);
    expectPoint(outline.corners[2], fill.corners[2].x + pad, fill.corners[2].y + pad);
  });
});

// --- Sprite box and origin (detail v16, step 5b item 2). Formerly tests/unit/labels-sprite.test.ts. ---
describe('fillSpriteLayout (detail v16, step 5b item 2)', () => {
  it('rounds the advance up for the box width and keeps the unrounded advance for the origin', () => {
    const f = fillSpriteLayout(10.2, 12.1, 3.2);
    expect(f.box.width).toBe(11);
    expect(f.origin.x).toBeCloseTo(5.1, 9);
  });

  it('rounds ascent and descent up separately, so the height is the sum of the two rounded values', () => {
    const f = fillSpriteLayout(10, 12.4, 3.6);
    expect(f.box.height).toBe(13 + 4);
    expect(f.origin.y).toBe(13);
  });

  it('whole metrics are unchanged', () => {
    expect(fillSpriteLayout(10, 12, 3)).toEqual({ box: { width: 10, height: 15 }, origin: { x: 5, y: 12 } });
  });

  it('fractional metrics below one pixel still give whole rows', () => {
    const f = fillSpriteLayout(0.5, 0.1, 0.1);
    expect(f.box.width).toBe(1);
    expect(f.box.height).toBe(2);
    expect(f.origin.y).toBe(1);
  });
});

describe('outlinePad (detail v16, step 5b item 2; D-B assumption)', () => {
  it('is ceil(outlineSize x scale)', () => {
    expect(outlinePad(1, 1)).toBe(1);
    expect(outlinePad(1.5, 1.1)).toBe(2);
    expect(outlinePad(0.4, 1)).toBe(1);
  });

  it('is zero for a zero outline size', () => {
    expect(outlinePad(0, 2)).toBe(0);
  });
});

describe('outlineSpriteLayout (detail v16, step 5b item 2)', () => {
  it('grows the box by pad on each side and moves the origin by pad on both axes', () => {
    const fill = fillSpriteLayout(10.2, 12.1, 3.2);
    const out = outlineSpriteLayout(fill, 2);
    expect(out.box.width).toBe(fill.box.width + 4);
    expect(out.box.height).toBe(fill.box.height + 4);
    expect(out.origin.x).toBeCloseTo(fill.origin.x + 2, 9);
    expect(out.origin.y).toBe(fill.origin.y + 2);
  });

  it('gives the fill layout back when pad is zero', () => {
    const fill = fillSpriteLayout(10.2, 12.1, 3.2);
    expect(outlineSpriteLayout(fill, 0)).toEqual(fill);
  });

  it('gives the values for the worked example (advance 10.2, ascent 12.1, descent 3.2, pad 2)', () => {
    const out = outlineSpriteLayout(fillSpriteLayout(10.2, 12.1, 3.2), 2);
    expect(out.box).toEqual({ width: 15, height: 21 });
    expect(out.origin.x).toBeCloseTo(7.1, 9);
    expect(out.origin.y).toBe(15);
  });
});
