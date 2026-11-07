// Card 1.8f, step 2 (RED): the four font families and the fallback (fact 3; D1). Written before src/core/labels/fonts.ts exists.
// The core never reads the environment: the four LABEL_FONT_* variables are read by the hidden harness only (D1).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_KEY, fontKey } from '../../src/core/labels/fonts.ts';

const families = ['East Sea Dokdo', 'Marko One', 'Aladin', 'Cinzel Decorative'];

describe('fontKey: the four families map to four keys (fact 3)', () => {
  it('the four families map to four distinct keys', () => {
    const keys = families.map((name) => fontKey(name).key);
    expect(new Set(keys).size).toBe(4);
  });

  it('none of the four families maps to the fallback key, and none is reported', () => {
    for (const name of families) {
      expect(fontKey(name).key).not.toBe(FALLBACK_KEY);
      expect(fontKey(name).reported).toBe(false);
    }
  });
});

describe('fontKey: an unknown name falls back and is reported (fact 3)', () => {
  it('an unknown name maps to the fallback key and is reported', () => {
    const r = fontKey('Not A Listed Family');
    expect(r.key).toBe(FALLBACK_KEY);
    expect(r.reported).toBe(true);
  });
});

describe('core purity (D1): the core never reads the environment', () => {
  it('src/core/labels/fonts.ts does not reference process.env', () => {
    const src = readFileSync(new URL('../../src/core/labels/fonts.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('process.env');
  });
});
