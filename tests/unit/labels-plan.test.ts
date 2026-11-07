// Card 1.8f, step 5b (RED): the frame plan, detail v17 section 3 with v18 and v19 (v19 review PASS, deleg_039967fe, at 29bcc72).
// Pure: no DOM, no GL. Each case names the rule it checks.
import { describe, expect, it } from 'vitest';
import { atlasKey } from '../../src/core/labels/atlas.ts';
import { labelLayout } from '../../src/core/labels/layout.ts';
import { fillSpriteLayout, glyphQuad, outlinePad, outlineSpriteLayout } from '../../src/core/labels/quads.ts';
import {
  joinLineBreaks,
  type PlanLabel,
  type PlanMetric,
  type PlanOptions,
  type PlanPrevious,
  planLabelFrame,
} from '../../src/core/labels/plan.ts';

const DEFAULT: PlanMetric = { advance: 0.5, ascent: 0.8, descent: 0.2 };
const BIG: PlanMetric = { advance: 16, ascent: 12, descent: 4 };
const OUTLINE_COLOUR = 'rgba(0, 0, 0, 1)';
const COLOUR: [number, number, number, number] = [0.5, 0.25, 0.125, 1];
const opts: PlanOptions = { scale: 1, pageSide: 256, maxPages: 2, padding: 0 };
const none: PlanPrevious = { resident: [], placements: [], records: new Map() };
const cp = (ch: string): number => ch.codePointAt(0) as number;

// A fake metric per character. It ignores px and family, so the expected values below are easy to check by hand.
const metricWith =
  (over: Readonly<Record<string, PlanMetric>> = {}) =>
  (codePoint: number, _px: number, _familyKey: string): PlanMetric =>
    over[String.fromCodePoint(codePoint)] ?? DEFAULT;

const label = (over: Partial<PlanLabel> = {}): PlanLabel => ({
  id: 'L',
  text: 'AB',
  anchor: { x: 100, y: 100 },
  rotation: 0,
  size: 10,
  curve: 0,
  extraSpacingChar: 0,
  familyKey: 'f',
  outlineSize: 0,
  outlineColour: OUTLINE_COLOUR,
  colour: COLOUR,
  ...over,
});

const geometry = (over: Partial<PlanLabel> = {}) => {
  const l = label(over);
  return { position: l.anchor, rotation: l.rotation, size: l.size, curve: l.curve, extraSpacingChar: l.extraSpacingChar };
};

describe('joinLineBreaks (v18 section 1)', () => {
  it('each line feed becomes one space; nothing is trimmed or dropped', () => {
    expect(joinLineBreaks('A\nB')).toBe('A B');
    expect(joinLineBreaks('A\n')).toBe('A ');
    expect(joinLineBreaks('\nA')).toBe(' A');
    expect(joinLineBreaks('A\n\nB')).toBe('A  B');
    expect(joinLineBreaks('AB')).toBe('AB');
    expect(joinLineBreaks('\n')).toBe(' ');
  });
});

describe('planLabelFrame: text, line feeds and metrics (v18)', () => {
  it('a label with a line feed has the quads and placements of its joined text; joined lists its id', () => {
    const broken = planLabelFrame([label({ id: 'X', text: 'A\nB' })], metricWith(), opts, none);
    const flat = planLabelFrame([label({ id: 'X', text: 'A B' })], metricWith(), opts, none);
    expect(broken.quads).toEqual(flat.quads);
    expect(broken.placements).toEqual(flat.placements);
    expect(broken.joined).toEqual(['X']);
    expect(flat.joined).toEqual([]);
  });

  it('empty text is skipped with mode empty', () => {
    const plan = planLabelFrame([label({ id: 'E', text: '' })], metricWith(), opts, none);
    expect(plan.skipped).toEqual([{ id: 'E', mode: 'empty', reason: 'empty' }]);
    expect(plan.drawn).toEqual([]);
    expect(plan.quads).toEqual([]);
  });

  it('a zero advance skips its label before layout (non-positive-advance), with no quads', () => {
    const zero = metricWith({ '\u200B': { advance: 0, ascent: 0.8, descent: 0.2 } });
    const plan = planLabelFrame([label({ id: 'Z', text: 'A\u200BB' })], zero, opts, none);
    expect(plan.skipped).toEqual([{ id: 'Z', mode: 'invalid', reason: 'non-positive-advance' }]);
    expect(plan.drawn).toEqual([]);
    expect(plan.quads).toEqual([]);
  });

  it('more than 4096 glyphs with a zero advance is skipped, not a LIMIT fallback', () => {
    const zero = metricWith({ '\u200B': { advance: 0, ascent: 0.8, descent: 0.2 } });
    const plan = planLabelFrame([label({ id: 'Z', text: 'A'.repeat(4096) + '\u200B' })], zero, opts, none);
    expect(plan.skipped).toEqual([{ id: 'Z', mode: 'invalid', reason: 'non-positive-advance' }]);
    expect(plan.fallback).toEqual([]);
    expect(plan.quads).toEqual([]);
  });

  it('a NaN ascent, or a zero ascent and descent, skips its label (bad-metric)', () => {
    const bad = metricWith({
      A: { advance: 0.5, ascent: Number.NaN, descent: 0.2 },
      B: { advance: 0.5, ascent: 0, descent: 0 },
    });
    const plan = planLabelFrame([label({ id: 'N', text: 'A' }), label({ id: 'Z', text: 'B' })], bad, opts, none);
    expect(plan.skipped).toEqual([
      { id: 'N', mode: 'invalid', reason: 'bad-metric' },
      { id: 'Z', mode: 'invalid', reason: 'bad-metric' },
    ]);
    expect(plan.drawn).toEqual([]);
  });
});

