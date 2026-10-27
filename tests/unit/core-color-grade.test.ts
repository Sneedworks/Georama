import { describe, expect, it } from 'vitest';
import {
  GRADE_MAX_PIXELS,
  VIGNETTE_INNER_RADIUS,
  VIGNETTE_OUTER_RADIUS,
  gradeRgba8,
  type GradeParams,
} from '../../src/core/color/grade.ts';

const IDENTITY: GradeParams = {
  hueShiftDegrees: 0,
  saturation: 1,
  value: 1,
  vignetteStrength: 0,
};

function grade(data: Uint8Array, width: number, height: number, overrides: Partial<GradeParams> = {}) {
  return gradeRgba8(data, width, height, { ...IDENTITY, ...overrides });
}

describe('portable RGBA8 colour grade', () => {
  it('copies identity bytes exactly without changing its input or sharing storage', () => {
    const source = new Uint8Array([0, 128, 255, 0, 90, 110, 150, 233, 255, 0, 10, 255]);
    const before = source.slice();
    const result = grade(source, 3, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pixels).toEqual(before);
    expect(result.pixels).not.toBe(source);
    expect(source).toEqual(before);
  });

  it('does not alias inputs whose Uint8Array slice method returns a view', () => {
    class AliasingBytes extends Uint8Array {
      override slice(): this { return this; }
    }
    const input = new AliasingBytes([1, 2, 3, 4]);
    const result = grade(input, 1, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.pixels[0] = 99;
    expect(input[0]).toBe(1);
  });

  it('wraps hue at 360 degrees in both directions and leaves alpha untouched', () => {
    const red = new Uint8Array([255, 0, 0, 17]);
    const green = new Uint8Array([0, 255, 0, 17]);
    expect(grade(red, 1, 1, { hueShiftDegrees: 120 })).toMatchObject({ ok: true, pixels: green });
    expect(grade(red, 1, 1, { hueShiftDegrees: -240 })).toMatchObject({ ok: true, pixels: green });
    expect(grade(red, 1, 1, { hueShiftDegrees: 360 })).toMatchObject({ ok: true, pixels: red });
    expect(grade(red, 1, 1, { hueShiftDegrees: 180 })).toMatchObject({
      ok: true, pixels: new Uint8Array([0, 255, 255, 17]),
    });
  });

  it('applies saturation and value as multipliers, clamps RGB, and preserves alpha', () => {
    const red = new Uint8Array([255, 0, 0, 50]);
    expect(grade(red, 1, 1, { saturation: 0 })).toMatchObject({
      ok: true, pixels: new Uint8Array([255, 255, 255, 50]),
    });
    expect(grade(red, 1, 1, { value: 0 })).toMatchObject({
      ok: true, pixels: new Uint8Array([0, 0, 0, 50]),
    });
    expect(grade(new Uint8Array([40, 80, 100, 7]), 1, 1, { value: 4 })).toMatchObject({
      ok: true, pixels: new Uint8Array([102, 204, 255, 7]),
    });
  });

  it('has no vignette within the inner radius and full strength at the outer radius', () => {
    expect(VIGNETTE_INNER_RADIUS).toBe(0.5);
    expect(VIGNETTE_OUTER_RADIUS).toBe(1);
    const source = new Uint8Array(5 * 5 * 4);
    for (let p = 0; p < 25; p++) source.set([120, 90, 60, 200], p * 4);
    const result = grade(source, 5, 5, { vignetteStrength: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.pixels.slice(12 * 4, 12 * 4 + 4))).toEqual([120, 90, 60, 200]);
    expect(Array.from(result.pixels.slice(7 * 4, 7 * 4 + 4))).toEqual([120, 90, 60, 200]);
    expect(Array.from(result.pixels.slice(0, 4))).toEqual([0, 0, 0, 200]);
    const mid = result.pixels[(1 * 5 + 0) * 4];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(120);
    expect(source[0]).toBe(120);
  });

  it('uses a smoothstep half-strength vignette at the midpoint radius', () => {
    const source = new Uint8Array(9 * 4);
    for (let i = 0; i < 9; i++) source.set([100, 50, 20, 99], i * 4);
    const result = grade(source, 1, 9, { vignetteStrength: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Row 1 is three quarters of the center-to-corner distance: halfway
    // between vignette radii 0.5 and 1, hence smoothstep(0.5) = 0.5.
    expect(Array.from(result.pixels.slice(4, 8))).toEqual([50, 25, 10, 99]);
  });

  it('is deterministic on a non-square image with combined adjustments', () => {
    const data = new Uint8Array([13, 250, 80, 0, 120, 60, 240, 255, 240, 120, 60, 127, 2, 3, 4, 22, 50, 50, 50, 255, 200, 0, 20, 16]);
    const params = { hueShiftDegrees: -527, saturation: 2.5, value: 1.75, vignetteStrength: 0.4 };
    const a = grade(data, 3, 2, params);
    const b = grade(data, 3, 2, params);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      for (let i = 3; i < data.length; i += 4) expect(a.pixels[i]).toBe(data[i]);
    }
  });

  it.each([
    { hueShiftDegrees: Number.NaN },
    { hueShiftDegrees: Number.POSITIVE_INFINITY },
    { saturation: -0.01 },
    { saturation: 4.01 },
    { value: -0.01 },
    { value: 4.01 },
    { vignetteStrength: -0.01 },
    { vignetteStrength: 1.01 },
  ])('rejects invalid grade parameters as param: %j', (overrides) => {
    expect(grade(new Uint8Array(4), 1, 1, overrides)).toMatchObject({ ok: false, code: 'param' });
  });

  it('accepts both endpoints of the saturation/value range and vignette strength', () => {
    const result = grade(new Uint8Array([200, 120, 30, 255]), 1, 1, {
      hueShiftDegrees: -360, saturation: 4, value: 4, vignetteStrength: 1,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects missing parameters and non-array or mis-sized RGBA buffers as length/param', () => {
    expect(gradeRgba8(new Uint8Array(4), 1, 1, null as never)).toMatchObject({ ok: false, code: 'param' });
    expect(gradeRgba8([0, 0, 0, 0] as never, 1, 1, IDENTITY)).toMatchObject({ ok: false, code: 'length' });
    expect(gradeRgba8(null as never, 1, 1, IDENTITY)).toMatchObject({ ok: false, code: 'length' });
    expect(grade(new Uint8Array(3), 1, 1)).toMatchObject({ ok: false, code: 'length' });
    expect(grade(new Uint8Array(4), 0, 1)).toMatchObject({ ok: false, code: 'length' });
    expect(grade(new Uint8Array(4), 1.5, 1)).toMatchObject({ ok: false, code: 'length' });
  });

  it('returns limit for oversized pixel counts before allocating any output', () => {
    expect(GRADE_MAX_PIXELS).toBe(16 * 1024 * 1024);
    expect(grade(new Uint8Array(0), GRADE_MAX_PIXELS + 1, 1)).toMatchObject({ ok: false, code: 'limit' });
    expect(grade(new Uint8Array(0), 65536, 65536)).toMatchObject({ ok: false, code: 'limit' });
  });
});


/** Contract-specific regressions added before the B1 API correction. */
describe('B1 maintainer contract regression', () => {
  const contract = { hueDeg: 0, sat: 1, val: 1, vignette: 0 };

  function caughtCode(invoke: () => unknown): unknown {
    try { invoke(); return undefined; }
    catch (error) { return (error as { code?: unknown }).code; }
  }

  it('uses a 64 Mi-pixel cap, not a 16 Mi-pixel cap', () => {
    expect(GRADE_MAX_PIXELS).toBe(64 * 1024 * 1024);
  });

  it('accepts the B1 parameter field names and returns a standalone Uint8Array', () => {
    const red = new Uint8Array([255, 0, 0, 17]);
    const result = gradeRgba8(red, 1, 1, { ...contract, hueDeg: 120 } as never);
    expect(result).toEqual(new Uint8Array([0, 255, 0, 17]));
    expect(result).toBeInstanceOf(Uint8Array);
    expect(red).toEqual(new Uint8Array([255, 0, 0, 17]));
  });

  it('throws coded exceptions rather than returning error verdicts', () => {
    expect(caughtCode(() => gradeRgba8(new Uint8Array(3), 1, 1, contract as never))).toBe('length');
    expect(caughtCode(() => gradeRgba8(new Uint8Array(4), 1, 1, { ...contract, sat: 5 } as never)))
      .toBe('param');
    expect(caughtCode(() => gradeRgba8(new Uint8Array(0), 65536, 65536, contract as never)))
      .toBe('limit');
  });

  it('rejects hue outside [-360, 360] but permits both endpoints', () => {
    const rgba = new Uint8Array([255, 0, 0, 17]);
    expect(caughtCode(() => gradeRgba8(rgba, 1, 1, { ...contract, hueDeg: -361 } as never)))
      .toBe('param');
    expect(caughtCode(() => gradeRgba8(rgba, 1, 1, { ...contract, hueDeg: 361 } as never)))
      .toBe('param');
    expect(gradeRgba8(rgba, 1, 1, { ...contract, hueDeg: -360 } as never)).toEqual(rgba);
    expect(gradeRgba8(rgba, 1, 1, { ...contract, hueDeg: 360 } as never)).toEqual(rgba);
  });
});
