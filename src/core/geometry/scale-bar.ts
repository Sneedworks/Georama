/** Portable scale-bar geometry; units and label formatting belong to the caller. */
export type ScaleTick = Readonly<{
  index: number;
  /** Offset from the scale bar's left edge, in screen pixels. */
  pixel: number;
  /** Distance from the scale bar's origin, in map/world units. */
  world: number;
}>;

export type ScaleBarResult =
  | Readonly<{ ok: true; worldLength: number; pixelLength: number; ticks: readonly ScaleTick[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;

export type ScaleBarOptions = Readonly<{
  /** Positive world units represented by one screen pixel. */
  unitsPerPixel: number;
  /** Maximum screen width of the scale bar. */
  maxWidthPx: number;
  /** Number of equal intervals (default 4, maximum 32). */
  segments?: number;
}>;

/**
 * Picks the largest 1-2-5 x 10^n distance that fits the pixel budget.
 * The output is relative geometry, independent of viewport position, fonts,
 * display units, browser APIs, and any renderer implementation.
 */
export function layoutScaleBar(options: ScaleBarOptions): ScaleBarResult {
  if (!options || !Number.isFinite(options.unitsPerPixel) || options.unitsPerPixel <= 0 ||
      !Number.isFinite(options.maxWidthPx) || options.maxWidthPx <= 0) {
    return { ok: false, code: 'INPUT' };
  }

  const segments = options.segments ?? 4;
  if (!Number.isSafeInteger(segments) || segments < 1) return { ok: false, code: 'INPUT' };
  if (segments > 32 || options.maxWidthPx > 10_000_000) return { ok: false, code: 'LIMIT' };

  const maxWorldLength = options.unitsPerPixel * options.maxWidthPx;
  if (!Number.isFinite(maxWorldLength) || maxWorldLength <= 0) {
    return { ok: false, code: 'LIMIT' };
  }

  const exponent = Math.floor(Math.log10(maxWorldLength));
  const power = 10 ** exponent;
  // Extremely small doubles may have no representable 10^n base.
  if (!Number.isFinite(power) || power <= 0) return { ok: false, code: 'LIMIT' };

  let worldLength = 0;
  let pixelLength = 0;
  // The 0.5 candidate covers logarithm rounding at a power-of-ten boundary.
  for (const factor of [5, 2, 1, 0.5]) {
    const candidate = factor * power;
    if (!Number.isFinite(candidate) || candidate <= 0 || candidate > maxWorldLength) continue;
    const pixels = candidate / options.unitsPerPixel;
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > options.maxWidthPx) continue;
    worldLength = candidate;
    pixelLength = pixels;
    break;
  }
  if (worldLength === 0) return { ok: false, code: 'LIMIT' };

  const ticks: ScaleTick[] = [];
  for (let index = 0; index <= segments; index++) {
    const fraction = index / segments;
    const world = index === segments ? worldLength : fraction * worldLength;
    const pixel = index === segments ? pixelLength : fraction * pixelLength;
    ticks.push({ index, pixel, world });
  }

  return { ok: true, worldLength, pixelLength, ticks };
}
