// Card 1.10 Stage C step 2c (detail v1.1): the per-map memory gate.
// Pure: no I/O and no message text. The caller prints the stage and the code only (C13).

export type MemGateVerdict = { ok: true } | { ok: false; code: 'param' | 'below' };

/**
 * Decides whether a map may start with the memory that is available now.
 * `availableMb` must be a finite integer >= 0 and `gateMb` a safe integer >= 1; anything else is 'param'.
 * Available below the gate is 'below'. Equal passes.
 */
export function checkMemoryGate(availableMb: number, gateMb: number): MemGateVerdict {
  if (typeof availableMb !== 'number' || !Number.isInteger(availableMb) || availableMb < 0) {
    return { ok: false, code: 'param' };
  }
  if (typeof gateMb !== 'number' || !Number.isSafeInteger(gateMb) || gateMb < 1) {
    return { ok: false, code: 'param' };
  }
  if (availableMb < gateMb) return { ok: false, code: 'below' };
  return { ok: true };
}
