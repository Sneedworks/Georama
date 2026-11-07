// Card 1.8f, step 5b (GREEN): the frame plan for the label pass, detail v17 section 3 with v18 and v19
// (v19 review PASS, deleg_039967fe, at 29bcc72). Pure: no DOM, no GL. The core sees numbers only; the renderer
// supplies the metrics and the anchors in window pixels. Reuses placeFrame, packAtlas, labelLayout and the quads
// helpers unchanged.
import { type AtlasItem, type AtlasPlacement, packAtlas } from '../symbols/atlas.ts';
import { atlasKey, type GlyphPart, glyphItems, roundedPixelSize } from './atlas.ts';
import { type FrameDrop, type FrameLabel, placeFrame } from './frame.ts';
import { type LabelLayout, labelLayout } from './layout.ts';
import {
  fillSpriteLayout,
  type GlyphQuad,
  glyphQuad,
  outlinePad,
  outlineSpriteLayout,
  type SpriteBox,
  type SpriteOrigin,
} from './quads.ts';

export type Rgba = readonly [number, number, number, number];

// Label fields (v17 section 3). anchor is in window pixels; rotation in degrees; colour channels in 0 to 1.
export interface PlanLabel {
  readonly id: string;
  readonly text: string;
  readonly anchor: Readonly<{ x: number; y: number }>;
  readonly rotation: number;
  readonly size: number;
  readonly curve: number;
  readonly extraSpacingChar: number;
  readonly familyKey: string;
  readonly outlineSize: number;
  readonly outlineColour: string;
  readonly colour: Rgba;
}

// One glyph's metrics at an integer px, from the renderer's canvas (v17 section 3).
export interface PlanMetric {
  readonly advance: number;
  readonly ascent: number;
  readonly descent: number;
}
export type PlanMeasure = (codePoint: number, px: number, familyKey: string) => PlanMetric;

// The page options. pageSide is the packer's pageSize (maxSide) and must be the same for every frame of a pass.
export interface PlanOptions {
  readonly scale: number;
  readonly pageSide: number;
  readonly maxPages: number;
  readonly padding: number;
}

// A sprite record. The key determines the raster and the box (v19 section 2): family, px, pad, outline colour,
// code point and part.
export type GlyphRecord = Readonly<{
  key: string;
  codePoint: number;
  part: GlyphPart;
  familyKey: string;
  px: number;
  pad: number;
  outlineColour: string;
  box: SpriteBox;
  origin: SpriteOrigin;
}>;

// The state carried between frames (v17 section 3). Options are the same for every call of a pass (v19 section 5).
export interface PlanPrevious {
  readonly resident: readonly AtlasItem[];
  readonly placements: readonly AtlasPlacement[];
  readonly records: ReadonlyMap<string, GlyphRecord>;
}

export type SkipMode = 'empty' | 'invalid';
export type SkipReason = 'empty' | 'invalid' | 'non-positive-advance' | 'bad-metric';
export interface PlanSkip {
  readonly id: string;
  readonly mode: SkipMode;
  readonly reason: SkipReason;
}
export interface PlanFallback {
  readonly id: string;
  readonly reason: 'LIMIT' | 'FIT';
}

// Same fields as DrawQuad in src/renderer/render/labels/program.ts (v19 section 7).
export interface PlanQuad {
  readonly page: number;
  readonly corners: GlyphQuad['corners'];
  readonly uvs: GlyphQuad['uvs'];
  readonly colour: Rgba;
}

export interface LabelFramePlan {
  readonly drawn: readonly string[];
  readonly skipped: readonly PlanSkip[];
  readonly dropped: readonly FrameDrop[];
  readonly fallback: readonly PlanFallback[];
  readonly joined: readonly string[];
  readonly cleared: boolean;
  readonly packings: number;
  readonly resident: readonly AtlasItem[];
  readonly pageSide: number;
  readonly pages: number;
  readonly placements: readonly AtlasPlacement[];
  readonly placementsChanged: boolean;
  readonly records: ReadonlyMap<string, GlyphRecord>;
  readonly quads: readonly PlanQuad[];
}

