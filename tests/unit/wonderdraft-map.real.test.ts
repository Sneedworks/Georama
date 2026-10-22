import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readWdMap, validateWdMap, writeWdMap } from '../../src/core/formats/wonderdraft-map-file.ts';

const sample = process.env.GEORAMA_SAMPLE_MAP;

describe.skipIf(!sample)('private real map sample (opt-in)', () => {
  it('validates clean and re-encodes byte-identically', () => {
    const original = new Uint8Array(readFileSync(sample!));
    const map = readWdMap(original);
    expect(validateWdMap(map)).toEqual([]);
    const out = writeWdMap(map);
    if (out.length !== original.length) {
      throw new Error(`length differs: original=${original.length} encoded=${out.length}`);
    }
    for (let i = 0; i < original.length; i++) {
      if (out[i] !== original[i]) {
        throw new Error(`BYTES-DIFFER@${i} original=${original[i]} encoded=${out[i]}`);
      }
    }
    expect(out.length).toBe(original.length);
  }, 60_000);
});
