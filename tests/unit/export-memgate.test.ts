import { describe, expect, it } from 'vitest';
import { checkMemoryGate } from '../../src/core/export/memgate.ts';

// Card 1.10 Stage C step 2c (detail v1.1): the per-map memory gate.
// Contract: availableMb a finite integer >= 0, gateMb a safe integer >= 1; otherwise 'param'.
// available below the gate is 'below'; equal passes. No I/O, no message text.

/** The verdict of checkMemoryGate with the arguments cast, so bad types can be passed on purpose. */
function verdict(availableMb: unknown, gateMb: unknown): { ok: boolean; code?: string } {
  return checkMemoryGate(availableMb as number, gateMb as number) as { ok: boolean; code?: string };
}

describe('checkMemoryGate', () => {
  it('passes when available equals the gate', () => {
    expect(verdict(5120, 5120)).toEqual({ ok: true });
  });

  it('passes when available is above the gate', () => {
    expect(verdict(8000, 5120)).toEqual({ ok: true });
  });

  it('refuses with below when available is one below the gate', () => {
    expect(verdict(5119, 5120)).toEqual({ ok: false, code: 'below' });
  });

  it('refuses with below when available is zero and the gate is one', () => {
    expect(verdict(0, 1)).toEqual({ ok: false, code: 'below' });
  });

  it('refuses with param when available is not an integer', () => {
    for (const value of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      expect(verdict(value, 5120)).toEqual({ ok: false, code: 'param' });
    }
  });

  it('refuses with param when available is negative', () => {
    expect(verdict(-1, 5120)).toEqual({ ok: false, code: 'param' });
  });

  it('refuses with param when available is not a number', () => {
    for (const value of ['4096', undefined, null, {}]) {
      expect(verdict(value, 5120)).toEqual({ ok: false, code: 'param' });
    }
  });

  it('refuses with param when the gate is zero, fractional or negative', () => {
    for (const gate of [0, 1.5, -5120]) {
      expect(verdict(8192, gate)).toEqual({ ok: false, code: 'param' });
    }
  });

  it('refuses with param when the gate is beyond the safe integer range', () => {
    expect(verdict(8192, Number.MAX_SAFE_INTEGER + 2)).toEqual({ ok: false, code: 'param' });
  });

  it('treats a gate of one as valid', () => {
    expect(verdict(1, 1)).toEqual({ ok: true });
  });
});
