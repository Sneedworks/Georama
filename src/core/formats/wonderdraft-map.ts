// Wonderdraft v15 map schema model: typed, lossless, validated.
// One declarative field table per record kind drives BOTH directions.
// Reader and writer accept exactly the same files: a Vector2 or Color with a non-finite component is rejected on read,
// as a Real is; an Image object has string prop names and exactly one `data` prop; a symbol texture is a string or an
// ImageTexture object; the version is judged before any other key. The number of unknown entries a record may carry is
// bounded only by the decoder's node budget (there is no per-record cap, see the review notes of task 0.4b).
// Type-discipline table (key = wire kind; `nil|X` = nullable, `A|B` = union kept as decoded):
// WdMap: version=int(=15) map_width=real map_height=real water_level=real water_flip_x=bool water_flip_y=bool water_offset=Vector2 water_stain=real windroses=Array:RAW theme=Dict(WdTheme) layers=Dict(WdLayers) paths=Array[WdPath] territories=Dict(WdTerritories) symbols=Array[WdSymbol] labels=Array[WdLabel] sharpen_labels=bool mask=Object:Image ground=Object:Image water_tint=Object:Image trace=nil:RAW grid=nil|Dict(WdGrid) frame=Dict(WdFrame) scale=nil|Dict(WdScale) boxes=Array:RAW load_default_symbols=bool load_default_not_symbols=bool included_default_packs=Array[string] included_packs=Array[string]
// WdTheme: water_texture=string ground_texture=string water_hue=real water_saturation=real water_value=real vignette_strength=real coastal_fx_distance=real coastline_style=int coastline_color=Color landmass_outline_color=Color landmass_outline_blend=real freshwater_color=Color freshwater_outline_color=Color ground_colors=Array[Color] ground_color_names=Array[string] water_colors=Array[Color] water_color_names=Array[string] path_color=Color symbol_custom_colors=Array[Color] windrose_color=Color label_presets=Dict:RAW color_grading=Dict:RAW randomize_water_mirror=bool randomize_water_offsets=bool
// WdLayers: enabled=bool names=Array[string] visibility=Array[bool] lock=Array[bool]
// WdFrame: enabled=bool texture=string size=real tint=Color
// WdGrid: pattern=int layer=int size=real line_width=real color=Color offset=Vector2
// WdScale: position=Vector2 rotation=real colors=Array[Color] size=Vector2 segments=real line_width=real segment_distance=real numbers_display=int font=string font_size=real outline_width=real font_color=Color outline_color=Color units=string
// WdPath: position=Vector2 points=string color=Color style=string width=real roughness=real noise_seed=int z_index=int straight=bool
// WdTerritories: territories=Array[WdTerritory]
// WdTerritory: position=Vector2 points=string smoothing=real color=Color opacity=real style=string width=real z_index=int
// WdSymbol: texture=string|Object:ImageTexture:UNION position=Vector2 rotation=real scale=Vector2 z_index=int offset=Vector2 radius=real type=string mirror=bool sample=nil|Color custom_colors=nil|Array[Color] custom_color_mode=nil|int
// WdLabel: position=Vector2 rotation=real text=string font=string size=int color=Color outline_size=int outline_color=Color glow_size=int|real:UNION glow_color=Color align=int curve=real extra_spacing_char=int z_index=int
// ImageData: width=int height=int format=string mipmaps=bool data=PoolByteArray
import { GdDict, GdObject } from './godot-var.ts';
import type { GdValue } from './godot-var.ts';
import {
  MAX_SAFE_BIG,
  WD_LIMITS,
  WdSchemaError,
  f,
  fail,
  join,
  readArray,
  readBool,
  readBoolList,
  readColor,
  readColorList,
  readInt,
  readPoolBytes,
  readReal,
  readRecord,
  readRecordList,
  readString,
  readStringList,
  readVec2,
  readVersion,
  reqInt,
  requireDict,
  writeBool,
  writeBoolList,
  writeColor,
  writeColorList,
  writePoolBytes,
  writeRawArray,
  writeReal,
  writeRecord,
  writeRecordList,
  writeString,
  writeStringList,
  writeVec2,
  writeVersion,
} from './wonderdraft-map-engine.ts';
import type { FieldDef, WdSchemaErrorCode } from './wonderdraft-map-engine.ts';

