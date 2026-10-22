import { describe, expect, it } from 'vitest';
import type { AssetJsonErrorCode, SymbolEntry, SymbolSetFile } from '../../src/core/assets/asset-json.ts';
import {
  ASSET_JSON_LIMITS,
  AssetJsonError,
  KNOWN_DRAW_MODES,
  decodeAssetText,
  parseColorString,
  parseSymbolSet,
  parseThemeFile,
  symbolEntryFor,
} from '../../src/core/assets/asset-json.ts';

function errOf(fn: () => unknown): AssetJsonError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(AssetJsonError);
  return caught as AssetJsonError;
}

function expectCodePath(fn: () => unknown, code: AssetJsonErrorCode, path: string): void {
  const e = errOf(fn);
  expect(e.code).toBe(code);
  expect(e.path).toBe(path);
  expect(e.name).toBe('AssetJsonError');
}

/** Small seeded PRNG so the fuzz is deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ASSET_JSON_LIMITS', () => {
  it('is frozen at 1M/20k/1000/1000', () => {
    expect(ASSET_JSON_LIMITS.maxChars).toBe(1048576);
    expect(ASSET_JSON_LIMITS.maxEntries).toBe(20000);
    expect(ASSET_JSON_LIMITS.maxColors).toBe(1000);
    expect(ASSET_JSON_LIMITS.maxPresets).toBe(1000);
    expect(Object.isFrozen(ASSET_JSON_LIMITS)).toBe(true);
  });
  it('documents the known draw modes', () => {
    expect([...KNOWN_DRAW_MODES]).toEqual(['normal', 'sample_color', 'custom_colors', 'custom_colors_2']);
    expect(Object.isFrozen(KNOWN_DRAW_MODES)).toBe(true);
  });
});

describe('decodeAssetText', () => {
  it('decodes valid UTF-8', () => {
    const bytes = new TextEncoder().encode('{"name":"héllo"}');
    expect(decodeAssetText(bytes)).toBe('{"name":"héllo"}');
  });
  it('rejects invalid UTF-8 as ENCODING', () => {
    expectCodePath(() => decodeAssetText(new Uint8Array([0xff, 0xfe, 0x41])), 'ENCODING', '/');
    expectCodePath(() => decodeAssetText(new Uint8Array([0xc3])), 'ENCODING', '/');
  });
  it('keeps a BOM so the parsers fail it as SYNTAX', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
    const text = decodeAssetText(bytes);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expectCodePath(() => parseSymbolSet(text), 'SYNTAX', '/');
    expectCodePath(() => parseThemeFile(text), 'SYNTAX', '/');
  });
  it('rejects oversize input as TOO_LARGE at exactly maxChars+1', () => {
    expectCodePath(() => decodeAssetText(new Uint8Array(ASSET_JSON_LIMITS.maxChars + 1)), 'TOO_LARGE', '/');
    expect(decodeAssetText(new Uint8Array(ASSET_JSON_LIMITS.maxChars)).length).toBe(ASSET_JSON_LIMITS.maxChars);
  });
});

const folderJson = '{"name":"Juniper Test","radius":12,"offset_x":1,"offset_y":-2,"draw_mode":"sample_color"}';
const imagesJson =
  '{"07":{"name":"Hall 07","radius":103,"offset_x":0,"offset_y":0,"draw_mode":"normal"},' +
  '"stall 1":{"name":"Stall 1","radius":57,"offset_x":0,"offset_y":-4,"draw_mode":"custom_colors"}}';

describe('parseSymbolSet folder shape', () => {
  it('parses a valid folder descriptor', () => {
    const file = parseSymbolSet(folderJson);
    expect(file.shape).toBe('folder');
    if (file.shape !== 'folder') throw new Error('unreachable');
    expect(file.entry).toEqual({ name: 'Juniper Test', radius: 12, offsetX: 1, offsetY: -2, drawMode: 'sample_color' });
  });
  it('ignores extra fields', () => {
    const file = parseSymbolSet(
      '{"name":"X","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"normal","zzz_extra":true}',
    );
    expect(file.shape).toBe('folder');
  });
  it('accepts an unknown draw mode without error', () => {
    const file = parseSymbolSet(
      '{"name":"X","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"future_mode"}',
    );
    if (file.shape !== 'folder') throw new Error('unreachable');
    expect(file.entry.drawMode).toBe('future_mode');
  });
  it.each(['name', 'radius', 'offset_x', 'offset_y', 'draw_mode'])('missing %s is SHAPE', (field) => {
    const obj: Record<string, unknown> = JSON.parse(folderJson) as Record<string, unknown>;
    delete obj[field];
    expectCodePath(() => parseSymbolSet(JSON.stringify(obj)), 'SHAPE', `/${field}`);
  });
  it('rejects every wrong-kind field as TYPE', () => {
    const base = JSON.parse(folderJson) as Record<string, unknown>;
    const wrong: Record<string, unknown> = { name: 42, radius: 'x', offset_x: 'x', offset_y: null, draw_mode: 7 };
    for (const [field, value] of Object.entries(wrong)) {
      const obj = { ...base, [field]: value };
      expectCodePath(() => parseSymbolSet(JSON.stringify(obj)), 'TYPE', `/${field}`);
    }
  });
  it('rejects non-finite numbers and a negative radius as TYPE', () => {
    const base = JSON.parse(folderJson) as Record<string, unknown>;
    for (const field of ['radius', 'offset_x', 'offset_y']) {
      expectCodePath(() => parseSymbolSet(JSON.stringify({ ...base, [field]: 1e999 })), 'TYPE', `/${field}`);
    }
    expectCodePath(() => parseSymbolSet(JSON.stringify({ ...base, radius: -1 })), 'TYPE', '/radius');
    expectCodePath(() => parseSymbolSet('{"name":"X","radius":null,"offset_x":0,"offset_y":0,"draw_mode":"n"}'), 'TYPE', '/radius');
  });
});

describe('parseSymbolSet images shape', () => {
  it('parses a valid map of image names', () => {
    const file = parseSymbolSet(imagesJson);
    expect(file.shape).toBe('images');
    if (file.shape !== 'images') throw new Error('unreachable');
    expect(file.entries.size).toBe(2);
    expect(file.entries.get('07')).toEqual({ name: 'Hall 07', radius: 103, offsetX: 0, offsetY: 0, drawMode: 'normal' });
    expect(file.entries.get('stall 1')).toEqual({
      name: 'Stall 1',
      radius: 57,
      offsetX: 0,
      offsetY: -4,
      drawMode: 'custom_colors',
    });
  });
  it('treats proto-pollution keys as ordinary map keys without polluting', () => {
    const before = ({} as Record<string, unknown>).polluted;
    const file = parseSymbolSet(
      '{"__proto__":{"name":"P","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"normal"},' +
        '"constructor":{"name":"C","radius":2,"offset_x":0,"offset_y":0,"draw_mode":"normal"}}',
    );
    expect(file.shape).toBe('images');
    if (file.shape !== 'images') throw new Error('unreachable');
    expect(file.entries.get('__proto__')).toEqual({ name: 'P', radius: 1, offsetX: 0, offsetY: 0, drawMode: 'normal' });
    expect(file.entries.get('constructor')).toEqual({ name: 'C', radius: 2, offsetX: 0, offsetY: 0, drawMode: 'normal' });
    expect(({} as Record<string, unknown>).polluted).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBe(undefined);
    expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);
  });
  it('rejects an empty root as SHAPE', () => {
    expectCodePath(() => parseSymbolSet('{}'), 'SHAPE', '/');
  });
  it('rejects every wrong-kind and every missing entry field with indexed paths', () => {
    const good: Record<string, unknown> = {
      name: 'X',
      radius: 1,
      offset_x: 0,
      offset_y: 0,
      draw_mode: 'normal',
    };
    const wrong: Record<string, unknown> = { name: 42, radius: 'x', offset_x: 'x', offset_y: null, draw_mode: 7 };
    for (const [field, value] of Object.entries(wrong)) {
      expectCodePath(() => parseSymbolSet(JSON.stringify({ a: { ...good, [field]: value } })), 'TYPE', `/a/${field}`);
    }
    for (const field of ['name', 'radius', 'offset_x', 'offset_y', 'draw_mode']) {
      const entry = { ...good };
      delete entry[field];
      expectCodePath(() => parseSymbolSet(JSON.stringify({ a: entry })), 'SHAPE', `/a/${field}`);
    }
  });
  it('rejects non-object values and bad scalars with indexed paths', () => {
    expectCodePath(() => parseSymbolSet('{"a":42}'), 'SHAPE', '/a');
    expectCodePath(() => parseSymbolSet('{"a":[1]}'), 'SHAPE', '/a');
    expectCodePath(() => parseSymbolSet('{"a":{"name":"X","radius":1,"offset_x":0,"offset_y":0}}'), 'SHAPE', '/a/draw_mode');
    expectCodePath(
      () => parseSymbolSet('{"a":{"name":"X","radius":"bad","offset_x":0,"offset_y":0,"draw_mode":"n"}}'),
      'TYPE',
      '/a/radius',
    );
    expectCodePath(
      () => parseSymbolSet('{"a":{"name":"X","radius":-5,"offset_x":0,"offset_y":0,"draw_mode":"n"}}'),
      'TYPE',
      '/a/radius',
    );
  });
  it('rejects non-finite radii and ignores extra entry fields in images shape', () => {
    expectCodePath(
      () => parseSymbolSet('{"a":{"name":"X","radius":1e999,"offset_x":0,"offset_y":0,"draw_mode":"n"}}'),
      'TYPE',
      '/a/radius',
    );
    const file = parseSymbolSet(
      '{"a":{"name":"X","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"n","zzz_extra":[1,2]}}',
    );
    expect(file.shape).toBe('images');
    if (file.shape !== 'images') throw new Error('unreachable');
    expect(file.entries.get('a')).toEqual({ name: 'X', radius: 1, offsetX: 0, offsetY: 0, drawMode: 'n' });
  });
  it('accepts exactly maxEntries entries', () => {
    const parts: string[] = [];
    for (let i = 0; i < ASSET_JSON_LIMITS.maxEntries; i++) {
      parts.push(`"img${i}":{"name":"N","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"normal"}`);
    }
    const file = parseSymbolSet(`{${parts.join(',')}}`);
    expect(file.shape).toBe('images');
    if (file.shape !== 'images') throw new Error('unreachable');
    expect(file.entries.size).toBe(ASSET_JSON_LIMITS.maxEntries);
  });
  it('rejects more than maxEntries as LIMIT', () => {
    const parts: string[] = [];
    for (let i = 0; i <= ASSET_JSON_LIMITS.maxEntries; i++) {
      parts.push(`"img${i}":{"name":"N","radius":1,"offset_x":0,"offset_y":0,"draw_mode":"normal"}`);
    }
    expectCodePath(() => parseSymbolSet(`{${parts.join(',')}}`), 'LIMIT', '/');
  });
});

describe('parseSymbolSet root', () => {
  it.each(['null', '[]', '"x"', '42', '[1,2]'])('rejects %s as SHAPE', (text) => {
    expectCodePath(() => parseSymbolSet(text), 'SHAPE', '/');
  });
  it('rejects bad JSON as SYNTAX', () => {
    expectCodePath(() => parseSymbolSet('{oops'), 'SYNTAX', '/');
    expectCodePath(() => parseSymbolSet(''), 'SYNTAX', '/');
  });
});

describe('symbolEntryFor', () => {
  it('returns the one entry for folder shape whatever the image name', () => {
    const file = parseSymbolSet(folderJson);
    const entry = symbolEntryFor(file, 'anything at all') as SymbolEntry;
    expect(entry.name).toBe('Juniper Test');
  });
  it('looks up by base name for images shape, null when absent', () => {
    const file: SymbolSetFile = parseSymbolSet(imagesJson);
    expect((symbolEntryFor(file, '07') as SymbolEntry).radius).toBe(103);
    expect(symbolEntryFor(file, 'nope')).toBe(null);
  });
});

describe('parseColorString', () => {
  it('parses a valid color', () => {
    expect(parseColorString('0.242188,0.208817,0.120148,1')).toEqual({
      r: 0.242188,
      g: 0.208817,
      b: 0.120148,
      a: 1,
    });
    expect(parseColorString('-1,2e2,3E-1,0.5')).toEqual({ r: -1, g: 200, b: 0.3, a: 0.5 });
  });
  it.each([
    '0.1, 0.2,0.3,1',
    '0.1,0.2,0.3',
    '0.1,0.2,0.3,0.4,0.5',
    'nan,0,0,1',
    '1e999,0,0,1',
    '0.1,0.2,0.3,',
    '',
    ',,,',
    '0.1,0.2,0.3,0.4 ',
    '0x10,0,0,1',
    '.5,0,0,1',
    '0.1,0.2,0.3,Infinity',
  ])('rejects %p as TYPE', (text) => {
    expectCodePath(() => parseColorString(text), 'TYPE', '/');
  });
});

function themeObject(): Record<string, unknown> {
  return {
    water_texture: 'Pond Test',
    ground_texture: 'Pasture Test',
    water_hue: 0.5,
    water_saturation: 0.25,
    water_value: 0.75,
    vignette_strength: 0.1,
    coastal_fx_distance: 30,
    coastline_style: 1,
    coastline_color: '0.6,0.7,0.7,1',
    landmass_outline_color: '0.2,0.2,0.1,1',
    landmass_outline_blend: 0.5,
    freshwater_color: '0.5,0.7,0.7,1',
    freshwater_outline_color: '0.0,0.0,0.0,1',
    ground_colors: ['0.9,0.8,0.6,1', '0.2,0.2,0.1,1'],
    water_colors: ['0.1,0.2,0.3,1'],
    water_color_names: ['Deep Test'],
    ground_color_names: ['Grass Test'],
    path_color: '0.3,0.2,0.1,1',
    windrose_color: '0.2,0.2,0.1,0.5',
    symbol_custom_colors: ['0.3,0.1,0.1,1'],
    label_presets: {
      Village: {
        font_name: 'Test Serif',
        font_size: 28,
        font_color: '0.2,0.2,0.1,1',
        font_outline_width: 3,
        font_outline_color: '0.8,0.7,0.6,0.6',
      },
    },
  };
}

function themeJson(): string {
  return JSON.stringify(themeObject());
}

const requiredStringKeys = [
  'water_texture',
  'ground_texture',
  'coastline_color',
  'landmass_outline_color',
  'freshwater_color',
  'freshwater_outline_color',
  'path_color',
  'windrose_color',
];
const requiredNumberKeys = [
  'water_hue',
  'water_saturation',
  'water_value',
  'vignette_strength',
  'coastal_fx_distance',
  'coastline_style',
  'landmass_outline_blend',
];
const requiredArrayKeys = ['ground_colors', 'symbol_custom_colors'];
const optionalKeys = ['water_colors', 'water_color_names', 'ground_color_names'];

describe('parseThemeFile', () => {
  it('parses a full valid theme with optionals and no unknown keys', () => {
    const theme = parseThemeFile(themeJson());
    expect(theme.waterTexture).toBe('Pond Test');
    expect(theme.groundTexture).toBe('Pasture Test');
    expect(theme.waterHue).toBe(0.5);
    expect(theme.coastlineStyle).toBe(1);
    expect(theme.coastlineColor).toEqual({ r: 0.6, g: 0.7, b: 0.7, a: 1 });
    expect(theme.groundColors.length).toBe(2);
    expect(theme.waterColors).not.toBe(null);
    expect(theme.waterColorNames).toEqual(['Deep Test']);
    expect(theme.groundColorNames).toEqual(['Grass Test']);
    expect(theme.unknownKeys).toEqual([]);
    const preset = theme.labelPresets.get('Village');
    expect(preset).toBeDefined();
    expect(preset?.fontName).toBe('Test Serif');
    expect(preset?.fontSize).toBe(28);
    expect(preset?.fontOutlineWidth).toBe(3);
  });
  it('nulls absent optionals and sorts unknown keys', () => {
    const obj = themeObject();
    delete obj.water_colors;
    delete obj.water_color_names;
    delete obj.ground_color_names;
    obj.zzz_custom = 1;
    obj.aaa_extra = 'x';
    const theme = parseThemeFile(JSON.stringify(obj));
    expect(theme.waterColors).toBe(null);
    expect(theme.waterColorNames).toBe(null);
    expect(theme.groundColorNames).toBe(null);
    expect(theme.unknownKeys).toEqual(['aaa_extra', 'zzz_custom']);
  });
  it('rejects a missing label_presets as SHAPE and a non-object one as TYPE', () => {
    const obj = themeObject();
    delete obj.label_presets;
    expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'SHAPE', '/label_presets');
    const wrong = themeObject();
    wrong.label_presets = 'Village';
    expectCodePath(() => parseThemeFile(JSON.stringify(wrong)), 'TYPE', '/label_presets');
  });
  it.each(requiredStringKeys)('missing %s is SHAPE, wrong kind is TYPE', (key) => {
    const missing = themeObject();
    delete missing[key];
    expectCodePath(() => parseThemeFile(JSON.stringify(missing)), 'SHAPE', `/${key}`);
    const wrong = themeObject();
    wrong[key] = 42;
    expectCodePath(() => parseThemeFile(JSON.stringify(wrong)), 'TYPE', `/${key}`);
  });
  it.each(requiredNumberKeys)('missing %s is SHAPE, wrong kind or non-finite is TYPE', (key) => {
    const missing = themeObject();
    delete missing[key];
    expectCodePath(() => parseThemeFile(JSON.stringify(missing)), 'SHAPE', `/${key}`);
    const wrong = themeObject();
    wrong[key] = 'x';
    expectCodePath(() => parseThemeFile(JSON.stringify(wrong)), 'TYPE', `/${key}`);
    const inf = themeJson().replace(`"${key}":${JSON.stringify((themeObject() as Record<string, unknown>)[key])}`, `"${key}":1e999`);
    expectCodePath(() => parseThemeFile(inf), 'TYPE', `/${key}`);
  });
  it.each(requiredArrayKeys)('missing %s is SHAPE, non-array is TYPE', (key) => {
    const missing = themeObject();
    delete missing[key];
    expectCodePath(() => parseThemeFile(JSON.stringify(missing)), 'SHAPE', `/${key}`);
    const wrong = themeObject();
    wrong[key] = 'x';
    expectCodePath(() => parseThemeFile(JSON.stringify(wrong)), 'TYPE', `/${key}`);
  });
  it('rejects a bad color string in place as TYPE with the field path', () => {
    const obj = themeObject();
    obj.path_color = 'red';
    expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'TYPE', '/path_color');
  });
  it('a present optional of the wrong kind is TYPE', () => {
    for (const key of optionalKeys) {
      const obj = themeObject();
      obj[key] = 42;
      expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'TYPE', `/${key}`);
    }
  });
  it('rejects a color array above maxColors as LIMIT', () => {
    const obj = themeObject();
    obj.ground_colors = Array<string>(ASSET_JSON_LIMITS.maxColors + 1).fill('0,0,0,1');
    expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'LIMIT', '/ground_colors');
  });
  it('accepts exactly maxColors entries', () => {
    const obj = themeObject();
    obj.ground_colors = Array<string>(ASSET_JSON_LIMITS.maxColors).fill('0,0,0,1');
    expect(parseThemeFile(JSON.stringify(obj)).groundColors.length).toBe(ASSET_JSON_LIMITS.maxColors);
  });
  it('rejects a bad color element with the index path', () => {
    const obj = themeObject();
    obj.ground_colors = ['0,0,0,1', 'bogus'];
    expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'TYPE', '/ground_colors/1');
  });
  it('rejects a non-string color-name element as TYPE', () => {
    const obj = themeObject();
    obj.water_color_names = [42];
    expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'TYPE', '/water_color_names/0');
  });
  it('rejects a preset with a missing key as SHAPE and a wrong kind as TYPE', () => {
    const missing = themeObject();
    const presets = missing.label_presets as Record<string, Record<string, unknown>>;
    const village = presets.Village as Record<string, unknown>;
    delete village.font_color;
    expectCodePath(() => parseThemeFile(JSON.stringify(missing)), 'SHAPE', '/label_presets/Village/font_color');
    const wrong = themeObject();
    const presets2 = wrong.label_presets as Record<string, Record<string, unknown>>;
    (presets2.Village as Record<string, unknown>).font_size = 'big';
    expectCodePath(() => parseThemeFile(JSON.stringify(wrong)), 'TYPE', '/label_presets/Village/font_size');
    const notObj = themeObject();
    (notObj.label_presets as Record<string, unknown>).Village = 'x';
    expectCodePath(() => parseThemeFile(JSON.stringify(notObj)), 'SHAPE', '/label_presets/Village');
  });
  it('rejects more than maxPresets as LIMIT', () => {
    const obj = themeObject();
    const presets: Record<string, unknown> = {};
    for (let i = 0; i <= ASSET_JSON_LIMITS.maxPresets; i++) {
      presets[`P${i}`] = {
        font_name: 'F',
        font_size: 1,
        font_color: '0,0,0,1',
        font_outline_width: 1,
        font_outline_color: '0,0,0,1',
      };
    }
    obj.label_presets = presets;
    expectCodePath(() => parseThemeFile(JSON.stringify(obj)), 'LIMIT', '/label_presets');
  });
  it('accepts exactly maxPresets entries', () => {
    const obj = themeObject();
    const presets: Record<string, unknown> = {};
    for (let i = 0; i < ASSET_JSON_LIMITS.maxPresets; i++) {
      presets[`P${i}`] = {
        font_name: 'F',
        font_size: 1,
        font_color: '0,0,0,1',
        font_outline_width: 1,
        font_outline_color: '0,0,0,1',
      };
    }
    obj.label_presets = presets;
    expect(parseThemeFile(JSON.stringify(obj)).labelPresets.size).toBe(ASSET_JSON_LIMITS.maxPresets);
  });
  it('rejects bad roots as SYNTAX/SHAPE', () => {
    expectCodePath(() => parseThemeFile('{oops'), 'SYNTAX', '/');
    expectCodePath(() => parseThemeFile('[]'), 'SHAPE', '/');
    expectCodePath(() => parseThemeFile('null'), 'SHAPE', '/');
  });
});

describe('asset-json seeded fuzz', () => {
  it('1000 mutations of each valid shape: only AssetJsonError escapes', () => {
    const seeds = [folderJson, imagesJson, themeJson()];
    const alphabet = ['{', '}', '"', ':', ',', '[', ']', '.', '/', 'e', '9', ' ', 'x', '_', '-', '+', 'n', '0'];
    let sawOk = 0;
    let sawErr = 0;
    for (const seed of seeds) {
      const rand = mulberry32(0x05eED);
      const isTheme = seed === seeds[2];
      for (let n = 0; n < 1000; n++) {
        const chars = seed.split('');
        const edits = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < edits; k++) {
          const at = Math.floor(rand() * (chars.length + 1));
          const pick = rand();
          if (pick < 0.4) chars.splice(at, 0, alphabet[Math.floor(rand() * alphabet.length)]);
          else if (pick < 0.7) chars.splice(at, 1);
          else if (at < chars.length) chars[at] = alphabet[Math.floor(rand() * alphabet.length)] as string;
        }
        const text = chars.join('');
        try {
          if (isTheme) parseThemeFile(text);
          else parseSymbolSet(text);
          sawOk++;
        } catch (e) {
          expect(e).toBeInstanceOf(AssetJsonError);
          sawErr++;
        }
      }
    }
    expect(sawOk).toBeGreaterThan(0);
    expect(sawErr).toBeGreaterThan(0);
  });
});
