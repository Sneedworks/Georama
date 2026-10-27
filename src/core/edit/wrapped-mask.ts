/** Portable horizontal world-wrap painting on a binary row-major raster. */
export type WrappedMaskPaintOptions = Readonly<{
  width: number;
  height: number;
  mask: Uint8Array;
  centerX: number;
  centerY: number;
  radius: number;
  value: 0 | 1;
}>;
export type WrappedMaskPaintResult =
  | Readonly<{ ok: true; mask: Uint8Array; changed: number }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;

/** Provisional API for behavior-first regression tests; implementation follows. */
export function paintWrappedMask(options: WrappedMaskPaintOptions): WrappedMaskPaintResult {
  return { ok: true, mask: options.mask.slice(), changed: 0 };
}
