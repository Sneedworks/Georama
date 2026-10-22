export type ClassifyErrorCode = 'INPUT' | 'LIMIT';

export type ThresholdOk = { ok: true; threshold: number };
export type ThresholdErr = { ok: false; code: ClassifyErrorCode; message: string };
export type ThresholdVerdict = ThresholdOk | ThresholdErr;

export type LandOk = { ok: true; land: boolean };
export type LandErr = { ok: false; code: ClassifyErrorCode; message: string };
export type LandVerdict = LandOk | LandErr;

function isByteInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

export function thresholdFromWaterLevel(w: number): ThresholdVerdict {
  if (!Number.isFinite(w) || w < 0 || w > 1) {
    return { ok: false, code: 'INPUT', message: 'w must be finite in 0..1' };
  }
  return { ok: true, threshold: Math.round(w * 255) };
}

export function isLand(alpha: number, threshold: number): LandVerdict {
  if (!isByteInt(alpha) || !isByteInt(threshold)) {
    return { ok: false, code: 'INPUT', message: 'args must be ints in 0..255' };
  }
  return { ok: true, land: alpha >= threshold };
}