export { WD_LIMITS, WdSchemaError };
export type { WdSchemaErrorCode };

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface WdRecordMeta {
  layout?: Array<string | number>;
  extra?: Array<[GdValue, GdValue]>;
  shared?: boolean;
}

export interface WdMap extends WdRecordMeta {
  version: 15;
  mapWidth: number;
  mapHeight: number;
  waterLevel: number;
  waterFlipX: boolean;
  waterFlipY: boolean;
  waterOffset: Vec2;
  waterStain: number;
  windroses: GdValue;
  theme: WdTheme;
  layers: WdLayers;
  paths: WdPath[];
  territories: WdTerritories;
  symbols: WdSymbol[];
  labels: WdLabel[];
  sharpenLabels: boolean;
  mask: WdRaster;
  ground: WdRaster;
  waterTint: WdRaster;
  trace: GdValue;
  grid: WdGrid | null;
  frame: WdFrame;
  scale: WdScale | null;
  boxes: GdValue;
  loadDefaultSymbols: boolean;
  loadDefaultNotSymbols: boolean;
  includedDefaultPacks: string[];
  includedPacks: string[];
}

export interface WdTheme extends WdRecordMeta {
  waterTexture: string;
  groundTexture: string;
  waterHue: number;
  waterSaturation: number;
  waterValue: number;
  vignetteStrength: number;
  coastalFxDistance: number;
  coastlineStyle: number;
  coastlineColor: Rgba;
  landmassOutlineColor: Rgba;
  landmassOutlineBlend: number;
  freshwaterColor: Rgba;
  freshwaterOutlineColor: Rgba;
  groundColors: Rgba[];
  groundColorNames: string[];
  waterColors: Rgba[];
  waterColorNames: string[];
  pathColor: Rgba;
  symbolCustomColors: Rgba[];
  windroseColor: Rgba;
  labelPresets: GdValue;
  colorGrading: GdValue;
  randomizeWaterMirror: boolean;
  randomizeWaterOffsets: boolean;
}

export interface WdLayers extends WdRecordMeta {
  enabled: boolean;
  names: string[];
  visibility: boolean[];
  lock: boolean[];
}

export interface WdFrame extends WdRecordMeta {
  enabled: boolean;
  texture: string;
  size: number;
  tint: Rgba;
}

export interface WdGrid extends WdRecordMeta {
  pattern: number;
  layer: number;
  size: number;
  lineWidth: number;
  color: Rgba;
  offset: Vec2;
}

export interface WdScale extends WdRecordMeta {
  position: Vec2;
  rotation: number;
  colors: Rgba[];
  size: Vec2;
  segments: number;
  lineWidth: number;
  segmentDistance: number;
  numbersDisplay: number;
  font: string;
  fontSize: number;
  outlineWidth: number;
  fontColor: Rgba;
  outlineColor: Rgba;
  units: string;
}

export interface WdPath extends WdRecordMeta {
  position: Vec2;
  points: string;
  color: Rgba;
  style: string;
  width: number;
  roughness: number;
  noiseSeed: number;
  zIndex: number;
  straight: boolean;
}

export interface WdTerritories extends WdRecordMeta {
  territories: WdTerritory[];
}

export interface WdTerritory extends WdRecordMeta {
  position: Vec2;
  points: string;
  smoothing: number;
  color: Rgba;
  opacity: number;
  style: string;
  width: number;
  zIndex: number;
}

export interface WdSymbol extends WdRecordMeta {
  texture: string | GdObject;
  position: Vec2;
  rotation: number;
  scale: Vec2;
  zIndex: number;
  offset: Vec2;
  radius: number;
  type: string;
  mirror: boolean;
  sample: Rgba | null;
  customColors: Rgba[] | null;
  customColorMode: number | null;
}

