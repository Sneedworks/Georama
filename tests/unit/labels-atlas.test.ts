// Card 1.8f, step 4 (RED, revised to detail v12): the label cache key, the rounding, the font string and the glyph items.
// The pure helpers live in src/core/labels/atlas.ts (DOM-free). packAtlas (src/core/symbols/atlas.ts) is reused unchanged and not re-tested here.
import { describe, expect, it } from 'vitest';
import { pixelFontSize } from '../../src/core/labels/layout.ts';
import { atlasKey, fontString, glyphItems, roundedPixelSize } from '../../src/core/labels/atlas.ts';
import { packAtlas } from '../../src/core/symbols/atlas.ts';

const spec = { familyKey: 'marko-one', px: 12, outlineSize: 1, outlineColour: '#000000' };
const small = () => ({ width: 10, height: 12 });

describe('roundedPixelSize = max(1, round(pixelFontSize(size, scale))) (detail v12)', () => {
  it('composes pixelFontSize: size 12 at scale 1.04 is 12 px (12.48)', () => {
    expect(roundedPixelSize(12, 1.04)).toBe(12);
    expect(roundedPixelSize(12, 1.04)).toBe(Math.max(1, Math.round(pixelFontSize(12, 1.04))));
  });

  it('size 12 at scale 1.1 is 13 px (13.2)', () => {
    expect(roundedPixelSize(12, 1.1)).toBe(13);
  });

  it('a size below 1 px draws at 1 px', () => {
    expect(roundedPixelSize(4, 0.05)).toBe(1);
  });
});

describe('atlasKey: the cache key (detail v12)', () => {
  it('the same inputs give the same key', () => {
    expect(atlasKey('marko-one', 12, 1, '#000000', 0x41, 'fill')).toBe(atlasKey('marko-one', 12, 1, '#000000', 0x41, 'fill'));
  });

  it('a change of integer px (zoom) gives a new key', () => {
    expect(atlasKey('marko-one', 12, 1, '#000000', 0x41, 'fill')).not.toBe(atlasKey('marko-one', 13, 1, '#000000', 0x41, 'fill'));
  });

  it('the family, outline size, outline colour, code point and part are all in the key', () => {
    const base = atlasKey('marko-one', 12, 1, '#000000', 0x41, 'fill');
    expect(atlasKey('aladin', 12, 1, '#000000', 0x41, 'fill')).not.toBe(base);
    expect(atlasKey('marko-one', 12, 2, '#000000', 0x41, 'fill')).not.toBe(base);
    expect(atlasKey('marko-one', 12, 1, '#ffffff', 0x41, 'fill')).not.toBe(base);
    expect(atlasKey('marko-one', 12, 1, '#000000', 0x42, 'fill')).not.toBe(base);
    expect(atlasKey('marko-one', 12, 1, '#000000', 0x41, 'outline')).not.toBe(base);
  });
});

describe('fontString: each family is registered as label-<familyKey> (detail v12)', () => {
  it('fontString(12, marko-one) is "12px label-marko-one"', () => {
    expect(fontString(12, 'marko-one')).toBe('12px label-marko-one');
  });
});

describe('glyphItems(text, spec, measure) (detail v12)', () => {
  it('one item per distinct code point and part: "aab" is 2 code points x 2 parts, 4 items, unique by key', () => {
    const items = glyphItems('aab', spec, small);
    expect(items).toHaveLength(4);
    expect(new Set(items.map((i) => i.key)).size).toBe(4);
  });

  it('a surrogate pair is one code point: fill and outline, 2 items', () => {
    expect(glyphItems('\u{1F600}', spec, small)).toHaveLength(2);
  });

  it('empty text gives an empty list', () => {
    expect(glyphItems('', spec, small)).toEqual([]);
  });

  it('outlineSize 0 gives fill items only', () => {
    const items = glyphItems('ab', { ...spec, outlineSize: 0 }, small);
    const expected = [
      atlasKey('marko-one', 12, 0, '#000000', 0x61, 'fill'),
      atlasKey('marko-one', 12, 0, '#000000', 0x62, 'fill'),
    ];
    expect(items.map((i) => i.key).sort()).toEqual(expected.sort());
  });

  it('sizes come from measure, checked by key and not by list order', () => {
    const items = glyphItems('a', spec, (_cp, part) => ({ width: part === 'fill' ? 10 : 12, height: 14 }));
    const byKey = new Map<string, { width: number; height: number }>(items.map((i) => [i.key, i] as const));
    expect(byKey.get(atlasKey('marko-one', 12, 1, '#000000', 0x61, 'fill'))).toMatchObject({ width: 10, height: 14 });
    expect(byKey.get(atlasKey('marko-one', 12, 1, '#000000', 0x61, 'outline'))).toMatchObject({ width: 12, height: 14 });
  });
});

describe('packAtlas places the glyph items; an item wider than maxSide is oversize (detail v12)', () => {
  it('small glyph items pack with no oversize entries', () => {
    const v = packAtlas(glyphItems('abc', spec, small), { maxSide: 2048, maxPages: 2, padding: 2 });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.oversize).toEqual([]);
  });

  it('an item wider than maxSide is listed in oversize and not placed', () => {
    const items = glyphItems('a', spec, () => ({ width: 2100, height: 10 }));
    const v = packAtlas(items, { maxSide: 2048, maxPages: 2, padding: 2 });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.oversize).toEqual(items.map((i) => i.key).sort());
      expect(v.placements.map((p) => p.key)).not.toContain(items[0].key);
    }
  });
});
