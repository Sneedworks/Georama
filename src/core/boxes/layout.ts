// Card 1.9b, GREEN (core): nine-patch layout. Detail v2.3 D3, D4.
// Pure: no DOM, no GL, no I/O. The box rectangle is the margin rectangle
// (all anchors are zero, F20). Corners stay fixed; edges and the centre stretch
// to fill. A zero-size centre is allowed. A box rectangle smaller than the
// insets, or a margin rectangle that is not positive, is refused with 'param'.
import { BoxError } from './record.ts';
import type { BoxImage, BoxRecord } from './record.ts';

export interface BoxRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface NinePatch {
  readonly src: BoxRect;
  readonly dst: BoxRect;
}

function fail(message: string): never {
  throw new BoxError('param', message);
}

/**
 * The nine source rectangles on the box image and the nine destination
 * rectangles on the box rectangle, in row-major order (top-left, top,
 * top-right, left, centre, right, bottom-left, bottom, bottom-right).
 */
export function layoutBox(box: BoxRecord): readonly NinePatch[] {
  if (box === null || typeof box !== 'object') fail('layout: expected a box record');
  const { left, top, right, bottom } = box.margin;
  for (const v of [left, top, right, bottom]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('layout: margin edges must be finite numbers');
  }
  if (right <= left || bottom <= top) fail('layout: margin rectangle is not positive');
  const { left: insetL, top: insetT, right: insetR, bottom: insetB } = box.patch;
  for (const v of [insetL, insetT, insetR, insetB]) {
    if (!Number.isInteger(v) || v < 0) fail('layout: patch insets must be integers >= 0');
  }
  const { width: imgW, height: imgH } = box.image;
  if (!Number.isInteger(imgW) || imgW < 1 || !Number.isInteger(imgH) || imgH < 1) {
    fail('layout: image size must be a positive integer');
  }
  const width = right - left;
  const height = bottom - top;
  if (insetL + insetR > width || insetT + insetB > height) {
    fail('layout: box rectangle is smaller than the insets');
  }
  if (insetL + insetR > imgW || insetT + insetB > imgH) fail('layout: insets exceed the image size');
  const xs = [0, insetL, imgW - insetR, imgW];
  const ys = [0, insetT, imgH - insetB, imgH];
  const xd = [left, left + insetL, right - insetR, right];
  const yd = [top, top + insetT, bottom - insetB, bottom];
  const out: NinePatch[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push({
        src: { x0: xs[col], y0: ys[row], x1: xs[col + 1], y1: ys[row + 1] },
        dst: { x0: xd[col], y0: yd[row], x1: xd[col + 1], y1: yd[row + 1] },
      });
    }
  }
  return out;
}

/** One visible box ready to draw: its image plus its patches (D8). */
export interface BoxPlanEntry {
  readonly image: BoxImage;
  readonly patches: readonly NinePatch[];
}

/** The draw list for an array of boxes: one entry per visible box (D7 order). */
export interface BoxDrawPlan {
  readonly entries: readonly BoxPlanEntry[];
  readonly skipped: number;
}

/**
 * Plan the draw list for boxes in array order. A box with visible false is
 * skipped and counted (D8); it is not a refusal. The centre patch (index 4)
 * is dropped when drawCenter is false. A layout refusal propagates (D4).
 */
export function planBoxes(boxes: readonly BoxRecord[]): BoxDrawPlan {
  if (!Array.isArray(boxes)) fail('plan: expected an array of box records');
  const entries: BoxPlanEntry[] = [];
  let skipped = 0;
  for (const box of boxes) {
    if (box === null || typeof box !== 'object') fail('plan: expected a box record');
    if ((box as BoxRecord).visible === false) {
      skipped++;
      continue;
    }
    const patches = layoutBox(box as BoxRecord);
    entries.push({
      image: (box as BoxRecord).image,
      patches: (box as BoxRecord).drawCenter === false
        ? [...patches.slice(0, 4), ...patches.slice(5)]
        : [...patches],
    });
  }
  return { entries, skipped };
}
