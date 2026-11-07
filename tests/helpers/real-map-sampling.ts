// Sample placement, readback comparison, the fixed plan and the input checks for card RM-1 (real-map pan and zoom).
// DOM-free: no DOM or WebGL types. Its imports are the pure land rule and the pure view model, so the Node program
// compiles and tests them.
import { isLand } from '../../src/renderer/render/compose/classify.ts';
import { fitView, oneToOne, panBy, zoomAt, type ViewState } from '../../src/renderer/render/view/viewport.ts';

export interface SamplePoint {
  readonly x: number;
  readonly y: number;
}

export interface ReadbackComparison {
  /** Number of sample points compared. */
  readonly samples: number;
  /** Sample points where at least one channel differs. */
  readonly exactMismatches: number;
  /** Largest absolute channel difference over every sample point. */
  readonly maxDeviation: number;
}

export type ComparePolicy =
  | { readonly kind: 'exact' }
  | { readonly kind: 'tolerance'; readonly maxChannelDelta: number };

/** One step of the plan: a name for the record and the view the step draws. */
export interface PlannedView {
  readonly name: string;
  readonly view: ViewState;
}

/** Counts from the input check, for the record. */
export interface RealMapContent {
  /** Texels whose mask alpha is at or above the threshold (land). */
  readonly landTexels: number;
  /** Texels below the threshold (water). */
  readonly waterTexels: number;
  /** Distinct ground colours on the land texels. */
  readonly groundColours: number;
}

function requirePositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer: ${String(value)}`);
  }
}

/** n values spread evenly from 0 to max (only the middle value when n is 1). */
function spread(max: number, n: number): number[] {
  if (n === 1) return [Math.floor(max / 2)];
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(Math.round((i * max) / (n - 1)));
  return values;
}

/**
 * Deterministic sample placement: the four corners and the centre first, then a row-major lattice spread over the
 * map, skipping points already chosen. Returns at most `count` distinct in-bounds points.
 */
export function samplePoints(width: number, height: number, count: number): SamplePoint[] {
  requirePositiveInt(width, 'width');
  requirePositiveInt(height, 'height');
  requirePositiveInt(count, 'count');
  const maxX = width - 1;
  const maxY = height - 1;
  const out: SamplePoint[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number): void => {
    if (out.length >= count) return;
    const k = `${x},${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y });
  };
  add(0, 0);
  add(maxX, 0);
  add(0, maxY);
  add(maxX, maxY);
  add(Math.floor(maxX / 2), Math.floor(maxY / 2));
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  for (const y of spread(maxY, rows)) for (const x of spread(maxX, cols)) add(x, y);
  return out;
}

/**
 * Compares the sampled texels of two frames of the same width. Texel (x, y) starts at (y * width + x) * channels.
 * `height` bounds the sample rows (follow-up F5). It defaults to the width, the square view the real-map case uses,
 * so the case's existing call is unchanged. Unsampled texels are never compared, so a difference there is invisible
 * by design.
 */
export function compareReadback(
  expected: Uint8Array,
  actual: Uint8Array,
  width: number,
  points: readonly SamplePoint[],
  channels: number,
  height: number = width,
): ReadbackComparison {
  requirePositiveInt(width, 'width');
  requirePositiveInt(height, 'height');
  requirePositiveInt(channels, 'channels');
  let exactMismatches = 0;
  let maxDeviation = 0;
  for (const p of points) {
    if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) {
      throw new RangeError(`sample outside the map: ${String(p.x)},${String(p.y)}`);
    }
    const base = (p.y * width + p.x) * channels;
    if (base + channels > expected.length || base + channels > actual.length) {
      throw new RangeError(`buffer too short for sample ${String(p.x)},${String(p.y)}`);
    }
    let differs = false;
    for (let c = 0; c < channels; c++) {
      const deviation = Math.abs(expected[base + c] - actual[base + c]);
      if (deviation !== 0) differs = true;
      if (deviation > maxDeviation) maxDeviation = deviation;
    }
    if (differs) exactMismatches++;
  }
  return { samples: points.length, exactMismatches, maxDeviation };
}