export interface WdLabel extends WdRecordMeta {
  position: Vec2;
  rotation: number;
  text: string;
  font: string;
  size: number;
  color: Rgba;
  outlineSize: number;
  outlineColor: Rgba;
  glowSize: bigint | number;
  glowColor: Rgba;
  align: number;
  curve: number;
  extraSpacingChar: number;
  zIndex: number;
}

export interface WdRaster extends WdRecordMeta {
  width: number;
  height: number;
  format: string;
  mipmaps: boolean;
  data: Uint8Array;
  imageProps: Array<[string, GdValue]>;
  dataPropIndex: number;
}

// A symbol texture is a path string or an embedded ImageTexture object (<redacted> symbols in <redacted> of the <redacted> corpus maps).
// Anything else, including the null Object, is not a texture.
function readTexture(v: GdValue, path: string): string | GdObject {
  if (typeof v === 'string') return readString(v, path);
  if (v instanceof GdObject && v.cls === 'ImageTexture') return v;
  fail('TYPE', path, 'expected String or ImageTexture object');
}

function writeTexture(m: unknown, path: string): GdValue {
  if (typeof m === 'string') return writeString(m, path);
  if (m instanceof GdObject && m.cls === 'ImageTexture') return m;
  fail('TYPE', path, 'expected String or ImageTexture object');
}

function readGlowSize(v: GdValue, path: string): bigint | number {
  if (typeof v === 'bigint') {
    if (v < -MAX_SAFE_BIG || v > MAX_SAFE_BIG) fail('LIMIT', path, 'Int outside safe range');
    return v;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail('FORMAT', path, 'non-finite Real');
    return v;
  }
  fail('TYPE', path, 'expected Int or Real glow_size');
}

function writeGlowSize(m: unknown, path: string): GdValue {
  if (typeof m === 'bigint') {
    if (m < -MAX_SAFE_BIG || m > MAX_SAFE_BIG) fail('TYPE', path, 'Int outside safe range');
    return m;
  }
  if (typeof m === 'number') {
    if (!Number.isFinite(m)) fail('FORMAT', path, 'non-finite Real');
    return m;
  }
  fail('TYPE', path, 'expected Int or Real glow_size');
}

