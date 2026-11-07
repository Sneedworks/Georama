// Portable core colour grade: no node: imports, no I/O.
//
// gradeRgba8 applies these steps to every pixel, in order. Alpha is copied unchanged.
//  1. RGB to HSV on the unit scale: v = max; s = (max - min) / max, or 0 when max is 0;
//     hue in degrees, normalised to [0, 360).
//  2. Shift the hue by hueDeg, normalised to [0, 360). s' = clamp(s * sat, 0, 1);
//     v' = clamp(v * val, 0, 1).
//  3. HSV back to RGB by the standard sector formula. Each channel becomes
//     floor(channel * 255 + 0.5), clamped to [0, 255].
//  4. Vignette. The centre is ((width - 1) / 2, (height - 1) / 2) and rmax is the distance
//     to a corner (0 for a 1 by 1 image). d = distance / rmax, or 0 when rmax is 0.
//     t = clamp((d - 0.5) / 0.5, 0, 1); q = t * t * (3 - 2 * t); factor = 1 - vignette * q.
//     Each channel becomes floor(channel * factor + 0.5), clamped to [0, 255].
// A shader must reproduce these steps byte for byte.

export const GRADE_MAX_PIXELS = 67108864;
export const GRADE_VIGNETTE_INNER = 0.5;
export const GRADE_VIGNETTE_OUTER = 1;

export type GradeCode = 'param' | 'length' | 'limit';

export class GradeError extends Error {
  readonly code: GradeCode;
  constructor(code: GradeCode, message: string) {
    super(message);
    this.name = 'GradeError';
    this.code = code;
  }
}

export interface GradeParams {
  readonly hueDeg: number;
  readonly sat: number;
  readonly val: number;
  readonly vignette: number;
}

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

export function gradeRgba8(
  input: Uint8Array,
  width: number,
  height: number,
  params: GradeParams,
): Uint8Array {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new GradeError('param', `invalid dimensions ${String(width)}x${String(height)}`);
  }
  const count = width * height;
  if (count > GRADE_MAX_PIXELS) {
    throw new GradeError('limit', `pixel count ${count} exceeds ${GRADE_MAX_PIXELS}`);
  }
  if (!(input instanceof Uint8Array) || input.length !== count * 4) {
    const got = input instanceof Uint8Array ? String(input.length) : `non-Uint8Array ${typeof input}`;
    throw new GradeError('length', `input length ${got} does not match ${width}x${height}x4`);
  }
  if (typeof params !== 'object' || params === null) {
    throw new GradeError('param', 'params must be an object');
  }
  const hueDeg = params.hueDeg;
  const sat = params.sat;
  const val = params.val;
  const vignette = params.vignette;
  if (typeof hueDeg !== 'number' || !Number.isFinite(hueDeg) || hueDeg < -360 || hueDeg > 360) {
    throw new GradeError('param', `invalid hueDeg ${String(hueDeg)}`);
  }
  if (typeof sat !== 'number' || !Number.isFinite(sat) || sat < 0 || sat > 4) {
    throw new GradeError('param', `invalid sat ${String(sat)}`);
  }
  if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 4) {
    throw new GradeError('param', `invalid val ${String(val)}`);
  }
  if (
    typeof vignette !== 'number' ||
    !Number.isFinite(vignette) ||
    vignette < 0 ||
    vignette > 1
  ) {
    throw new GradeError('param', `invalid vignette ${String(vignette)}`);
  }

  const out = new Uint8Array(count * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rmax = width === 1 && height === 1 ? 0 : Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = input[i] / 255;
      const g = input[i + 1] / 255;
      const b = input[i + 2] / 255;
      const a = input[i + 3];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const v = max;
      const s = max === 0 ? 0 : (max - min) / max;
      let h = 0;
      if (max !== min) {
        const d = max - min;
        if (max === r) {
          h = 60 * (((g - b) / d) % 6);
        } else if (max === g) {
          h = 60 * ((b - r) / d + 2);
        } else {
          h = 60 * ((r - g) / d + 4);
        }
      }
      h = norm360(h);

      const hp = norm360(h + hueDeg);
      const sp = clamp01(s * sat);
      const vp = clamp01(v * val);

      const c = vp * sp;
      const x1 = c * (1 - Math.abs(((hp / 60) % 2) - 1));
      const m = vp - c;
      let rp = 0;
      let gp = 0;
      let bp = 0;
      if (hp < 60) {
        rp = c;
        gp = x1;
      } else if (hp < 120) {
        rp = x1;
        gp = c;
      } else if (hp < 180) {
        gp = c;
        bp = x1;
      } else if (hp < 240) {
        gp = x1;
        bp = c;
      } else if (hp < 300) {
        rp = x1;
        bp = c;
      } else {
        rp = c;
        bp = x1;
      }
      let R = clamp255(Math.floor((rp + m) * 255 + 0.5));
      let G = clamp255(Math.floor((gp + m) * 255 + 0.5));
      let B = clamp255(Math.floor((bp + m) * 255 + 0.5));

      const dx = x - cx;
      const dy = y - cy;
      const dist = rmax === 0 ? 0 : Math.sqrt(dx * dx + dy * dy) / rmax;
      const t = clamp01((dist - GRADE_VIGNETTE_INNER) / (GRADE_VIGNETTE_OUTER - GRADE_VIGNETTE_INNER));
      const q = t * t * (3 - 2 * t);
      const factor = 1 - vignette * q;
      R = clamp255(Math.floor(R * factor + 0.5));
      G = clamp255(Math.floor(G * factor + 0.5));
      B = clamp255(Math.floor(B * factor + 0.5));

      out[i] = R;
      out[i + 1] = G;
      out[i + 2] = B;
      out[i + 3] = a;
    }
  }
  return out;
}
