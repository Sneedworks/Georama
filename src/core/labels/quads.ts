// Card 1.8f, step 5b (GREEN), detail v16 (review PASS at 8852a4f): glyph quads for the label pass. Pure, DOM-free.
// A glyph quad is the box of one sprite (fill or outline) on the path: four corners in map space and four uvs in its atlas page.
import type { AtlasPlacement } from '../symbols/atlas.ts';

export type Point = Readonly<{ x: number; y: number }>;
export type UvPoint = Readonly<{ u: number; v: number }>;
export type GlyphQuad = Readonly<{
  corners: readonly [Point, Point, Point, Point];
  uvs: readonly [UvPoint, UvPoint, UvPoint, UvPoint];
}>;

// The glyph's placement on the map: the point and the tangent angle in radians (curved-label.ts and layout.ts).
export type QuadPlacement = Readonly<{ x: number; y: number; angle: number }>;
export type QuadBox = Readonly<{ width: number; height: number }>;

// Corners follow the box in order (0,0), (w,0), (w,h), (0,h), in box coordinates with y down.
// Each corner maps to the placement point plus R(angle) applied to (corner minus origin). The uv of each corner is the
// matching corner of the atlas cell in page units. The texture is not rotated, so the uvs do not depend on the angle.
export function glyphQuad(
  placement: QuadPlacement,
  box: QuadBox,
  origin: Point,
  atlas: AtlasPlacement,
  pageSize: number,
): GlyphQuad {
  const c = Math.cos(placement.angle);
  const s = Math.sin(placement.angle);
  const toMap = (px: number, py: number): Point => {
    const dx = px - origin.x;
    const dy = py - origin.y;
    return { x: placement.x + c * dx - s * dy, y: placement.y + s * dx + c * dy };
  };
  const toUv = (i: 0 | 1, j: 0 | 1): UvPoint => ({
    u: (atlas.x + i * atlas.width) / pageSize,
    v: (atlas.y + j * atlas.height) / pageSize,
  });
  return {
    corners: [toMap(0, 0), toMap(box.width, 0), toMap(box.width, box.height), toMap(0, box.height)],
    uvs: [toUv(0, 0), toUv(1, 0), toUv(1, 1), toUv(0, 1)],
  };
}

// --- Sprite box and origin (detail v16, step 5b item 2). Formerly src/core/labels/sprite.ts; moved here because that file is not on the card's Files list. ---
export type SpriteBox = Readonly<{ width: number; height: number }>;
export type SpriteOrigin = Readonly<{ x: number; y: number }>;
export type SpriteLayout = Readonly<{ box: SpriteBox; origin: SpriteOrigin }>;

// Fill sprite: width is the advance rounded up; the ascent and descent are each rounded up, so every glyph of a
// label shares one baseline row. The origin is the centre of the unrounded advance on the baseline.
export function fillSpriteLayout(advance: number, fontAscent: number, fontDescent: number): SpriteLayout {
  const ascent = Math.ceil(fontAscent);
  const descent = Math.ceil(fontDescent);
  return {
    box: { width: Math.ceil(advance), height: ascent + descent },
    origin: { x: advance / 2, y: ascent },
  };
}

// D-B assumption: the outline pad is ceil(outlineSize x scale) on each side.
export function outlinePad(outlineSize: number, scale: number): number {
  return Math.ceil(outlineSize * scale);
}

// The outline sprite is the fill box grown by pad on each side; its origin moves by the same pad.
export function outlineSpriteLayout(fill: SpriteLayout, pad: number): SpriteLayout {
  return {
    box: { width: fill.box.width + 2 * pad, height: fill.box.height + 2 * pad },
    origin: { x: fill.origin.x + pad, y: fill.origin.y + pad },
  };
}
