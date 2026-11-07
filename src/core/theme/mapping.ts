// Card 1.3, hand-set guesses. Owner, 2026-10-30: "Yes: hand-set guesses, labelled, unfitted".
//
// NOT FITTED. No reference export has been used. Nothing here is a measurement.
// - The slopes K_H, K_S, K_V and K_G are placeholders (1), not fitted.
// - The water fields of R1_BASE are read from Wonderdraft's theme panel (owner: the default theme
//   of a blank map), 2026-10-30: water hue -0.25, water saturation -0.15, water value 0.04.
// - vignette_strength 0.78 is taken from the local copy "World map/1" by owner choice (labelled
//   assumption). The panel shows no vignette number.
// - The identity at R1 is an assumption and is reported as one.
// - The export stop rules and the pixel fit of card 1.3 do not run. calibrate-theme.ts is deferred.
//
// Refusals: a missing or non-finite field throws GradeError 'param'. An output outside the
// GradeParams ranges throws GradeError 'param'. Nothing is clamped or defaulted.

import { GradeError, type GradeParams } from '../color/grade.ts';
import type { WdTheme } from '../formats/wonderdraft-map.ts';

export const MAPPING_VERSION = 'guess-0';

export type ThemeGradeInput = Pick<WdTheme, 'waterHue' | 'waterSaturation' | 'waterValue' | 'vignetteStrength'>;

// Placeholder slopes. Unmeasured.
export const K_H = 1;
export const K_S = 1;
export const K_V = 1;
export const K_G = 1;

// Base (identity) theme. An assumption; see the header.
export const R1_BASE: ThemeGradeInput = Object.freeze({
  waterHue: -0.25,
  waterSaturation: -0.15,
  waterValue: 0.04,
  vignetteStrength: 0.78,
});

function requireFinite(theme: Partial<ThemeGradeInput>, key: keyof ThemeGradeInput): number {
  const v = theme[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new GradeError('param', `theme field ${key} is missing or not a finite number`);
  }
  return v;
}

function inRange(name: string, x: number, lo: number, hi: number): number {
  if (!(x >= lo && x <= hi)) {
    throw new GradeError('param', `${name} ${String(x)} is outside [${String(lo)}, ${String(hi)}]`);
  }
  return x;
}

// Pure: the same input gives the same output.
export function themeToGradeParams(theme: ThemeGradeInput): GradeParams {
  if (typeof theme !== 'object' || theme === null) {
    throw new GradeError('param', 'theme must be an object');
  }
  const hue = requireFinite(theme, 'waterHue');
  const sat = requireFinite(theme, 'waterSaturation');
  const val = requireFinite(theme, 'waterValue');
  const vig = requireFinite(theme, 'vignetteStrength');
  return {
    hueDeg: inRange('hueDeg', K_H * (hue - R1_BASE.waterHue) + 0, -360, 360),
    sat: inRange('sat', 1 + K_S * (sat - R1_BASE.waterSaturation), 0, 4),
    val: inRange('val', 1 + K_V * (val - R1_BASE.waterValue), 0, 4),
    vignette: inRange('vignette', K_G * (vig - R1_BASE.vignetteStrength) + 0, 0, 1),
  };
}

/**
 * The same mapping, clamped to the documented output ranges. The viewer uses this: a map must
 * open even when the unfitted guess would refuse its theme. The export and calibration paths keep
 * the strict function above, where an out-of-range value has to be seen rather than smoothed.
 */
export function themeToGradeParamsClamped(theme: ThemeGradeInput): GradeParams {
  if (typeof theme !== 'object' || theme === null) {
    throw new GradeError('param', 'theme must be an object');
  }
  const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
  const hue = requireFinite(theme, 'waterHue');
  const sat = requireFinite(theme, 'waterSaturation');
  const val = requireFinite(theme, 'waterValue');
  const vig = requireFinite(theme, 'vignetteStrength');
  return {
    hueDeg: clamp(K_H * (hue - R1_BASE.waterHue), -360, 360),
    sat: clamp(1 + K_S * (sat - R1_BASE.waterSaturation), 0, 4),
    val: clamp(1 + K_V * (val - R1_BASE.waterValue), 0, 4),
    vignette: clamp(K_G * (vig - R1_BASE.vignetteStrength), 0, 1),
  };
}
