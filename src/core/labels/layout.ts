// Card 1.8f, step 3 (GREEN): chord, pixel values, the straight fallback and the D4 rule (detail v9). Pure: no DOM, no environment.
// The chord is the text length (fact 15), summed in the layout's own order: advance, then spacing for every glyph after the first.
import { layoutCurvedLabel, type GlyphPlacement, type LabelLayoutResult, type LabelPoint } from '../geometry/curved-label.ts';
import { type Chord, curveToPolyline } from './curve.ts';

/** The label fields the layout reads (fact 1). rotation is in degrees (fact 8); extraSpacingChar is a map value (fact 14). */
export type LabelGeometry = Readonly<{
  position: LabelPoint;
  rotation: number;
  size: number;
  curve: number;
  extraSpacingChar: number;
}>;

export type LayoutOptions = Readonly<{ scale: number }>;
export type FallbackReason = 'LIMIT' | 'FIT';
export type LabelLayout = Readonly<{
  mode: 'curved' | 'fallback' | 'empty' | 'invalid';
  reason?: FallbackReason;
  placements: readonly GlyphPlacement[];
  chordLength: number;
  spacingPx: number;
}>;
export type D4Outcome =
  | Readonly<{ mode: 'curved' }>
  | Readonly<{ mode: 'fallback'; reason: FallbackReason }>
  | Readonly<{ mode: 'invalid' }>;

/** Pixel font size: size x scale (Design; fact 6). */
export const pixelFontSize = (size: number, scale: number): number => size * scale;

/** Pixel letter spacing: extra_spacing_char x scale (D5). */
export const spacingPixels = (extraSpacingChar: number, scale: number): number => extraSpacingChar * scale;

export function chordOf(label: LabelGeometry, advances: readonly number[], spacingPx: number): Chord {
  let length = 0;
  for (let i = 0; i < advances.length; i++) {
    length += advances[i];
    if (i > 0) length += spacingPx;
  }
  const angle = (label.rotation * Math.PI) / 180;
  const dx = (length / 2) * Math.cos(angle);
  const dy = (length / 2) * Math.sin(angle);
  return {
    start: { x: label.position.x - dx, y: label.position.y - dy },
    end: { x: label.position.x + dx, y: label.position.y + dy },
    length,
    angle,
  };
}

/** Glyph centres along the chord, with the same semantics as the curved layout (fact 2): centre at cursor + advance / 2. */
export function straightPlacements(chord: Chord, advances: readonly number[], spacingPx: number): GlyphPlacement[] {
  const out: GlyphPlacement[] = [];
  let cursor = 0;
  for (let i = 0; i < advances.length; i++) {
    const advance = advances[i];
    const distance = cursor + advance / 2;
    out.push({
      x: chord.start.x + Math.cos(chord.angle) * distance,
      y: chord.start.y + Math.sin(chord.angle) * distance,
      angle: chord.angle,
      distance,
      advance,
    });
    cursor += advance + (i < advances.length - 1 ? spacingPx : 0);
  }
  return out;
}

/** D4: LIMIT and FIT fall back to the straight chord and are reported. INPUT is invalid, which is not a D4 case (v9). */
export function applyD4(result: LabelLayoutResult): D4Outcome {
  if (result.ok) return { mode: 'curved' };
  if (result.code === 'LIMIT' || result.code === 'FIT') return { mode: 'fallback', reason: result.code };
  return { mode: 'invalid' };
}

export function labelLayout(label: LabelGeometry, advances: readonly number[], options: LayoutOptions): LabelLayout {
  const spacingPx = spacingPixels(label.extraSpacingChar, options.scale);
  if (advances.length === 0) return { mode: 'empty', placements: [], chordLength: 0, spacingPx };
  const chord = chordOf(label, advances, spacingPx);
  const result = layoutCurvedLabel({ points: curveToPolyline(chord, label.curve), advances, letterSpacing: spacingPx });
  if (result.ok) return { mode: 'curved', placements: result.placements, chordLength: chord.length, spacingPx };
  const outcome = applyD4(result);
  if (outcome.mode === 'fallback') {
    return {
      mode: 'fallback',
      reason: outcome.reason,
      placements: straightPlacements(chord, advances, spacingPx),
      chordLength: chord.length,
      spacingPx,
    };
  }
  return { mode: 'invalid', placements: [], chordLength: chord.length, spacingPx };
}
