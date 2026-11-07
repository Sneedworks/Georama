// Card 1.9, GREEN (core): scale bar rectangles and their number labels. Detail v2 section 12.2 (scale) and 12.5.
// Pure: no DOM, no GL. The numbers come from the record (segment distance and count), not from layoutScaleBar (D3).
import type { WdScale } from '../formats/wonderdraft-map.ts';
import type { PlanLabel } from '../labels/plan.ts';
import { type ElementOutcome, type ElementReport, type ElementView, validView } from './grid.ts';
import { clipRect, colourOf, type Rect, type RectColour, spanOfEdges } from './rects.ts';

export interface ScaleLabel {
  readonly id: string;
  readonly text: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly fontSize: number;
  readonly colour: RectColour;
  readonly outlineSize: number;
  readonly outlineColour: string;
}

export interface ScaleOutcome extends ElementOutcome {
  readonly labels: readonly ScaleLabel[];
}

function refuse(code: ElementReport['code']): ScaleOutcome {
  return { rects: [], labels: [], reports: [{ element: 'scale', code }] };
}

function isPositive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

/** Scale bar segments and boundary labels (detail 12.2). The checks run in order; the first failure refuses. */
export function scaleRects(scale: WdScale, view: ElementView): ScaleOutcome {
  if (!validView(view)) return refuse('INPUT');
  const n = scale.segments;
  if (!Number.isInteger(n) || n < 1 || n > 32) return refuse('segments');
  if (!isPositive(scale.segmentDistance)) return refuse('distance');
  if (scale.rotation !== 0) return refuse('rotation');
  if (scale.colors.length < 2) return refuse('colours');
  if (!isPositive(scale.size.x) || !isPositive(scale.size.y) || !isPositive(scale.fontSize)) return refuse('size');

  const s = view.scale;
  const x0 = scale.position.x * s + view.offsetX;
  const y0 = scale.position.y * s + view.offsetY;
  const W = scale.size.x * s;
  const H = scale.size.y * s;

  const bar = spanOfEdges(y0, y0 + H);
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const across = spanOfEdges(x0 + (i * W) / n, x0 + ((i + 1) * W) / n);
    if (across === null || bar === null) continue;
    const rect: Rect = { x0: across.lo, x1: across.hi, y0: bar.lo, y1: bar.hi, rgba: colourOf(scale.colors[i % 2]) };
    const clipped = clipRect(rect, view.width, view.height);
    if (clipped !== null) rects.push(clipped);
  }

  const outlineColour = cssRgba(colourOf(scale.outlineColor));
  const fontColour = colourOf(scale.fontColor);
  const labels: ScaleLabel[] = [];
  for (let i = 0; i <= n; i++) {
    const number = String(Number((i * scale.segmentDistance).toPrecision(12)));
    const text = i === n && scale.units !== '' ? `${number} ${scale.units}` : number;
    labels.push({
      id: `scale-${i}`,
      text,
      anchorX: x0 + (i * W) / n,
      anchorY: y0 + H + scale.fontSize * s,
      fontSize: scale.fontSize,
      colour: fontColour,
      outlineSize: scale.outlineWidth,
      outlineColour,
    });
  }
  return { rects, labels, reports: [] };
}

/** 'rgba(R, G, B, A)': R, G, B = floor(255 x channel + 0.5); A is the alpha channel as given. */
export function cssRgba(c: RectColour): string {
  const byte = (v: number): number => Math.floor(255 * v + 0.5);
  return `rgba(${byte(c[0])}, ${byte(c[1])}, ${byte(c[2])}, ${c[3]})`;
}

/** Scale labels as plan labels for the card 1.8f label pass: no rotation, no curve, no extra spacing. */
export function scaleLabelsToPlan(labels: readonly ScaleLabel[]): PlanLabel[] {
  return labels.map((l) => ({
    id: l.id,
    text: l.text,
    anchor: { x: l.anchorX, y: l.anchorY },
    rotation: 0,
    size: l.fontSize,
    curve: 0,
    extraSpacingChar: 0,
    familyKey: 'sans',
    outlineSize: l.outlineSize,
    outlineColour: l.outlineColour,
    colour: l.colour,
  }));
}