// v18 section 1: each line feed becomes one space; nothing is trimmed or dropped.
export function joinLineBreaks(text: string): string {
  return text.split('\n').join(' ');
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkOptions(o: PlanOptions): void {
  if (!o || !isFiniteNumber(o.scale) || o.scale <= 0) {
    throw new RangeError('planLabelFrame: scale must be finite and above 0');
  }
  if (!Number.isInteger(o.pageSide) || o.pageSide < 32 || o.pageSide > 16384) {
    throw new RangeError('planLabelFrame: pageSide must be an integer from 32 to 16384');
  }
  if (!Number.isInteger(o.maxPages) || o.maxPages < 1) {
    throw new RangeError('planLabelFrame: maxPages must be an integer of 1 or more');
  }
  if (!Number.isInteger(o.padding) || o.padding < 0) {
    throw new RangeError('planLabelFrame: padding must be an integer of 0 or more');
  }
}

function checkPrevious(p: PlanPrevious): void {
  if (!p || !Array.isArray(p.resident) || !Array.isArray(p.placements) || !(p.records instanceof Map)) {
    throw new TypeError('planLabelFrame: previous must hold resident and placements arrays and a records Map');
  }
}

function checkUniqueIds(labels: readonly PlanLabel[]): void {
  const seen = new Set<string>();
  for (const l of labels) {
    if (seen.has(l.id)) throw new RangeError('planLabelFrame: label ids must be unique');
    seen.add(l.id);
  }
}

// v19 section 3: label fields are checked first, in one place.
function fieldsValid(l: PlanLabel): boolean {
  return (
    typeof l.text === 'string' &&
    typeof l.anchor === 'object' &&
    l.anchor !== null &&
    isFiniteNumber(l.anchor.x) &&
    isFiniteNumber(l.anchor.y) &&
    isFiniteNumber(l.rotation) &&
    isFiniteNumber(l.curve) &&
    isFiniteNumber(l.size) &&
    isFiniteNumber(l.extraSpacingChar) &&
    l.size > 0 &&
    l.extraSpacingChar >= 0 &&
    isFiniteNumber(l.outlineSize) &&
    l.outlineSize >= 0 &&
    typeof l.familyKey === 'string' &&
    l.familyKey.length > 0 &&
    typeof l.outlineColour === 'string' &&
    l.outlineColour.length > 0 &&
    Array.isArray(l.colour) &&
    l.colour.length === 4 &&
    l.colour.every(isFiniteNumber)
  );
}

// v18 section 2: an advance must be finite and above 0; a metric must give a box of at least 1 pixel.
const advanceOk = (m: PlanMetric): boolean => isFiniteNumber(m.advance) && m.advance > 0;
const metricOk = (m: PlanMetric): boolean =>
  isFiniteNumber(m.ascent) &&
  isFiniteNumber(m.descent) &&
  m.ascent >= 0 &&
  m.descent >= 0 &&
  Math.ceil(m.ascent) + Math.ceil(m.descent) >= 1;

function samePlacements(a: readonly AtlasPlacement[], b: readonly AtlasPlacement[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.key !== y.key || x.page !== y.page || x.x !== y.x || x.y !== y.y || x.width !== y.width || x.height !== y.height) {
      return false;
    }
  }
  return true;
}

interface LabelMeta {
  readonly layout: LabelLayout;
  readonly codePoints: readonly number[];
  readonly px: number;
  readonly pad: number;
}

