/** Strict loaders for the two JSON data files: `.wonderdraft_symbols` (folder
 * shape or per-image map) and `.wonderdraft_theme`. `JSON.parse` failures are
 * SYNTAX; a missing required field is SHAPE; a field of the wrong kind or a
 * non-finite number is TYPE; oversize collections are LIMIT. Untrusted keys
 * only ever land in a `Map`, never on a plain object. Nothing here throws but
 * `AssetJsonError`.
 */
import type { Rgba } from '../formats/wonderdraft-map.ts';

export type AssetJsonErrorCode = 'TOO_LARGE' | 'ENCODING' | 'SYNTAX' | 'SHAPE' | 'TYPE' | 'LIMIT';

export class AssetJsonError extends Error {
  readonly code: AssetJsonErrorCode;
  readonly path: string;
  constructor(code: AssetJsonErrorCode, path: string, message: string) {
    super(message);
    this.name = 'AssetJsonError';
    this.code = code;
    this.path = path;
  }
}

export const ASSET_JSON_LIMITS: Readonly<{
  maxChars: number;
  maxEntries: number;
  maxColors: number;
  maxPresets: number;
}> = Object.freeze({ maxChars: 1048576, maxEntries: 20000, maxColors: 1000, maxPresets: 1000 });

/** Strict UTF-8 (`fatal: true`, `ignoreBOM: true`, so a BOM stays in the text
 * and then fails as SYNTAX in the parsers). More than maxChars bytes is
 * TOO_LARGE; invalid UTF-8 is ENCODING.
 */
export function decodeAssetText(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new AssetJsonError('TYPE', '/', 'input is not bytes');
  if (bytes.length > ASSET_JSON_LIMITS.maxChars) throw new AssetJsonError('TOO_LARGE', '/', 'input exceeds maxChars');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AssetJsonError('ENCODING', '/', 'input is not valid UTF-8');
  }
}

export interface SymbolEntry {
  readonly name: string;
  readonly radius: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly drawMode: string;
}

/** Informational: an unknown draw mode is NOT an error. */
export const KNOWN_DRAW_MODES: readonly string[] = Object.freeze([
  'normal',
  'sample_color',
  'custom_colors',
  'custom_colors_2',
]);

export type SymbolSetFile =
  | Readonly<{ shape: 'folder'; entry: SymbolEntry }>
  | Readonly<{ shape: 'images'; entries: ReadonlyMap<string, SymbolEntry> }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function parseRoot(text: string): Record<string, unknown> {
  if (typeof text !== 'string') throw new AssetJsonError('SYNTAX', '/', 'input is not a string');
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new AssetJsonError('SYNTAX', '/', 'input is not valid JSON');
  }
  if (!isPlainObject(root)) throw new AssetJsonError('SHAPE', '/', 'root is not an object');
  return root;
}

function requiredString(obj: Record<string, unknown>, key: string, path: string): string {
  if (!Object.hasOwn(obj, key)) throw new AssetJsonError('SHAPE', path, `missing ${key}`);
  const value: unknown = obj[key];
  if (typeof value !== 'string') throw new AssetJsonError('TYPE', path, `${key} is not a string`);
  return value;
}

function requiredNumber(obj: Record<string, unknown>, key: string, path: string): number {
  if (!Object.hasOwn(obj, key)) throw new AssetJsonError('SHAPE', path, `missing ${key}`);
  const value: unknown = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AssetJsonError('TYPE', path, `${key} is not a finite number`);
  }
  return value;
}

function readSymbolEntry(obj: Record<string, unknown>, base: string): SymbolEntry {
  const name = requiredString(obj, 'name', `${base}/name`);
  const radius = requiredNumber(obj, 'radius', `${base}/radius`);
  if (radius < 0) throw new AssetJsonError('TYPE', `${base}/radius`, 'radius is negative');
  const offsetX = requiredNumber(obj, 'offset_x', `${base}/offset_x`);
  const offsetY = requiredNumber(obj, 'offset_y', `${base}/offset_y`);
  const drawMode = requiredString(obj, 'draw_mode', `${base}/draw_mode`);
  return { name, radius, offsetX, offsetY, drawMode };
}

function escapePointer(segment: string): string {
  let out = '';
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charCodeAt(i);
    if (c === 0x7e) out += '~0';
    else if (c === 0x2f) out += '~1';
    else out += segment[i] as string;
  }
  return out;
}

/** J2: folder shape when the root carries a string `name` or any `radius`
 * key, otherwise the per-image map. Extra fields are ignored.
 *
 * Parse already-bounded text. Untrusted file bytes must pass through
 * decodeAssetText first for strict UTF-8 decoding and the byte-size limit.
 */