describe('planLabelFrame: quads and the frame (v17 section 5)', () => {
  it('a two-glyph label gives two fill quads in glyph order, each equal to glyphQuad', () => {
    const plan = planLabelFrame([label({ text: 'AB' })], metricWith(), opts, none);
    expect(plan.drawn).toEqual(['L']);
    expect(plan.quads).toHaveLength(2);
    const lay = labelLayout(geometry(), [0.5, 0.5], { scale: 1 });
    const fill = fillSpriteLayout(0.5, 0.8, 0.2);
    const atlasOf = (ch: string) => {
      const at = plan.placements.find((p) => p.key === atlasKey('f', 10, 0, OUTLINE_COLOUR, cp(ch), 'fill'));
      if (!at) throw new Error(`no placement for ${ch}`);
      return at;
    };
    const expected = (i: number, ch: string) => {
      const at = atlasOf(ch);
      const q = glyphQuad(lay.placements[i], fill.box, fill.origin, at, plan.pageSide);
      return { page: at.page, corners: q.corners, uvs: q.uvs, colour: COLOUR };
    };
    expect(plan.quads[0]).toEqual(expected(0, 'A'));
    expect(plan.quads[1]).toEqual(expected(1, 'B'));
  });

  it('outline quads come first; the outline box is the fill box grown by pad', () => {
    const plan = planLabelFrame([label({ text: 'A', outlineSize: 1 })], metricWith(), opts, none);
    expect(plan.quads).toHaveLength(2);
    const pad = outlinePad(1, 1);
    expect(pad).toBe(1);
    const fill = fillSpriteLayout(0.5, 0.8, 0.2);
    const outline = outlineSpriteLayout(fill, pad);
    expect(outline.box).toEqual({ width: 3, height: 4 });
    const lay = labelLayout(geometry(), [0.5], { scale: 1 });
    const atlasAt = (part: 'fill' | 'outline') => {
      const at = plan.placements.find((p) => p.key === atlasKey('f', 10, pad, OUTLINE_COLOUR, cp('A'), part));
      if (!at) throw new Error(`no placement for ${part}`);
      return at;
    };
    const oq = glyphQuad(lay.placements[0], outline.box, outline.origin, atlasAt('outline'), plan.pageSide);
    const fq = glyphQuad(lay.placements[0], fill.box, fill.origin, atlasAt('fill'), plan.pageSide);
    expect(plan.quads[0]).toEqual({ page: atlasAt('outline').page, corners: oq.corners, uvs: oq.uvs, colour: [1, 1, 1, 1] });
    expect(plan.quads[1]).toEqual({ page: atlasAt('fill').page, corners: fq.corners, uvs: fq.uvs, colour: COLOUR });
  });

  it('an oversize glyph drops its label whole, with no quads; the rest is drawn', () => {
    const plan = planLabelFrame(
      [label({ id: 'W', text: 'W' }), label({ id: 'A', text: 'A' })],
      metricWith({ W: { advance: 40, ascent: 0.8, descent: 0.2 } }),
      { ...opts, pageSide: 32 },
      none,
    );
    expect(plan.dropped).toEqual([{ id: 'W', reason: 'oversize' }]);
    expect(plan.drawn).toEqual(['A']);
    expect(plan.quads).toHaveLength(1);
  });

  it('a frame that overflows the resident set clears it and is packed alone', () => {
    const resident = Array.from({ length: 12 }, (_, i) => ({ key: `R${String(i).padStart(2, '0')}`, width: 16, height: 16 }));
    const plan = planLabelFrame(
      [label({ id: 'L', text: 'ABCD' })],
      metricWith({ A: BIG, B: BIG, C: BIG, D: BIG }),
      { scale: 1, pageSide: 64, maxPages: 1, padding: 0 },
      { resident, placements: [], records: new Map() },
    );
    const keys = ['A', 'B', 'C', 'D'].map((ch) => atlasKey('f', 10, 0, OUTLINE_COLOUR, cp(ch), 'fill')).sort();
    expect(plan.cleared).toBe(true);
    expect(plan.drawn).toEqual(['L']);
    expect(plan.dropped).toEqual([]);
    expect(plan.resident.map((i) => i.key)).toEqual(keys);
    expect(plan.placementsChanged).toBe(true);
    expect(plan.quads).toHaveLength(4);
  });

  it('the same input with the first result as previous gives placementsChanged false', () => {
    const labels = [label({ id: 'A', text: 'AB' })];
    const first = planLabelFrame(labels, metricWith(), opts, none);
    const second = planLabelFrame(labels, metricWith(), opts, {
      resident: first.resident,
      placements: first.placements,
      records: first.records,
    });
    expect(second.placementsChanged).toBe(false);
    expect(second.cleared).toBe(false);
    expect(second.quads).toEqual(first.quads);
  });
});