export function planLabelFrame(
  labels: readonly PlanLabel[],
  measure: PlanMeasure,
  options: PlanOptions,
  previous: PlanPrevious,
): LabelFramePlan {
  checkOptions(options);
  checkPrevious(previous);
  checkUniqueIds(labels);

  const metricCache = new Map<string, PlanMetric>();
  const metricAt = (codePoint: number, px: number, familyKey: string): PlanMetric => {
    const k = `${familyKey}\u0000${px}\u0000${codePoint}`;
    let m = metricCache.get(k);
    if (m === undefined) {
      m = measure(codePoint, px, familyKey);
      metricCache.set(k, m);
    }
    return m;
  };

  const records = new Map<string, GlyphRecord>(previous.records);
  const skipped: PlanSkip[] = [];
  const frame: FrameLabel[] = [];
  const meta = new Map<string, LabelMeta>();
  const joined: string[] = [];
  for (const l of labels) {
    if (typeof l.text === 'string' && l.text.includes('\n')) joined.push(l.id);
  }

  for (const l of labels) {
    if (!fieldsValid(l)) {
      skipped.push({ id: l.id, mode: 'invalid', reason: 'invalid' });
      continue;
    }
    if (l.text.length === 0) {
      skipped.push({ id: l.id, mode: 'empty', reason: 'empty' });
      continue;
    }
    const text = joinLineBreaks(l.text);
    const px = roundedPixelSize(l.size, options.scale);
    const codePoints: number[] = [];
    for (const ch of text) codePoints.push(ch.codePointAt(0) as number);
    const metrics = codePoints.map((c) => metricAt(c, px, l.familyKey));
    if (!metrics.every(advanceOk)) {
      skipped.push({ id: l.id, mode: 'invalid', reason: 'non-positive-advance' });
      continue;
    }
    if (!metrics.every(metricOk)) {
      skipped.push({ id: l.id, mode: 'invalid', reason: 'bad-metric' });
      continue;
    }
    const layout = labelLayout(
      { position: l.anchor, rotation: l.rotation, size: l.size, curve: l.curve, extraSpacingChar: l.extraSpacingChar },
      metrics.map((m) => m.advance),
      { scale: options.scale },
    );
    if (layout.mode === 'invalid') {
      skipped.push({ id: l.id, mode: 'invalid', reason: 'invalid' });
      continue;
    }
    if (layout.mode === 'empty') {
      skipped.push({ id: l.id, mode: 'empty', reason: 'empty' });
      continue;
    }
    // v19 section 2: the second key field is the pad, so a key determines its raster.
    const pad = l.outlineSize > 0 ? outlinePad(l.outlineSize, options.scale) : 0;
    const byCodePoint = new Map<number, PlanMetric>();
    codePoints.forEach((c, i) => byCodePoint.set(c, metrics[i]));
    const items = glyphItems(
      text,
      { familyKey: l.familyKey, px, outlineSize: pad, outlineColour: l.outlineColour },
      (c, part) => {
        const m = byCodePoint.get(c) as PlanMetric;
        const fill = fillSpriteLayout(m.advance, m.ascent, m.descent);
        const sprite = part === 'fill' ? fill : outlineSpriteLayout(fill, pad);
        const key = atlasKey(l.familyKey, px, pad, l.outlineColour, c, part);
        records.set(key, {
          key,
          codePoint: c,
          part,
          familyKey: l.familyKey,
          px,
          pad,
          outlineColour: l.outlineColour,
          box: sprite.box,
          origin: sprite.origin,
        });
        return sprite.box;
      },
    );
    frame.push({ id: l.id, items });
    meta.set(l.id, { layout, codePoints, px, pad });
  }

  const result = placeFrame(frame, previous.resident, {
    maxSide: options.pageSide,
    maxPages: options.maxPages,
    padding: options.padding,
  });

  let pages = 0;
  let placements: readonly AtlasPlacement[] = [];
  if (result.resident.length > 0) {
    const verdict = packAtlas(result.resident, {
      maxSide: options.pageSide,
      maxPages: options.maxPages,
      padding: options.padding,
    });
    if (!verdict.ok) throw new Error(`planLabelFrame: ${verdict.message}`);
    pages = verdict.pages;
    placements = verdict.placements;
  }
  const placementsChanged = result.cleared || !samePlacements(placements, previous.placements);
  const placementByKey = new Map<string, AtlasPlacement>(placements.map((p) => [p.key, p]));
  const drawnIds = new Set(result.drawn);

  const fallback: PlanFallback[] = [];
  for (const l of labels) {
    if (!drawnIds.has(l.id)) continue;
    const m = meta.get(l.id) as LabelMeta;
    if (m.layout.mode === 'fallback' && m.layout.reason !== undefined) {
      fallback.push({ id: l.id, reason: m.layout.reason });
    }
  }

  const quadFor = (l: PlanLabel, m: LabelMeta, i: number, part: GlyphPart, colour: Rgba): PlanQuad => {
    const key = atlasKey(l.familyKey, m.px, m.pad, l.outlineColour, m.codePoints[i], part);
    const rec = records.get(key);
    const at = placementByKey.get(key);
    const p = m.layout.placements[i];
    if (rec === undefined || at === undefined || p === undefined) {
      throw new Error('planLabelFrame: a drawn glyph has no record, atlas placement or position');
    }
    const q = glyphQuad({ x: p.x, y: p.y, angle: p.angle }, rec.box, rec.origin, at, options.pageSide);
    return { page: at.page, corners: q.corners, uvs: q.uvs, colour };
  };

  // v17 section 3(e) with v19 section 7: per drawn label in array order, outline quads first, then fill quads in glyph order.
  const quads: PlanQuad[] = [];
  for (const l of labels) {
    if (!drawnIds.has(l.id)) continue;
    const m = meta.get(l.id) as LabelMeta;
    const count = m.codePoints.length;
    if (m.pad > 0) {
      for (let i = 0; i < count; i++) quads.push(quadFor(l, m, i, 'outline', [1, 1, 1, 1]));
    }
    const colour: Rgba = [l.colour[0], l.colour[1], l.colour[2], l.colour[3]];
    for (let i = 0; i < count; i++) quads.push(quadFor(l, m, i, 'fill', colour));
  }

  return {
    drawn: result.drawn,
    skipped,
    dropped: result.dropped,
    fallback,
    joined,
    cleared: result.cleared,
    packings: result.packings,
    resident: result.resident,
    pageSide: options.pageSide,
    pages,
    placements,
    placementsChanged,
    records,
    quads,
  };
}
