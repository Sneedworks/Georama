import { describe, expect, it } from 'vitest';
import { GradeError } from '../../src/core/color/grade';
import {
  K_G,
  K_H,
  K_S,
  K_V,
  MAPPING_VERSION,
  R1_BASE,
  themeToGradeParams,
  themeToGradeParamsClamped,
} from '../../src/core/theme/mapping';

// Card 1.3, hand-set guesses (owner, 2026-10-30). The slopes are placeholders and
// R1_BASE is the owner's theme-panel read. The tests use the imported constants,
// so they hold whatever values those constants carry.

const withField = (field: keyof typeof R1_BASE, value: number): typeof R1_BASE =>
  ({ ...R1_BASE, [field]: value });

function gradeCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof GradeError ? e.code : 'other';
  }
}

describe('theme-to-grade mapping (card 1.3, hand-set guesses)', () => {
  it('maps the R1 base theme to the identity', () => {
    expect(themeToGradeParams({ ...R1_BASE })).toEqual({ hueDeg: 0, sat: 1, val: 1, vignette: 0 });
  });

  it('applies each slope to its own offset from R1 and nothing else', () => {
    const hue = themeToGradeParams(withField('waterHue', R1_BASE.waterHue + 0.5));
    expect(hue.hueDeg).toBeCloseTo(K_H * 0.5, 12);
    expect([hue.sat, hue.val, hue.vignette]).toEqual([1, 1, 0]);

    const sat = themeToGradeParams(withField('waterSaturation', R1_BASE.waterSaturation + 0.25));
    expect(sat.sat).toBeCloseTo(1 + K_S * 0.25, 12);
    expect([sat.hueDeg, sat.val, sat.vignette]).toEqual([0, 1, 0]);

    const val = themeToGradeParams(withField('waterValue', R1_BASE.waterValue + 0.25));
    expect(val.val).toBeCloseTo(1 + K_V * 0.25, 12);
    expect([val.hueDeg, val.sat, val.vignette]).toEqual([0, 1, 0]);

    const vig = themeToGradeParams(withField('vignetteStrength', R1_BASE.vignetteStrength + 0.25));
    expect(vig.vignette).toBeCloseTo(K_G * 0.25, 12);
    expect([vig.hueDeg, vig.sat, vig.val]).toEqual([0, 1, 1]);
  });

  it('refuses NaN and infinite theme fields with code param', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(gradeCode(() => themeToGradeParams(withField('waterHue', bad)))).toBe('param');
    }
  });

  it('refuses a missing field instead of defaulting it', () => {
    const partial: Partial<typeof R1_BASE> = { ...R1_BASE };
    delete partial.waterValue;
    expect(gradeCode(() => themeToGradeParams(partial as typeof R1_BASE))).toBe('param');
  });

  it('refuses an output outside the GradeParams ranges and does not clamp it', () => {
    expect(gradeCode(() => themeToGradeParams(withField('waterHue', R1_BASE.waterHue + 1e9)))).toBe('param');
    expect(gradeCode(() => themeToGradeParams(withField('waterSaturation', R1_BASE.waterSaturation + 1e9)))).toBe('param');
    expect(gradeCode(() => themeToGradeParams(withField('vignetteStrength', R1_BASE.vignetteStrength + 1e9)))).toBe('param');
  });

  it('is deterministic for the same input', () => {
    const t = withField('waterValue', R1_BASE.waterValue + 0.1);
    expect(themeToGradeParams(t)).toEqual(themeToGradeParams({ ...t }));
  });

  it('labels its constants as guesses in MAPPING_VERSION', () => {
    expect(MAPPING_VERSION).toMatch(/guess/);
  });

  it('clamps the viewer variant where the strict mapping refuses', () => {
    // A map whose vignette sits below the base is exactly the case the strict mapping refuses.
    const theme = withField('vignetteStrength', R1_BASE.vignetteStrength - 0.5);
    expect(gradeCode(() => themeToGradeParams(theme))).toBe('param');
    expect(themeToGradeParamsClamped(theme).vignette).toBe(0);
  });

  it('keeps the viewer variant inside every documented range', () => {
    const extremes = [
      withField('waterHue', -50),
      withField('waterHue', 50),
      withField('waterSaturation', 1e6),
      withField('waterValue', -1e6),
      withField('vignetteStrength', 1e6),
    ];
    for (const theme of extremes) {
      const p = themeToGradeParamsClamped(theme);
      expect(p.hueDeg).toBeGreaterThanOrEqual(-360);
      expect(p.hueDeg).toBeLessThanOrEqual(360);
      expect(p.sat).toBeGreaterThanOrEqual(0);
      expect(p.sat).toBeLessThanOrEqual(4);
      expect(p.val).toBeGreaterThanOrEqual(0);
      expect(p.val).toBeLessThanOrEqual(4);
      expect(p.vignette).toBeGreaterThanOrEqual(0);
      expect(p.vignette).toBeLessThanOrEqual(1);
    }
  });

  it('still refuses a non-finite field in the viewer variant', () => {
    expect(gradeCode(() => themeToGradeParamsClamped(withField('waterHue', Number.NaN)))).toBe('param');
  });
});
