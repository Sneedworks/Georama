/** Portable, font-independent collision filtering for synthetic label boxes. */
export type LabelBox = Readonly<{ x: number; y: number; width: number; height: number }>;
export type LabelCollisionResult =
  | Readonly<{ ok: true; accepted: readonly number[]; rejected: readonly number[] }>
  | Readonly<{ ok: false; code: 'INPUT' | 'LIMIT' }>;

/**
 * In input order, retain a label when it does not overlap any retained label.
 * Indices refer to caller input; touching edges are not an overlap.
 */
export function selectNonOverlappingLabels(
  _boxes: readonly LabelBox[], _maxBoxes = 4096,
): LabelCollisionResult {
  // Provisional, deliberately incorrect implementation for the red stage.
  return { ok: true, accepted: [], rejected: [] };
}