describe('planLabelFrame: fallback, outline identity, input rules, options (v19)', () => {
  it('T8: a label past the curved layout limit is drawn straight and reported as fallback LIMIT', () => {
    const plan = planLabelFrame([label({ id: 'F', text: 'A'.repeat(4097) })], metricWith(), opts, none);
    expect(plan.drawn).toEqual(['F']);
    expect(plan.fallback).toEqual([{ id: 'F', reason: 'LIMIT' }]);
    expect(plan.quads).toHaveLength(4097);
  });

  it('T9: a change of scale that keeps px but changes the outline pad gives a new outline raster and box', () => {
    const wide = metricWith({ A: { advance: 1, ascent: 8, descent: 2 } });
    const lab = label({ id: 'O', text: 'A', outlineSize: 1 });
    const first = planLabelFrame([lab], wide, { ...opts, scale: 1 }, none);
    // px is round(10 x 1.04) = 10, as at scale 1; the pad is ceil(1 x 1.04) = 2, not 1.
    const second = planLabelFrame([lab], wide, { ...opts, scale: 1.04 }, {
      resident: first.resident,
      placements: first.placements,
      records: first.records,
    });
    const width = (q: { corners: readonly { x: number }[] }) => q.corners[1].x - q.corners[0].x;
    expect(first.quads).toHaveLength(2);
    expect(width(first.quads[0]) - width(first.quads[1])).toBe(2);
    expect(second.quads).toHaveLength(2);
    expect(width(second.quads[0]) - width(second.quads[1])).toBe(4);
    expect(second.placementsChanged).toBe(true);
    expect(second.records.has(atlasKey('f', 10, 2, OUTLINE_COLOUR, cp('A'), 'outline'))).toBe(true);
  });

  it('T10: label fields are checked first, so bad fields are invalid even when the text is empty', () => {
    const plan = planLabelFrame(
      [
        label({ id: 'L1', text: 'A', anchor: { x: Number.NaN, y: 100 } }),
        label({ id: 'L2', text: 'A', size: 0 }),
        label({ id: 'L3', text: '', rotation: Number.NaN }),
        label({ id: 'L4', text: 'A', extraSpacingChar: -1 }),
      ],
      metricWith(),
      opts,
      none,
    );
    expect(plan.skipped).toEqual([
      { id: 'L1', mode: 'invalid', reason: 'invalid' },
      { id: 'L2', mode: 'invalid', reason: 'invalid' },
      { id: 'L3', mode: 'invalid', reason: 'invalid' },
      { id: 'L4', mode: 'invalid', reason: 'invalid' },
    ]);
    expect(plan.drawn).toEqual([]);
  });

  it('T11: caller errors throw: scale 0, pageSide 31 and duplicate ids (RangeError); a records value that is not a Map (TypeError)', () => {
    expect(() => planLabelFrame([], metricWith(), { ...opts, scale: 0 }, none)).toThrow(RangeError);
    expect(() => planLabelFrame([], metricWith(), { ...opts, pageSide: 31 }, none)).toThrow(RangeError);
    expect(() => planLabelFrame([label({ id: 'D' }), label({ id: 'D' })], metricWith(), opts, none)).toThrow(RangeError);
    const bad = { resident: [], placements: [], records: {} } as unknown as PlanPrevious;
    expect(() => planLabelFrame([], metricWith(), opts, bad)).toThrow(TypeError);
  });
});
