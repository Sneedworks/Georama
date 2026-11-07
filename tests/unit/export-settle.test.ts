// Card 1.10 Stage C step 3e: settle before the per-map gate.
//
// The measurement (2026-11-02, window 3d-measure) showed a full-size export holds ~2.4 GB that
// returns about ten seconds after dispose(). The gate was sampling that transient. This helper
// decides, from the readings gathered so far, whether the machine has settled.
import { describe, expect, it } from 'vitest';
import { settleMemory } from '../../src/core/export/settle.ts';

const GATE = 5120;

describe('settleMemory', () => {
  it('passes at once when the first reading is at or above the gate', () => {
    expect(settleMemory([6000], GATE)).toEqual({ ok: true });
    expect(settleMemory([GATE], GATE)).toEqual({ ok: true });
  });

  it('waits on a single high reading that has no partner yet', () => {
    // One good reading is a moment; the pair is what says the machine is holding.
    expect(settleMemory([4000, 6000], GATE)).toEqual({ ok: false, code: 'wait' });
  });

  it('passes on two consecutive readings at or above the gate', () => {
    expect(settleMemory([4000, 6000, 6100], GATE)).toEqual({ ok: true });
  });

  it('waits while readings stay below, so the caller decides when to give up', () => {
    expect(settleMemory([4000, 4200, 4300], GATE)).toEqual({ ok: false, code: 'wait' });
    expect(settleMemory([], GATE)).toEqual({ ok: false, code: 'wait' });
  });

  it('resets the pair when a good reading is followed by a bad one', () => {
    expect(settleMemory([6000, 4000], GATE)).toEqual({ ok: false, code: 'wait' });
    expect(settleMemory([6000, 4000, 6100], GATE)).toEqual({ ok: false, code: 'wait' });
  });

  it('refuses a gate that is not a positive finite number', () => {
    for (const gate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(settleMemory([6000], gate)).toEqual({ ok: false, code: 'param' });
    }
  });

  it('refuses a reading that is not a finite number', () => {
    expect(settleMemory([6000, Number.NaN], GATE)).toEqual({ ok: false, code: 'param' });
    expect(settleMemory([6000, Number.POSITIVE_INFINITY], GATE)).toEqual({ ok: false, code: 'param' });
  });

  it('refuses a malformed readings argument rather than guessing', () => {
    expect(settleMemory(null as never, GATE)).toEqual({ ok: false, code: 'param' });
    expect(settleMemory([6000, 'high'] as never, GATE)).toEqual({ ok: false, code: 'param' });
  });
});
