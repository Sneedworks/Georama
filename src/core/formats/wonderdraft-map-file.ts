// Whole Wonderdraft map files: GCPF container in and out around the schema model.
// readWdMap decodes the container, rejects a bad footer without silent loss, then
// decodes the Variant payload into the typed model. writeWdMap reverses the trip
// with the default GCPF block size. validateWdMap is a pure issue list over the
// invariants V1..V8 named below; it never throws.
import { decodeGcpf, encodeGcpf } from './gcpf.ts';
import { decodeStoreVar, encodeStoreVar } from './godot-var.ts';
import { WD_LIMITS, WdSchemaError, wdMapFromGd, wdMapToGd } from './wonderdraft-map.ts';
import type { WdMap } from './wonderdraft-map.ts';

export interface WdIssue {
  path: string;
  message: string;
}

export function readWdMap(file: Uint8Array): WdMap {
  const decoded = decodeGcpf(file);
  // A normal corpus file carries exactly the 4-byte footer and nothing after it;
  // the writer below always emits that standard footer, so anything else is refused
  // here rather than silently dropped on the way back out.
  if (!decoded.footerOk || decoded.trailingBytes !== 4) {
    throw new WdSchemaError('FORMAT', '/', 'invalid GCPF footer or trailing bytes');
  }
  return wdMapFromGd(decodeStoreVar(decoded.payload));
}