/**
 * exact: no sampled texel differs. tolerance: the largest sampled channel deviation is within maxChannelDelta.
 * The owner's choice of policy (card RM-1, decision O1) is a parameter here, not a default.
 */
export function passes(result: ReadbackComparison, policy: ComparePolicy): boolean {
  if (policy.kind === 'exact') return result.exactMismatches === 0;
  if (!Number.isFinite(policy.maxChannelDelta) || policy.maxChannelDelta < 0) {
    throw new RangeError(`maxChannelDelta must be a non-negative finite number: ${String(policy.maxChannelDelta)}`);
  }
  return result.maxDeviation <= policy.maxChannelDelta;
}

/**
 * The fixed plan for card RM-1: a 1:1 start, `panSteps` pan steps that each move the view by the same delta, two zoom
 * steps about the screen centre (each doubles the scale), then the fit view. A refusal throws, so a plan never draws
 * a wrong view silently.
 */
export function planRealMap(
  mapW: number,
  mapH: number,
  viewSize: number,
  panSteps: number,
  panDx: number,
  panDy: number,
): PlannedView[] {
  const start = oneToOne(mapW, mapH, viewSize, viewSize);
  if (start.ok !== true) throw new Error(`realmap: 1:1 start refused (${start.code})`);
  const steps: PlannedView[] = [{ name: 'start', view: start.view }];
  let view = start.view;
  for (let i = 1; i <= panSteps; i++) {
    const panned = panBy(view, panDx, panDy);
    if (panned.ok !== true) throw new Error(`realmap: pan ${i} refused (${panned.code})`);
    view = panned.view;
    steps.push({ name: `pan-${i}`, view });
  }
  const centre = viewSize / 2;
  const z2 = zoomAt(view, 2, centre, centre);
  if (z2.ok !== true) throw new Error(`realmap: zoom 2 refused (${z2.code})`);
  steps.push({ name: 'zoom-2', view: z2.view });
  const z4 = zoomAt(z2.view, 2, centre, centre);
  if (z4.ok !== true) throw new Error(`realmap: zoom 4 refused (${z4.code})`);
  steps.push({ name: 'zoom-4', view: z4.view });
  const fit = fitView(mapW, mapH, viewSize, viewSize);
  if (fit.ok !== true) throw new Error(`realmap: fit refused (${fit.code})`);
  steps.push({ name: 'fit', view: fit.view });
  return steps;
}

/**
 * Non-vacuity check on the real-map input (card RM-1, follow-up F2). A blank layer set passes the exact comparison
 * trivially, so the input must hold land and water, and a ground layer that is not one colour. The counts are returned
 * for the record. `mask` and `ground` are RGBA bytes of the same size; a texel is land when its mask alpha is at or
 * above `threshold`.
 */
export function assertRealMapContent(mask: Uint8Array, ground: Uint8Array, threshold: number): RealMapContent {
  if (mask.length % 4 !== 0 || ground.length !== mask.length) {
    throw new RangeError('realmap: mask and ground must be RGBA bytes of the same size');
  }
  let landTexels = 0;
  let waterTexels = 0;
  const colours = new Set<number>();
  for (let i = 0; i < mask.length; i += 4) {
    const verdict = isLand(mask[i + 3] ?? 0, threshold);
    if (verdict.ok !== true) throw new RangeError(`realmap: land test refused (${verdict.code})`);
    if (verdict.land) {
      landTexels++;
      colours.add(((ground[i] ?? 0) << 16) | ((ground[i + 1] ?? 0) << 8) | (ground[i + 2] ?? 0));
    } else {
      waterTexels++;
    }
  }
  if (landTexels === 0) throw new Error('realmap: input has no land texels');
  if (waterTexels === 0) throw new Error('realmap: input has no water texels');
  if (colours.size < 2) throw new Error('realmap: ground layer has a single colour');
  return { landTexels, waterTexels, groundColours: colours.size };
}
