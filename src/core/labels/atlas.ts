// Card 1.8f, step 4 (GREEN): pure label-atlas helpers, detail v12. DOM-free: tsconfig.node.json has no DOM library.
import type { AtlasItem } from '../symbols/atlas.ts';
import { pixelFontSize } from './layout.ts';

export type GlyphPart = 'fill' | 'outline';

export type GlyphSpec = Readonly<{
  familyKey: string;
  px: number;
  outlineSize: number;
  outlineColour: string;
}>;

export type GlyphSize = Readonly<{ width: number; height: number }>;

// Integer pixel size used for advances, keys and sprites: max(1, round(size x scale)), composed from pixelFontSize.
export function roundedPixelSize(size: number, scale: number): number {
  return Math.max(1, Math.round(pixelFontSize(size, scale)));
}

// Cache key for one glyph sprite. A change of integer px (zoom) gives a new key, so zoom re-rasterises the glyphs (route A).
export function atlasKey(
  familyKey: string,
  px: number,
  outlineSize: number,
  outlineColour: string,
  codePoint: number,
  part: GlyphPart,
): string {
  return JSON.stringify([familyKey, px, outlineSize, outlineColour, codePoint, part]);
}

// Registered FontFace name for a family at an integer px (the D1 harness names the font file).
export function fontString(px: number, familyKey: string): string {
  return `${px}px label-${familyKey}`;
}

// One AtlasItem per distinct code point and part. Code points come from for...of, so a surrogate pair is one code point.
// The outline part is produced only when outlineSize > 0. Keys are unique (distinct code point and part); order is not specified.
export function glyphItems(
  text: string,
  spec: GlyphSpec,
  measure: (codePoint: number, part: GlyphPart) => GlyphSize,
): AtlasItem[] {
  const parts: readonly GlyphPart[] = spec.outlineSize > 0 ? ['fill', 'outline'] : ['fill'];
  const seen = new Set<number>();
  const items: AtlasItem[] = [];
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0;
    if (seen.has(codePoint)) continue;
    seen.add(codePoint);
    for (const part of parts) {
      const size = measure(codePoint, part);
      items.push({
        key: atlasKey(spec.familyKey, spec.px, spec.outlineSize, spec.outlineColour, codePoint, part),
        width: size.width,
        height: size.height,
      });
    }
  }
  return items;
}
