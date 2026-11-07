// Card 1.10 Stage C step 3e: has the machine settled since the last export?
//
// The measurement of 2026-11-02 (window 3d-measure) showed one <redacted> export holds about
// 2.4 GB of system memory that returns roughly ten seconds after dispose():
//   phase start 7608 MB, after dispose 5215, +2 s 5222, +10 s 6047, +30 s 6046.
// The per-map gate was sampling that transient. This helper only interprets readings; the
// waiting happens in the harness, and the refusal threshold is the owner's 5120 MB, untouched.
//
// Pure: no clock, no I/O, no allocation beyond the verdict.
/**
 * `wait` is the only non-terminal verdict: the caller keeps sampling until it either gets `ok` or
 * runs out of time, and only then refuses with `below`. Keeping the timeout out of this function
 * is what makes it testable without a clock.
 */
export type SettleVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'wait' | 'param' };

const WAIT: SettleVerdict = { ok: false, code: 'wait' };
const PARAM: SettleVerdict = { ok: false, code: 'param' };

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Decides from the readings gathered so far whether the machine has settled at or above `gateMb`.
 *
 * The first sample decides when it is good: a window whose memory is already comfortable adds no
 * wait. Only after a below-gate reading does the rule tighten to two consecutive good readings,
 * so a dip does not pass on a single spike.
 */
export function settleMemory(readings: readonly number[], gateMb: number): SettleVerdict {
  if (!finite(gateMb) || gateMb <= 0) return PARAM;
  if (!Array.isArray(readings)) return PARAM;
  for (const reading of readings) {
    if (!finite(reading)) return PARAM;
  }
  if (readings.length === 0) return WAIT;
  const last = readings[readings.length - 1] as number;
  if (last < gateMb) return WAIT;
  // The first sample above the gate proceeds at once: the common case must add no wait at all.
  if (readings.length === 1) return { ok: true };
  const previous = readings[readings.length - 2] as number;
  return previous >= gateMb ? { ok: true } : WAIT;
}
