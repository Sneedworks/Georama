// Strength round for src/core/assets/asset-json.ts, written from the card (T0.6b, rules J1 to J3) and from a table of 97
// operator mutants of the module (90 were killed by the implementer's tests). The survivors were: input that is not bytes
// or not a string, the radius edge (0 and fractions below 1 are valid), and the 1000 / 1001 edge of the name lists. The
// reviewer's own finding is pinned too: unknownKeys must be sorted, and its only test used two keys whose sorted and reversed
// order agree.
import { describe, expect, it } from 'vitest';
import {
  ASSET_JSON_LIMITS,
  AssetJsonError,
  decodeAssetText,
  parseColorString,
  parseSymbolSet,
  parseThemeFile,
  symbolEntryFor,
} from '../../src/core/assets/asset-json.ts';

type Outcome = 'ok' | { code: string; path: string };
function outcome(fn: () => unknown): Outcome {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (!(error instanceof AssetJsonError)) throw error;
    return { code: error.code, path: error.path };
  }
}
const err = (code: string, path: string): Outcome => ({ code, path });

const COLOR = '0.1,0.2,0.3,1';
function themeObject(): Record<string, unknown> {
  return {
    water_texture: 'water_a',
    ground_texture: 'ground_a',
    water_hue: 0.5,
    water_saturation: 0.25,
    water_value: 1,
    vignette_strength: 0.1,
    coastal_fx_distance: 10,
    coastline_style: 1,
    coastline_color: COLOR,
    landmass_outline_color: COLOR,
    landmass_outline_blend: 0.5,
    freshwater_color: COLOR,
    freshwater_outline_color: COLOR,
    ground_colors: [COLOR],
    path_color: COLOR,
    windrose_color: COLOR,
    symbol_custom_colors: [COLOR],
    label_presets: { Town: { font_name: 'Serif', font_size: 12, font_color: COLOR, font_outline_width: 1, font_outline_color: COLOR } },
  };
}
const themeText = (patch: Record<string, unknown> = {}): string => JSON.stringify({ ...themeObject(), ...patch });
const folderText = (radius: string): string => `{"name":"n","radius":${radius},"offset_x":0,"offset_y":0,"draw_mode":"normal"}`;

describe('the entry points take only bytes (decodeAssetText) and strings (the parsers)', () => {
  const notBytes: unknown[] = [null, undefined, '{}', [123, 125], new ArrayBuffer(2), new DataView(new ArrayBuffer(2)), { length: 2 }, 5, true, new Uint16Array(2)];
  const notText: unknown[] = [null, undefined, 42, {}, [], new Uint8Array(2), true, Symbol.iterator];

  it.each(notBytes.map((value, i) => [i, value] as const))('decodeAssetText refuses input #%i with TYPE at /', (_i, value) => {
    expect(outcome(() => decodeAssetText(value as Uint8Array))).toEqual(err('TYPE', '/'));
  });
  it('a Buffer is a Uint8Array and decodes', () => {
    expect(decodeAssetText(Buffer.from('{"a":1}'))).toBe('{"a":1}');
    expect(decodeAssetText(new Uint8Array(0))).toBe('');
  });
  it.each(notText.map((value, i) => [i, value] as const))('parseSymbolSet and parseThemeFile refuse input #%i with SYNTAX at /', (_i, value) => {
    expect(outcome(() => parseSymbolSet(value as string))).toEqual(err('SYNTAX', '/'));
    expect(outcome(() => parseThemeFile(value as string))).toEqual(err('SYNTAX', '/'));
  });
  it('parseColorString refuses input that is not a string with TYPE at /', () => {
    for (const value of notText) expect(outcome(() => parseColorString(value as string))).toEqual(err('TYPE', '/'));
  });
  it('a colour element that is not a string is TYPE at its own path; a required colour of the wrong kind is TYPE at the key', () => {
    expect(outcome(() => parseThemeFile(themeText({ ground_colors: [COLOR, COLOR, 5] })))).toEqual(err('TYPE', '/ground_colors/2'));
    expect(outcome(() => parseThemeFile(themeText({ symbol_custom_colors: [null] })))).toEqual(err('TYPE', '/symbol_custom_colors/0'));
    expect(outcome(() => parseThemeFile(themeText({ coastline_color: 5 })))).toEqual(err('TYPE', '/coastline_color'));
    expect(outcome(() => parseThemeFile(themeText({ coastline_color: '1,2,3' })))).toEqual(err('TYPE', '/coastline_color'));
  });
});