export function parseSymbolSet(text: string): SymbolSetFile {
  const root = parseRoot(text);
  const nameValue: unknown = Object.hasOwn(root, 'name') ? root['name'] : undefined;
  if (typeof nameValue === 'string' || Object.hasOwn(root, 'radius')) {
    return { shape: 'folder', entry: readSymbolEntry(root, '') };
  }
  const keys = Object.keys(root);
  if (keys.length === 0) throw new AssetJsonError('SHAPE', '/', 'images shape has no entries');
  if (keys.length > ASSET_JSON_LIMITS.maxEntries) throw new AssetJsonError('LIMIT', '/', 'too many entries');
  const entries = new Map<string, SymbolEntry>();
  for (const key of keys) {
    const value: unknown = root[key];
    const base = `/${escapePointer(key)}`;
    if (!isPlainObject(value)) throw new AssetJsonError('SHAPE', base, 'entry is not an object');
    entries.set(key, readSymbolEntry(value, base));
  }
  return { shape: 'images', entries };
}

/** Folder shape: the one entry; images shape: the entry for that base name or null. */
export function symbolEntryFor(file: SymbolSetFile, imageName: string): SymbolEntry | null {
  if (file.shape === 'folder') return file.entry;
  const found = file.entries.get(imageName);
  return found === undefined ? null : found;
}

const COLOR_PART = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function parseColorAt(text: unknown, path: string): Rgba {
  if (typeof text !== 'string') throw new AssetJsonError('TYPE', path, 'color is not a string');
  const parts = text.split(',');
  if (parts.length !== 4) throw new AssetJsonError('TYPE', path, 'color must hold four components');
  const nums: number[] = [];
  for (const part of parts) {
    if (!COLOR_PART.test(part)) throw new AssetJsonError('TYPE', path, 'bad color component');
    const value = Number(part);
    if (!Number.isFinite(value)) throw new AssetJsonError('TYPE', path, 'non-finite color component');
    nums.push(value);
  }
  return { r: nums[0] as number, g: nums[1] as number, b: nums[2] as number, a: nums[3] as number };
}

/** Exactly four decimal numbers separated by single commas, no spaces; each
 * matches /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/ and is finite (TYPE otherwise).
 */
export function parseColorString(text: string): Rgba {
  return parseColorAt(text, '/');
}

export interface LabelPreset {
  readonly fontName: string;
  readonly fontSize: number;
  readonly fontColor: Rgba;
  readonly fontOutlineWidth: number;
  readonly fontOutlineColor: Rgba;
}

export interface ThemeFile {
  readonly waterTexture: string;
  readonly groundTexture: string;
  readonly waterHue: number;
  readonly waterSaturation: number;
  readonly waterValue: number;
  readonly vignetteStrength: number;
  readonly coastalFxDistance: number;
  readonly coastlineStyle: number;
  readonly coastlineColor: Rgba;
  readonly landmassOutlineColor: Rgba;
  readonly landmassOutlineBlend: number;
  readonly freshwaterColor: Rgba;
  readonly freshwaterOutlineColor: Rgba;
  readonly groundColors: readonly Rgba[];
  readonly waterColors: readonly Rgba[] | null;
  readonly waterColorNames: readonly string[] | null;
  readonly groundColorNames: readonly string[] | null;
  readonly pathColor: Rgba;
  readonly windroseColor: Rgba;
  readonly symbolCustomColors: readonly Rgba[];
  readonly labelPresets: ReadonlyMap<string, LabelPreset>;
  readonly unknownKeys: readonly string[];
}

const THEME_KNOWN_KEYS: readonly string[] = Object.freeze([
  'water_texture',
  'ground_texture',
  'water_hue',
  'water_saturation',
  'water_value',
  'vignette_strength',
  'coastal_fx_distance',
  'coastline_style',
  'coastline_color',
  'landmass_outline_color',
  'landmass_outline_blend',
  'freshwater_color',
  'freshwater_outline_color',
  'ground_colors',
  'water_colors',
  'water_color_names',
  'ground_color_names',
  'path_color',
  'windrose_color',
  'symbol_custom_colors',
  'label_presets',
]);

function requiredColor(root: Record<string, unknown>, key: string, path: string): Rgba {
  return parseColorAt(requiredString(root, key, path), path);
}

function colorArray(value: unknown, path: string): Rgba[] {
  if (!Array.isArray(value)) throw new AssetJsonError('TYPE', path, 'color list is not an array');
  if (value.length > ASSET_JSON_LIMITS.maxColors) throw new AssetJsonError('LIMIT', path, 'too many colors');
  const out: Rgba[] = [];
  for (let i = 0; i < value.length; i++) {
    out.push(parseColorAt(value[i], `${path}/${i}`));
  }
  return out;
}

function requiredColorArray(root: Record<string, unknown>, key: string, path: string): Rgba[] {
  if (!Object.hasOwn(root, key)) throw new AssetJsonError('SHAPE', path, `missing ${key}`);
  return colorArray(root[key], path);
}

