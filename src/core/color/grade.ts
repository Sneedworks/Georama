/** Maximum RGBA8 input/output pixels (64 MiB per full-size image). */
export const GRADE_MAX_PIXELS = 16 * 1024 * 1024;
/** Radii are fractions of the center-to-corner distance; the transition is smoothstep. */
export const VIGNETTE_INNER_RADIUS = 0.5;
export const VIGNETTE_OUTER_RADIUS = 1;

export interface GradeParams {
  readonly hueShiftDegrees: number;
  readonly saturation: number;
  readonly value: number;
  readonly vignetteStrength: number;
}

export type GradeVerdict =
  | { readonly ok: true; readonly pixels: Uint8Array }
  | { readonly ok: false; readonly code: 'param' | 'length' | 'limit'; readonly message: string };

/**
 * Grade RGBA8 in row-major order, retaining alpha and never modifying the input.
 * Hue is a degree offset in HSV; saturation and value multiply their HSV
 * components and clamp to 1. RGB uses nearest-integer rounding at the end.
 * Vignette darkens RGB by (1 - strength * smoothstep(inner, outer, radius)).
 * A successful call always returns independent output storage.
 */
export function gradeRgba8(rgba: Uint8Array, width: number, height: number, params: GradeParams): GradeVerdict {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    return { ok: false, code: 'length', message: 'dimensions must be positive safe integers' };
  }
  const count = width * height;
  if (count > GRADE_MAX_PIXELS) {
    return { ok: false, code: 'limit', message: 'pixel count exceeds grade limit' };
  }
  if (!(rgba instanceof Uint8Array) || rgba.length !== count * 4) {
    return { ok: false, code: 'length', message: 'RGBA8 data must be a Uint8Array of width * height * 4 bytes' };
  }
  if (typeof params !== 'object' || params === null ||
      !Number.isFinite(params.hueShiftDegrees) ||
      !Number.isFinite(params.saturation) || params.saturation < 0 || params.saturation > 4 ||
      !Number.isFinite(params.value) || params.value < 0 || params.value > 4 ||
      !Number.isFinite(params.vignetteStrength) || params.vignetteStrength < 0 || params.vignetteStrength > 1) {
    return { ok: false, code: 'param', message: 'invalid hue, saturation, value or vignette strength' };
  }

  // Construct the standard typed array explicitly: Uint8Array subclasses may
  // override slice() to return an alias (for example, Node's Buffer).
  const out = new Uint8Array(rgba);
  const hueShift = (params.hueShiftDegrees % 360) / 60;
  const adjustHsv = hueShift !== 0 || params.saturation !== 1 || params.value !== 1;
  const vignette = params.vignetteStrength;
  if (!adjustHsv && vignette === 0) return { ok: true, pixels: out };

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const cornerRadius = Math.hypot(centerX, centerY);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      let shade = 1;
      if (vignette !== 0 && cornerRadius !== 0) {
        const radius = Math.hypot(x - centerX, y - centerY) / cornerRadius;
        const t = Math.max(0, Math.min(1,
          (radius - VIGNETTE_INNER_RADIUS) / (VIGNETTE_OUTER_RADIUS - VIGNETTE_INNER_RADIUS)));
        shade = 1 - vignette * t * t * (3 - 2 * t);
      }
      if (!adjustHsv) {
        out[i] = Math.round(rgba[i] * shade);
        out[i + 1] = Math.round(rgba[i + 1] * shade);
        out[i + 2] = Math.round(rgba[i + 2] * shade);
        continue;
      }

      const r = rgba[i] / 255;
      const g = rgba[i + 1] / 255;
      const b = rgba[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let hue = 0;
      if (delta > 0) {
        if (max === r) hue = (g - b) / delta;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
      }
      hue = (hue + hueShift) % 6;
      if (hue < 0) hue += 6;
      const value = Math.min(1, max * params.value);
      const saturation = max === 0 ? 0 : Math.min(1, delta / max * params.saturation);
      const chroma = value * saturation;
      const second = chroma * (1 - Math.abs(hue % 2 - 1));
      const offset = value - chroma;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      if (hue < 1) { rr = chroma; gg = second; }
      else if (hue < 2) { rr = second; gg = chroma; }
      else if (hue < 3) { gg = chroma; bb = second; }
      else if (hue < 4) { gg = second; bb = chroma; }
      else if (hue < 5) { rr = second; bb = chroma; }
      else { rr = chroma; bb = second; }
      out[i] = Math.round((rr + offset) * 255 * shade);
      out[i + 1] = Math.round((gg + offset) * 255 * shade);
      out[i + 2] = Math.round((bb + offset) * 255 * shade);
    }
  }
  return { ok: true, pixels: out };
}