describe('symbol radius edge', () => {
  it('0, fractions below 1, -0 and large values are valid', () => {
    for (const radius of ['0', '0.5', '0.0001', '-0', '1', '1e3', '123456.789']) {
      expect({ radius, result: outcome(() => parseSymbolSet(folderText(radius))) }).toEqual({ radius, result: 'ok' });
    }
    const file = parseSymbolSet(folderText('0.5'));
    expect(file.shape).toBe('folder');
    expect(symbolEntryFor(file, 'anything')?.radius).toBe(0.5);
  });
  it('anything below zero is TYPE at the radius, however small', () => {
    for (const radius of ['-0.0001', '-1', '-1e-300', '-123456']) {
      expect({ radius, result: outcome(() => parseSymbolSet(folderText(radius))) }).toEqual({ radius, result: err('TYPE', '/radius') });
    }
  });
  it('the same edge holds in the images shape and names the entry in the path', () => {
    const images = (radius: string): string => `{"a":{"name":"a","radius":${radius},"offset_x":0,"offset_y":0,"draw_mode":"normal"}}`;
    expect(outcome(() => parseSymbolSet(images('0')))).toBe('ok');
    expect(outcome(() => parseSymbolSet(images('0.25')))).toBe('ok');
    expect(outcome(() => parseSymbolSet(images('-0.25')))).toEqual(err('TYPE', '/a/radius'));
  });
  it('a negative offset is fine, a non-finite or missing number is not', () => {
    const text = (extra: string): string => `{"name":"n","radius":1,${extra}"draw_mode":"d"}`;
    expect(parseSymbolSet(text('"offset_x":-5,"offset_y":-0.5,'))).toMatchObject({ shape: 'folder', entry: { offsetX: -5, offsetY: -0.5 } });
    expect(outcome(() => parseSymbolSet(text('"offset_x":1e999,"offset_y":0,')))).toEqual(err('TYPE', '/offset_x'));
    expect(outcome(() => parseSymbolSet(text('"offset_y":0,')))).toEqual(err('SHAPE', '/offset_x'));
  });
});

describe('theme lists: the limits sit exactly at 1000 and the paths name the list', () => {
  const colors = (n: number): string[] => Array.from({ length: n }, () => COLOR);
  const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `n${i}`);

  it('colour lists: 1000 pass, 1001 are LIMIT at the list', () => {
    expect(ASSET_JSON_LIMITS.maxColors).toBe(1000);
    for (const key of ['ground_colors', 'symbol_custom_colors', 'water_colors']) {
      expect({ key, ok: outcome(() => parseThemeFile(themeText({ [key]: colors(1000) }))) }).toEqual({ key, ok: 'ok' });
      expect({ key, over: outcome(() => parseThemeFile(themeText({ [key]: colors(1001) }))) }).toEqual({ key, over: err('LIMIT', `/${key}`) });
    }
  });
  it('name lists: 1000 pass, 1001 are LIMIT at the list', () => {
    for (const key of ['water_color_names', 'ground_color_names']) {
      expect({ key, ok: outcome(() => parseThemeFile(themeText({ [key]: names(1000) }))) }).toEqual({ key, ok: 'ok' });
      expect({ key, over: outcome(() => parseThemeFile(themeText({ [key]: names(1001) }))) }).toEqual({ key, over: err('LIMIT', `/${key}`) });
    }
    const t = parseThemeFile(themeText({ water_color_names: names(3), ground_color_names: [] }));
    expect(t.waterColorNames).toEqual(['n0', 'n1', 'n2']);
    expect(t.groundColorNames).toEqual([]);
  });
  it('a name list of the wrong kind or with a non-string item is TYPE at the list or at the item', () => {
    expect(outcome(() => parseThemeFile(themeText({ water_color_names: 'abc' })))).toEqual(err('TYPE', '/water_color_names'));
    expect(outcome(() => parseThemeFile(themeText({ ground_color_names: { 0: 'a' } })))).toEqual(err('TYPE', '/ground_color_names'));
    expect(outcome(() => parseThemeFile(themeText({ water_color_names: ['a', 'b', 7] })))).toEqual(err('TYPE', '/water_color_names/2'));
    expect(outcome(() => parseThemeFile(themeText({ ground_color_names: [null] })))).toEqual(err('TYPE', '/ground_color_names/0'));
  });
  it('label presets: 1000 pass, 1001 are LIMIT', () => {
    const presets = (n: number): Record<string, unknown> =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { font_name: 'F', font_size: 1, font_color: COLOR, font_outline_width: 0, font_outline_color: COLOR }]));
    expect(ASSET_JSON_LIMITS.maxPresets).toBe(1000);
    expect(parseThemeFile(themeText({ label_presets: presets(1000) })).labelPresets.size).toBe(1000);
    expect(outcome(() => parseThemeFile(themeText({ label_presets: presets(1001) })))).toEqual(err('LIMIT', '/label_presets'));
  });
  it('the optional lists are null when absent and keep their order when present', () => {
    const t = parseThemeFile(themeText());
    expect([t.waterColors, t.waterColorNames, t.groundColorNames]).toEqual([null, null, null]);
    const u = parseThemeFile(themeText({ water_colors: ['1,2,3,4', '5,6,7,8'] }));
    expect(u.waterColors).toEqual([{ r: 1, g: 2, b: 3, a: 4 }, { r: 5, g: 6, b: 7, a: 8 }]);
  });
});

describe('unknownKeys', () => {
  it('lists the keys outside the known set in UTF-16 code unit order, whatever order they come in', () => {
    // Insertion order matches neither the sorted nor the reversed order.
    const extra = { m: 1, Z: 2, a: 3, é: 4, B: 5, _x: 6, zz: 7, Water_Texture: 8 };
    const t = parseThemeFile(themeText(extra));
    expect(t.unknownKeys).toEqual(['B', 'Water_Texture', 'Z', '_x', 'a', 'm', 'zz', 'é']);
  });
  it('a theme with only known keys has none; known keys differing in case are unknown', () => {
    expect(parseThemeFile(themeText()).unknownKeys).toEqual([]);
    expect(parseThemeFile(themeText({ Path_Color: COLOR })).unknownKeys).toEqual(['Path_Color']);
  });
});