function optionalColorArray(root: Record<string, unknown>, key: string, path: string): Rgba[] | null {
  if (!Object.hasOwn(root, key)) return null;
  return colorArray(root[key], path);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new AssetJsonError('TYPE', path, 'string list is not an array');
  if (value.length > ASSET_JSON_LIMITS.maxColors) throw new AssetJsonError('LIMIT', path, 'too many names');
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (typeof item !== 'string') throw new AssetJsonError('TYPE', `${path}/${i}`, 'name is not a string');
    out.push(item);
  }
  return out;
}

function optionalStringArray(root: Record<string, unknown>, key: string, path: string): string[] | null {
  if (!Object.hasOwn(root, key)) return null;
  return stringArray(root[key], path);
}

function readLabelPresets(root: Record<string, unknown>): Map<string, LabelPreset> {
  if (!Object.hasOwn(root, 'label_presets')) throw new AssetJsonError('SHAPE', '/label_presets', 'missing label_presets');
  const raw: unknown = root['label_presets'];
  if (!isPlainObject(raw)) throw new AssetJsonError('TYPE', '/label_presets', 'label_presets is not an object');
  const keys = Object.keys(raw);
  if (keys.length > ASSET_JSON_LIMITS.maxPresets) {
    throw new AssetJsonError('LIMIT', '/label_presets', 'too many presets');
  }
  const presets = new Map<string, LabelPreset>();
  for (const key of keys) {
    const value: unknown = raw[key];
    const base = `/label_presets/${escapePointer(key)}`;
    if (!isPlainObject(value)) throw new AssetJsonError('SHAPE', base, 'preset is not an object');
    presets.set(key, {
      fontName: requiredString(value, 'font_name', `${base}/font_name`),
      fontSize: requiredNumber(value, 'font_size', `${base}/font_size`),
      fontColor: parseColorAt(requiredString(value, 'font_color', `${base}/font_color`), `${base}/font_color`),
      fontOutlineWidth: requiredNumber(value, 'font_outline_width', `${base}/font_outline_width`),
      fontOutlineColor: parseColorAt(
        requiredString(value, 'font_outline_color', `${base}/font_outline_color`),
        `${base}/font_outline_color`,
      ),
    });
  }
  return presets;
}

/** J3: required keys and kinds exactly as measured; the three optional keys
 * become null when absent; unknown root keys are listed in unknownKeys
 * (sorted) and otherwise ignored.
 *
 * Parse already-bounded text. Untrusted file bytes must pass through
 * decodeAssetText first for strict UTF-8 decoding and the byte-size limit.
 */
export function parseThemeFile(text: string): ThemeFile {
  const root = parseRoot(text);
  const theme: ThemeFile = {
    waterTexture: requiredString(root, 'water_texture', '/water_texture'),
    groundTexture: requiredString(root, 'ground_texture', '/ground_texture'),
    waterHue: requiredNumber(root, 'water_hue', '/water_hue'),
    waterSaturation: requiredNumber(root, 'water_saturation', '/water_saturation'),
    waterValue: requiredNumber(root, 'water_value', '/water_value'),
    vignetteStrength: requiredNumber(root, 'vignette_strength', '/vignette_strength'),
    coastalFxDistance: requiredNumber(root, 'coastal_fx_distance', '/coastal_fx_distance'),
    coastlineStyle: requiredNumber(root, 'coastline_style', '/coastline_style'),
    coastlineColor: requiredColor(root, 'coastline_color', '/coastline_color'),
    landmassOutlineColor: requiredColor(root, 'landmass_outline_color', '/landmass_outline_color'),
    landmassOutlineBlend: requiredNumber(root, 'landmass_outline_blend', '/landmass_outline_blend'),
    freshwaterColor: requiredColor(root, 'freshwater_color', '/freshwater_color'),
    freshwaterOutlineColor: requiredColor(root, 'freshwater_outline_color', '/freshwater_outline_color'),
    groundColors: requiredColorArray(root, 'ground_colors', '/ground_colors'),
    waterColors: optionalColorArray(root, 'water_colors', '/water_colors'),
    waterColorNames: optionalStringArray(root, 'water_color_names', '/water_color_names'),
    groundColorNames: optionalStringArray(root, 'ground_color_names', '/ground_color_names'),
    pathColor: requiredColor(root, 'path_color', '/path_color'),
    windroseColor: requiredColor(root, 'windrose_color', '/windrose_color'),
    symbolCustomColors: requiredColorArray(root, 'symbol_custom_colors', '/symbol_custom_colors'),
    labelPresets: readLabelPresets(root),
    unknownKeys: Object.keys(root).filter((key) => THEME_KNOWN_KEYS.indexOf(key) < 0).sort(),
  };
  return theme;
}
