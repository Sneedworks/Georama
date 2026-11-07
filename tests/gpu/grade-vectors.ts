// Fixed vectors for card 1.2 (grade shader and GPU case). Pure CPU: no GL, no DOM.
//
// The copy below repeats card 1.1's steps (src/core/color/grade.ts) with the same float64
// operations in the same order, and exposes the two pre-round values per channel. The unit
// test asserts that its bytes equal gradeRgba8's bytes, so the copy cannot drift.
//
// Rounding margin: a pre-round value x is at risk when |(x - floor(x)) - 0.5| < GRADE_MARGIN.
// The generator redraws any pixel with an at-risk value in any parameter set, so the fixed
// image has no at-risk value by construction. The redraw is deterministic from the seed.

export const GRADE_IMAGE_WIDTH = 96;
export const GRADE_IMAGE_HEIGHT = 64;
export const GRADE_MARGIN = 0.01;

export interface VectorParams {
  readonly hueDeg: number;
  readonly sat: number;
  readonly val: number;
  readonly vignette: number;
}

export const GRADE_PARAM_SETS: readonly VectorParams[] = [
  { hueDeg: 0, sat: 1, val: 1, vignette: 0 },
  { hueDeg: 75, sat: 1.5, val: 0.8, vignette: 0.5 },
  { hueDeg: -120, sat: 0, val: 1, vignette: 1 },
  { hueDeg: 200, sat: 4, val: 4, vignette: 0.25 },
  { hueDeg: 359.5, sat: 0.5, val: 2, vignette: 0.75 },
  { hueDeg: -0.5, sat: 3, val: 0.1, vignette: 0.9 },
];

const SEED = 0x2a1f3c5b | 0;

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clamp255(x: number): number {
  if (x < 0) return 0;
  if (x > 255) return 255;
  return x;
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

interface PixelRounding {
  readonly out: readonly [number, number, number];
  readonly x1: readonly [number, number, number];
  readonly x2: readonly [number, number, number];
}

function pixelRounding(
  rb: number,
  gb: number,
  bb: number,
  x: number,
  y: number,
  w: number,
  h: number,
  p: VectorParams,
): PixelRounding {
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rmax = w === 1 && h === 1 ? 0 : Math.sqrt(cx * cx + cy * cy);

  const r = rb / 255;
  const g = gb / 255;
  const b = bb / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  let h0 = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) {
      h0 = 60 * (((g - b) / d) % 6);
    } else if (max === g) {
      h0 = 60 * ((b - r) / d + 2);
    } else {
      h0 = 60 * ((r - g) / d + 4);
    }
  }
  h0 = norm360(h0);

  const hp = norm360(h0 + p.hueDeg);
  const sp = clamp01(s * p.sat);
  const vp = clamp01(v * p.val);
  const c = vp * sp;
  const xx = c * (1 - Math.abs(((hp / 60) % 2) - 1));
  const m = vp - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hp < 60) {
    rp = c;
    gp = xx;
  } else if (hp < 120) {
    rp = xx;
    gp = c;
  } else if (hp < 180) {
    gp = c;
    bp = xx;
  } else if (hp < 240) {
    gp = xx;
    bp = c;
  } else if (hp < 300) {
    rp = xx;
    bp = c;
  } else {
    rp = c;
    bp = xx;
  }

  const x1R = (rp + m) * 255;
  const x1G = (gp + m) * 255;
  const x1B = (bp + m) * 255;
  const k1R = clamp255(Math.floor(x1R + 0.5));
  const k1G = clamp255(Math.floor(x1G + 0.5));
  const k1B = clamp255(Math.floor(x1B + 0.5));

  const dx = x - cx;
  const dy = y - cy;
  const dist = rmax === 0 ? 0 : Math.sqrt(dx * dx + dy * dy) / rmax;
  const t = clamp01((dist - 0.5) / (1 - 0.5));
  const q = t * t * (3 - 2 * t);
  const factor = 1 - p.vignette * q;

  const x2R = k1R * factor;
  const x2G = k1G * factor;
  const x2B = k1B * factor;
  return {
    out: [clamp255(Math.floor(x2R + 0.5)), clamp255(Math.floor(x2G + 0.5)), clamp255(Math.floor(x2B + 0.5))],
    x1: [x1R, x1G, x1B],
    x2: [x2R, x2G, x2B],
  };
}

function atRisk(x: number, margin: number): boolean {
  return Math.abs(x - Math.floor(x) - 0.5) < margin;
}

function pixelAtRiskInAnySet(rb: number, gb: number, bb: number, x: number, y: number, w: number, h: number): boolean {
  for (const p of GRADE_PARAM_SETS) {
    const res = pixelRounding(rb, gb, bb, x, y, w, h, p);
    for (let j = 0; j < 3; j++) {
      if (atRisk(res.x1[j], GRADE_MARGIN) || atRisk(res.x2[j], GRADE_MARGIN)) return true;
    }
  }
  return false;
}

// The fixed image: 96 by 64, RGBA8. A 32-bit xorshift stream from SEED; a pixel is redrawn
// until none of its six-set roundings is at risk. Alpha is not part of the rounding.
export function makeGradeImage(): Uint8Array {
  const w = GRADE_IMAGE_WIDTH;
  const h = GRADE_IMAGE_HEIGHT;
  const out = new Uint8Array(w * h * 4);
  let s = SEED;
  const next = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let tries = 0; ; tries++) {
        if (tries >= 10000) throw new Error(`no rounding-safe colour found at ${x},${y}`);
        const rr = next() & 0xff;
        const gg = next() & 0xff;
        const bb = next() & 0xff;
        const aa = next() & 0xff;
        if (!pixelAtRiskInAnySet(rr, gg, bb, x, y, w, h)) {
          const i = (y * w + x) * 4;
          out[i] = rr;
          out[i + 1] = gg;
          out[i + 2] = bb;
          out[i + 3] = aa;
          break;
        }
      }
    }
  }
  return out;
}

// The copy of card 1.1's steps. Bytes must equal gradeRgba8's bytes (unit test).
export function copyGradeRgba8(input: Uint8Array, width: number, height: number, p: VectorParams): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const res = pixelRounding(input[i], input[i + 1], input[i + 2], x, y, width, height, p);
      out[i] = res.out[0];
      out[i + 1] = res.out[1];
      out[i + 2] = res.out[2];
      out[i + 3] = input[i + 3];
    }
  }
  return out;
}

// Number of at-risk pre-round values (both stages, three channels) over the whole image.
export function countAtRisk(input: Uint8Array, width: number, height: number, p: VectorParams, margin: number): number {
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const res = pixelRounding(input[i], input[i + 1], input[i + 2], x, y, width, height, p);
      for (let j = 0; j < 3; j++) {
        if (atRisk(res.x1[j], margin)) count++;
        if (atRisk(res.x2[j], margin)) count++;
      }
    }
  }
  return count;
}