const themeTable: FieldDef[] = [
  f('water_texture', readString, writeString),
  f('ground_texture', readString, writeString),
  f('water_hue', readReal, writeReal),
  f('water_saturation', readReal, writeReal),
  f('water_value', readReal, writeReal),
  f('vignette_strength', readReal, writeReal),
  f('coastal_fx_distance', readReal, writeReal),
  f('coastline_style', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('coastline_color', readColor, writeColor),
  f('landmass_outline_color', readColor, writeColor),
  f('landmass_outline_blend', readReal, writeReal),
  f('freshwater_color', readColor, writeColor),
  f('freshwater_outline_color', readColor, writeColor),
  f('ground_colors', readColorList, writeColorList),
  f('ground_color_names', readStringList, writeStringList),
  f('water_colors', readColorList, writeColorList),
  f('water_color_names', readStringList, writeStringList),
  f('path_color', readColor, writeColor),
  f('symbol_custom_colors', readColorList, writeColorList),
  f('windrose_color', readColor, writeColor),
  f('label_presets', (v) => v, (m) => m as GdValue),
  f('color_grading', (v) => v, (m) => m as GdValue),
  f('randomize_water_mirror', readBool, writeBool),
  f('randomize_water_offsets', readBool, writeBool),
];

const layersTable: FieldDef[] = [
  f('enabled', readBool, writeBool),
  f('names', readStringList, writeStringList),
  f('visibility', readBoolList, writeBoolList),
  f('lock', readBoolList, writeBoolList),
];

const frameTable: FieldDef[] = [
  f('enabled', readBool, writeBool),
  f('texture', readString, writeString),
  f('size', readReal, writeReal),
  f('tint', readColor, writeColor),
];

const gridTable: FieldDef[] = [
  f('pattern', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('layer', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('size', readReal, writeReal),
  f('line_width', readReal, writeReal),
  f('color', readColor, writeColor),
  f('offset', readVec2, writeVec2),
];

const scaleTable: FieldDef[] = [
  f('position', readVec2, writeVec2),
  f('rotation', readReal, writeReal),
  f('colors', readColorList, writeColorList),
  f('size', readVec2, writeVec2),
  f('segments', readReal, writeReal),
  f('line_width', readReal, writeReal),
  f('segment_distance', readReal, writeReal),
  f('numbers_display', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('font', readString, writeString),
  f('font_size', readReal, writeReal),
  f('outline_width', readReal, writeReal),
  f('font_color', readColor, writeColor),
  f('outline_color', readColor, writeColor),
  f('units', readString, writeString),
];

const pathTable: FieldDef[] = [
  f('position', readVec2, writeVec2),
  f('points', readString, writeString),
  f('color', readColor, writeColor),
  f('style', readString, writeString),
  f('width', readReal, writeReal),
  f('roughness', readReal, writeReal),
  f('noise_seed', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('z_index', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('straight', readBool, writeBool),
];

const territoryTable: FieldDef[] = [
  f('position', readVec2, writeVec2),
  f('points', readString, writeString),
  f('smoothing', readReal, writeReal),
  f('color', readColor, writeColor),
  f('opacity', readReal, writeReal),
  f('style', readString, writeString),
  f('width', readReal, writeReal),
  f('z_index', readInt, (m, p) => BigInt(reqInt(m, p))),
];

const territoriesTable: FieldDef[] = [
  f('territories', (v, p) => readRecordList<WdTerritory>(v, p, territoryTable, WD_LIMITS.maxTerritories),
    (m, p) => writeRecordList(m, p, territoryTable, WD_LIMITS.maxTerritories)),
];

const symbolTable: FieldDef[] = [
  f('texture', readTexture, writeTexture),
  f('position', readVec2, writeVec2),
  f('rotation', readReal, writeReal),
  f('scale', readVec2, writeVec2),
  f('z_index', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('offset', readVec2, writeVec2),
  f('radius', readReal, writeReal),
  f('type', readString, writeString),
  f('mirror', readBool, writeBool),
  f('sample', (v, p) => (v === null ? null : readColor(v, p)),
    (m, p) => (m === null ? null : writeColor(m, p))),
  f('custom_colors', (v, p) => (v === null ? null : readColorList(v, p)),
    (m, p) => (m === null ? null : writeColorList(m, p))),
  f('custom_color_mode', (v, p) => (v === null ? null : readInt(v, p)),
    (m, p) => (m === null ? null : BigInt(reqInt(m, p)))),
];

const labelTable: FieldDef[] = [
  f('position', readVec2, writeVec2),
  f('rotation', readReal, writeReal),
  f('text', readString, writeString),
  f('font', readString, writeString),
  f('size', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('color', readColor, writeColor),
  f('outline_size', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('outline_color', readColor, writeColor),
  f('glow_size', readGlowSize, writeGlowSize),
  f('glow_color', readColor, writeColor),
  f('align', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('curve', readReal, writeReal),
  f('extra_spacing_char', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('z_index', readInt, (m, p) => BigInt(reqInt(m, p))),
];

const rasterInnerTable: FieldDef[] = [
  f('width', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('height', readInt, (m, p) => BigInt(reqInt(m, p))),
  f('format', readString, writeString),
  f('mipmaps', readBool, writeBool),
  f('data', readPoolBytes, writePoolBytes),
];

function readRaster(v: GdValue, path: string): WdRaster {
  if (!(v instanceof GdObject) || v.cls !== 'Image') fail('TYPE', path, 'expected Image object');
  const obj = v;
  let dataIndex = -1;
  for (let i = 0; i < obj.props.length; i++) {
    // Reader and writer must agree on what an Image is: names are strings and there is one `data` prop.
    const prop = obj.props[i];
    if (!Array.isArray(prop) || prop.length !== 2 || typeof prop[0] !== 'string') fail('TYPE', path, `bad image prop ${i}`);
    if (prop[0] === 'data') {
      if (dataIndex >= 0) fail('FORMAT', join(path, 'data'), 'duplicate data prop');
      dataIndex = i;
    }
  }
  if (dataIndex < 0) fail('MISSING', join(path, 'data'), 'missing data');
  const dataPath = join(path, 'data');
  const inner = readRecord(requireDict(obj.props[dataIndex][1], dataPath), rasterInnerTable, dataPath);
  const width = inner['width'] as number;
  const height = inner['height'] as number;
  const format = inner['format'] as string;
  const mipmaps = inner['mipmaps'] as boolean;
  const data = inner['data'] as Uint8Array;
  if (format !== 'RGBA8') fail('FORMAT', `${dataPath}/format`, 'expected RGBA8');
  if (mipmaps !== false) fail('FORMAT', `${dataPath}/mipmaps`, 'expected no mipmaps');
  if (width > WD_LIMITS.maxRasterSide) fail('LIMIT', `${dataPath}/width`, 'raster side too large');
  if (width < 1) fail('FORMAT', `${dataPath}/width`, 'raster side too small');
  if (height > WD_LIMITS.maxRasterSide) fail('LIMIT', `${dataPath}/height`, 'raster side too large');
  if (height < 1) fail('FORMAT', `${dataPath}/height`, 'raster side too small');
  if (data.length !== width * height * 4) fail('FORMAT', `${dataPath}/data`, 'raster byte length mismatch');
  const imageProps: Array<[string, GdValue]> = [];
  for (let i = 0; i < obj.props.length; i++) {
    if (i !== dataIndex) imageProps.push(obj.props[i]);
  }
  const out: WdRaster = {
    width,
    height,
    format,
    mipmaps,
    data,
    imageProps,
    dataPropIndex: dataIndex,
  };
  if (inner['layout'] !== undefined) {
    out.layout = inner['layout'] as Array<string | number>;
    out.extra = inner['extra'] as Array<[GdValue, GdValue]>;
  }
  if (inner['shared'] !== undefined) out.shared = true;
  return out;
}

function writeRaster(m: unknown, path: string): GdObject {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) fail('TYPE', path, 'expected raster');
  const r = m as Record<string, unknown>;
  const dataPath = join(path, 'data');
  const width = reqInt(r['width'], `${dataPath}/width`);
  const height = reqInt(r['height'], `${dataPath}/height`);
  if (r['format'] !== 'RGBA8') fail('FORMAT', `${dataPath}/format`, 'expected RGBA8');
  if (r['mipmaps'] !== false) fail('FORMAT', `${dataPath}/mipmaps`, 'expected no mipmaps');
  if (width > WD_LIMITS.maxRasterSide) fail('LIMIT', `${dataPath}/width`, 'raster side too large');
  if (width < 1) fail('FORMAT', `${dataPath}/width`, 'raster side too small');
  if (height > WD_LIMITS.maxRasterSide) fail('LIMIT', `${dataPath}/height`, 'raster side too large');
  if (height < 1) fail('FORMAT', `${dataPath}/height`, 'raster side too small');
  if (!(r['data'] instanceof Uint8Array)) fail('TYPE', `${dataPath}/data`, 'expected PoolByteArray');
  const data = r['data'];
  if (data.length !== width * height * 4) fail('FORMAT', `${dataPath}/data`, 'raster byte length mismatch');
  if (!Array.isArray(r['imageProps'])) fail('FORMAT', path, 'bad imageProps');
  const imageProps = r['imageProps'] as Array<[string, GdValue]>;
  const dataPropIndex = r['dataPropIndex'];
  if (
    typeof dataPropIndex !== 'number' || !Number.isInteger(dataPropIndex) ||
    dataPropIndex < 0 || dataPropIndex > imageProps.length
  ) {
    fail('FORMAT', path, 'bad dataPropIndex');
  }
  const at = dataPropIndex as number;
  for (const pair of imageProps) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
      fail('TYPE', path, 'bad image prop');
    }
    if (pair[0] === 'data') fail('FORMAT', path, 'duplicate data prop');
  }
  const inner = writeRecord(
    {
      width,
      height,
      format: r['format'],
      mipmaps: r['mipmaps'],
      data,
      layout: r['layout'],
      extra: r['extra'],
      shared: r['shared'],
    },
    rasterInnerTable,
    dataPath,
  );
  const props: Array<[string, GdValue]> = [];
  for (let i = 0; i < at; i++) props.push(imageProps[i]);
  props.push(['data', inner]);
  for (let i = at; i < imageProps.length; i++) props.push(imageProps[i]);
  return new GdObject('Image', props);
}

const rootTable: FieldDef[] = [
  f('version', readVersion, writeVersion),
  f('map_width', readReal, writeReal),
  f('map_height', readReal, writeReal),
  f('water_level', readReal, writeReal),
  f('water_flip_x', readBool, writeBool),
  f('water_flip_y', readBool, writeBool),
  f('water_offset', readVec2, writeVec2),
  f('water_stain', readReal, writeReal),
  f('windroses', (v, p) => readArray(v, p, WD_LIMITS.maxListLength),
    (m, p) => writeRawArray(m, p, WD_LIMITS.maxListLength)),
  f('theme', (v, p) => readRecord(requireDict(v, p), themeTable, p) as unknown as WdTheme,
    (m, p) => writeRecord(m, themeTable, p)),
  f('layers', (v, p) => readRecord(requireDict(v, p), layersTable, p) as unknown as WdLayers,
    (m, p) => writeRecord(m, layersTable, p)),
  f('paths', (v, p) => readRecordList<WdPath>(v, p, pathTable, WD_LIMITS.maxPaths),
    (m, p) => writeRecordList(m, p, pathTable, WD_LIMITS.maxPaths)),
  f('territories', (v, p) => readRecord(requireDict(v, p), territoriesTable, p) as unknown as WdTerritories,
    (m, p) => writeRecord(m, territoriesTable, p)),
  f('symbols', (v, p) => readRecordList<WdSymbol>(v, p, symbolTable, WD_LIMITS.maxSymbols),
    (m, p) => writeRecordList(m, p, symbolTable, WD_LIMITS.maxSymbols)),
  f('labels', (v, p) => readRecordList<WdLabel>(v, p, labelTable, WD_LIMITS.maxLabels),
    (m, p) => writeRecordList(m, p, labelTable, WD_LIMITS.maxLabels)),
  f('sharpen_labels', readBool, writeBool),
  f('mask', readRaster, writeRaster),
  f('ground', readRaster, writeRaster),
  f('water_tint', readRaster, writeRaster),
  f('trace', (v) => v, (m) => m as GdValue),
  f('grid', (v, p) => (v === null ? null : readRecord(requireDict(v, p), gridTable, p) as unknown as WdGrid),
    (m, p) => (m === null ? null : writeRecord(m, gridTable, p))),
  f('frame', (v, p) => readRecord(requireDict(v, p), frameTable, p) as unknown as WdFrame,
    (m, p) => writeRecord(m, frameTable, p)),
  f('scale', (v, p) => (v === null ? null : readRecord(requireDict(v, p), scaleTable, p) as unknown as WdScale),
    (m, p) => (m === null ? null : writeRecord(m, scaleTable, p))),
  f('boxes', (v, p) => readArray(v, p, WD_LIMITS.maxBoxes),
    (m, p) => writeRawArray(m, p, WD_LIMITS.maxBoxes)),
  f('load_default_symbols', readBool, writeBool),
  f('load_default_not_symbols', readBool, writeBool),
  f('included_default_packs', readStringList, writeStringList),
  f('included_packs', readStringList, writeStringList),
];

export function wdMapFromGd(root: GdValue): WdMap {
  const dict = requireDict(root, '/');
  // The version is judged first, whatever the order of the keys: an unsupported version must not be masked by a
  // different error in a file this reader is not meant to understand.
  const version = dict.get('version');
  if (version === undefined) fail('MISSING', '/version', 'missing key');
  readVersion(version, '/version');
  return readRecord(dict, rootTable, '/') as unknown as WdMap;
}

export function wdMapToGd(map: WdMap): GdDict {
  return writeRecord(map as unknown, rootTable, '/');
}