export function writeWdMap(map: WdMap): Uint8Array {
  return encodeGcpf(encodeStoreVar(wdMapToGd(map)));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkReal(v: unknown, path: string, issues: WdIssue[], what: string): void {
  if (!isFiniteNumber(v)) issues.push({ path, message: `${what} must be a finite number` });
}

function checkVec2(v: unknown, path: string, issues: WdIssue[], what: string): void {
  if (!isRecord(v) || !isFiniteNumber(v['x']) || !isFiniteNumber(v['y'])) {
    issues.push({ path, message: `${what} must hold finite x and y` });
  }
}

function checkRgba(v: unknown, path: string, issues: WdIssue[], what: string): void {
  if (
    !isRecord(v) || !isFiniteNumber(v['r']) || !isFiniteNumber(v['g']) ||
    !isFiniteNumber(v['b']) || !isFiniteNumber(v['a'])
  ) {
    issues.push({ path, message: `${what} must hold finite r, g, b and a` });
  }
}

function checkRgbaList(v: unknown, path: string, issues: WdIssue[], what: string): void {
  if (!Array.isArray(v)) return;
  for (let i = 0; i < v.length; i++) checkRgba(v[i], `${path}[${i}]`, issues, what);
}

// One issue per offending field, never per component. mapWidth, mapHeight and
// waterLevel are covered by V1/V2 and are skipped here so a single bad value
// reports a single invariant.
function checkTheme(v: unknown, issues: WdIssue[]): void {
  if (!isRecord(v)) return;
  checkReal(v['waterHue'], '/theme/waterHue', issues, 'waterHue');
  checkReal(v['waterSaturation'], '/theme/waterSaturation', issues, 'waterSaturation');
  checkReal(v['waterValue'], '/theme/waterValue', issues, 'waterValue');
  checkReal(v['vignetteStrength'], '/theme/vignetteStrength', issues, 'vignetteStrength');
  checkReal(v['coastalFxDistance'], '/theme/coastalFxDistance', issues, 'coastalFxDistance');
  checkReal(v['landmassOutlineBlend'], '/theme/landmassOutlineBlend', issues, 'landmassOutlineBlend');
  checkRgba(v['coastlineColor'], '/theme/coastlineColor', issues, 'coastlineColor');
  checkRgba(v['landmassOutlineColor'], '/theme/landmassOutlineColor', issues, 'landmassOutlineColor');
  checkRgba(v['freshwaterColor'], '/theme/freshwaterColor', issues, 'freshwaterColor');
  checkRgba(v['freshwaterOutlineColor'], '/theme/freshwaterOutlineColor', issues, 'freshwaterOutlineColor');
  checkRgba(v['pathColor'], '/theme/pathColor', issues, 'pathColor');
  checkRgba(v['windroseColor'], '/theme/windroseColor', issues, 'windroseColor');
  checkRgbaList(v['groundColors'], '/theme/groundColors', issues, 'groundColors entry');
  checkRgbaList(v['waterColors'], '/theme/waterColors', issues, 'waterColors entry');
  checkRgbaList(v['symbolCustomColors'], '/theme/symbolCustomColors', issues, 'symbolCustomColors entry');
}

function checkFrame(v: unknown, issues: WdIssue[]): void {
  if (!isRecord(v)) return;
  checkReal(v['size'], '/frame/size', issues, 'frame size');
  checkRgba(v['tint'], '/frame/tint', issues, 'frame tint');
}

function checkGrid(v: unknown, issues: WdIssue[]): void {
  if (v === null || v === undefined) return;
  if (!isRecord(v)) return;
  checkReal(v['size'], '/grid/size', issues, 'grid size');
  checkReal(v['lineWidth'], '/grid/lineWidth', issues, 'grid lineWidth');
  checkRgba(v['color'], '/grid/color', issues, 'grid color');
  checkVec2(v['offset'], '/grid/offset', issues, 'grid offset');
}

function checkScale(v: unknown, issues: WdIssue[]): void {
  if (v === null || v === undefined) return;
  if (!isRecord(v)) return;
  checkVec2(v['position'], '/scale/position', issues, 'scale position');
  checkReal(v['rotation'], '/scale/rotation', issues, 'scale rotation');
  checkRgbaList(v['colors'], '/scale/colors', issues, 'scale colors entry');
  checkVec2(v['size'], '/scale/size', issues, 'scale size');
  checkReal(v['segments'], '/scale/segments', issues, 'scale segments');
  checkReal(v['lineWidth'], '/scale/lineWidth', issues, 'scale lineWidth');
  checkReal(v['segmentDistance'], '/scale/segmentDistance', issues, 'scale segmentDistance');
  checkReal(v['fontSize'], '/scale/fontSize', issues, 'scale fontSize');
  checkReal(v['outlineWidth'], '/scale/outlineWidth', issues, 'scale outlineWidth');
  checkRgba(v['fontColor'], '/scale/fontColor', issues, 'scale fontColor');
  checkRgba(v['outlineColor'], '/scale/outlineColor', issues, 'scale outlineColor');
}

function checkNonNegative(v: unknown, path: string, issues: WdIssue[], what: string): void {
  if (typeof v === 'number' && v < 0) issues.push({ path, message: `${what} must be non-negative` });
}

function checkPath(item: unknown, index: number, issues: WdIssue[]): void {
  if (!isRecord(item)) return;
  const base = `/paths[${index}]`;
  checkVec2(item['position'], `${base}/position`, issues, 'path position');
  checkRgba(item['color'], `${base}/color`, issues, 'path color');
  checkReal(item['width'], `${base}/width`, issues, 'path width');
  checkReal(item['roughness'], `${base}/roughness`, issues, 'path roughness');
  checkNonNegative(item['width'], `${base}/width`, issues, 'path width');
}

function checkTerritory(item: unknown, index: number, issues: WdIssue[]): void {
  if (!isRecord(item)) return;
  const base = `/territories/territories[${index}]`;
  checkVec2(item['position'], `${base}/position`, issues, 'territory position');
  checkReal(item['smoothing'], `${base}/smoothing`, issues, 'territory smoothing');
  checkRgba(item['color'], `${base}/color`, issues, 'territory color');
  checkReal(item['opacity'], `${base}/opacity`, issues, 'territory opacity');
  checkReal(item['width'], `${base}/width`, issues, 'territory width');
  checkNonNegative(item['width'], `${base}/width`, issues, 'territory width');
}

function checkSymbol(item: unknown, index: number, issues: WdIssue[]): void {
  if (!isRecord(item)) return;
  const base = `/symbols[${index}]`;
  checkVec2(item['position'], `${base}/position`, issues, 'symbol position');
  checkReal(item['rotation'], `${base}/rotation`, issues, 'symbol rotation');
  checkVec2(item['scale'], `${base}/scale`, issues, 'symbol scale');
  checkVec2(item['offset'], `${base}/offset`, issues, 'symbol offset');
  checkReal(item['radius'], `${base}/radius`, issues, 'symbol radius');
  checkNonNegative(item['radius'], `${base}/radius`, issues, 'symbol radius');
  const sample = item['sample'];
  if (sample !== null && sample !== undefined) checkRgba(sample, `${base}/sample`, issues, 'symbol sample');
  const custom = item['customColors'];
  if (custom !== null && custom !== undefined) checkRgbaList(custom, `${base}/customColors`, issues, 'symbol customColors entry');
}

function checkLabel(item: unknown, index: number, issues: WdIssue[]): void {
  if (!isRecord(item)) return;
  const base = `/labels[${index}]`;
  checkVec2(item['position'], `${base}/position`, issues, 'label position');
  checkReal(item['rotation'], `${base}/rotation`, issues, 'label rotation');
  checkRgba(item['color'], `${base}/color`, issues, 'label color');
  checkRgba(item['outlineColor'], `${base}/outlineColor`, issues, 'label outlineColor');
  const glow = item['glowSize'];
  if (typeof glow === 'number' && !Number.isFinite(glow)) {
    issues.push({ path: `${base}/glowSize`, message: 'label glowSize must be a finite number' });
  }
  checkRgba(item['glowColor'], `${base}/glowColor`, issues, 'label glowColor');
  checkReal(item['curve'], `${base}/curve`, issues, 'label curve');
  checkNonNegative(item['size'], `${base}/size`, issues, 'label size');
}

// An over-limit list reports V8 only; its elements are not walked.
function checkList(
  v: unknown, path: string, limit: number, what: string, issues: WdIssue[],
  each: (item: unknown, index: number) => void,
): void {
  if (!Array.isArray(v)) return;
  if (v.length > limit) {
    issues.push({ path, message: `${what} count ${v.length} exceeds the limit ${limit}` });
    return;
  }
  for (let i = 0; i < v.length; i++) each(v[i], i);
}

function checkRaster(map: Record<string, unknown>, name: string, issues: WdIssue[]): void {
  const v = map[name];
  if (!isRecord(v)) return;
  const width = v['width'];
  const height = v['height'];
  const data = v['data'];
  if (typeof width === 'number' && typeof height === 'number' && data instanceof Uint8Array) {
    if (data.length !== width * height * 4) {
      issues.push({ path: `/${name}/data`, message: `${name} data length must equal width * height * 4` });
    }
  }
}

function validate(map: WdMap, issues: WdIssue[]): void {
  const m = map as unknown as Record<string, unknown>;
  // V1.
  const mapWidth = m['mapWidth'];
  const mapWidthValid = isFiniteNumber(mapWidth) && mapWidth > 0;
  if (!mapWidthValid) {
    issues.push({ path: '/mapWidth', message: 'mapWidth must be finite and greater than 0' });
  }
  const mapHeight = m['mapHeight'];
  const mapHeightValid = isFiniteNumber(mapHeight) && mapHeight > 0;
  if (!mapHeightValid) {
    issues.push({ path: '/mapHeight', message: 'mapHeight must be finite and greater than 0' });
  }
  // V2.
  const waterLevel = m['waterLevel'];
  if (!isFiniteNumber(waterLevel) || waterLevel < 0 || waterLevel > 1) {
    issues.push({ path: '/waterLevel', message: 'waterLevel must be finite and within [0, 1]' });
  }
  // V3: every other Real field plus every Vec2 and Rgba.
  checkReal(m['waterStain'], '/waterStain', issues, 'waterStain');
  checkVec2(m['waterOffset'], '/waterOffset', issues, 'waterOffset');
  checkTheme(m['theme'], issues);
  checkFrame(m['frame'], issues);
  checkGrid(m['grid'], issues);
  checkScale(m['scale'], issues);
  checkList(m['paths'], '/paths', WD_LIMITS.maxPaths, 'paths', issues, (item, i) => checkPath(item, i, issues));
  const territories = m['territories'];
  checkList(
    isRecord(territories) ? territories['territories'] : undefined,
    '/territories/territories', WD_LIMITS.maxTerritories, 'territories', issues,
    (item, i) => checkTerritory(item, i, issues),
  );
  checkList(m['symbols'], '/symbols', WD_LIMITS.maxSymbols, 'symbols', issues, (item, i) => checkSymbol(item, i, issues));
  checkList(m['labels'], '/labels', WD_LIMITS.maxLabels, 'labels', issues, (item, i) => checkLabel(item, i, issues));
  // V4 for the record kinds without a Real-field walker above is covered inside
  // the walkers; nothing further to add.
  // V5.
  checkRaster(m, 'mask', issues);
  checkRaster(m, 'ground', issues);
  checkRaster(m, 'waterTint', issues);
  // V6: mask and ground match the map size whenever the map size is integral.
  // waterTint dimensions are not checked: 2 of the 57 corpus maps differ there.
  // A size that already failed V1 is not compared against: that comparison only
  // repeats the same bad value once per raster.
  if (mapWidthValid && mapHeightValid && Number.isInteger(mapWidth) && Number.isInteger(mapHeight)) {
    for (const name of ['mask', 'ground']) {
      const v = m[name];
      if (isRecord(v) && typeof v['width'] === 'number' && typeof v['height'] === 'number') {
        if (v['width'] !== mapWidth || v['height'] !== mapHeight) {
          issues.push({ path: `/${name}`, message: `${name} dimensions must equal mapWidth x mapHeight` });
        }
      }
    }
  }
  // V7.
  const layers = m['layers'];
  if (isRecord(layers) && Array.isArray(layers['names']) && Array.isArray(layers['visibility']) && Array.isArray(layers['lock'])) {
    const names = layers['names'] as unknown[];
    const visibility = layers['visibility'] as unknown[];
    const lock = layers['lock'] as unknown[];
    if (names.length !== visibility.length || names.length !== lock.length) {
      issues.push({ path: '/layers', message: 'layers names, visibility and lock must have equal length' });
    }
  }
  // V8: over-limit lists already reported by checkList; boxes is raw but bounded.
  const boxes = m['boxes'];
  if (Array.isArray(boxes) && boxes.length > WD_LIMITS.maxBoxes) {
    issues.push({ path: '/boxes', message: `boxes count ${boxes.length} exceeds the limit ${WD_LIMITS.maxBoxes}` });
  }
}

export function validateWdMap(map: WdMap): WdIssue[] {
  const issues: WdIssue[] = [];
  try {
    if (!isRecord(map)) {
      return [{ path: '/', message: 'map must be an object' }];
    }
    validate(map, issues);
  } catch {
    issues.push({ path: '/', message: 'validator met a value it could not check' });
  }
  return issues;
}
