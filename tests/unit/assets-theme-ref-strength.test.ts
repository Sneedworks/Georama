import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { resolveThemeRef, ThemeRefError } from '../../src/core/assets/theme-ref.ts';

const suffix = '.wonderdraft_theme';
function code(ref: string, expected: string): void {
  assert.throws(() => resolveThemeRef(ref), (e: unknown) => e instanceof ThemeRefError && e.code === expected);
}

describe('parent theme reference strength', () => {
  it('matches an independent character oracle for all 65536 isolated BMP code units', () => {
    const forbidden = /[\u0000-\u001f\u007f-\u009f\\\ud800-\udfff\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff\ufffe\uffff]/u;
    for (let cp = 0; cp <= 0xffff; cp++) {
      const ch = String.fromCharCode(cp);
      const scheme = cp % 2 === 0 ? 'res://' : 'user://';
      const body = `p/a${ch}z/F${suffix}`;
      const ref = scheme + body;
      if (forbidden.test(ch)) code(ref, 'CHARACTER');
      else assert.deepEqual(resolveThemeRef(ref), { source: scheme === 'res://' ? 'pck' : 'user', path: scheme === 'res://' ? ref : body });
    }
  });

  it('accepts surrogate-pair endpoints, scans immediately after pairs and diagnoses valid terminal pairs as extension errors', () => {
    for (const high of [0xd800, 0xd83d, 0xdbff]) for (const low of [0xdc00, 0xde00, 0xdfff]) {
      const pair = String.fromCharCode(high, low);
      const ref = `res://p/a${pair}z/F${suffix}`;
      assert.equal(resolveThemeRef(ref).path, ref);
      code(`res://p/F${pair}`, 'EXTENSION');
      for (const bad of [0, 0x7f, 0x9f, 0x2028, 0x202e, 0x2069, 0xfeff, 0xd800, 0xdfff]) {
        code(`res://p/a${pair}${String.fromCharCode(bad)}z/F${suffix}`, 'CHARACTER');
      }
    }
  });

  it('checks forbidden first characters before scheme dispatch without coercing wrong types', () => {
    for (const cp of [0, 31, 127, 159, 0x5c, 0x202a, 0x2066, 0xfeff, 0xfffe, 0xffff, 0xd800, 0xdfff]) {
      code(`${String.fromCharCode(cp)}res://p/F${suffix}`, 'CHARACTER');
    }
    let coercions = 0;
    const evil = { toString() { coercions++; return `res://p/F${suffix}`; }, valueOf() { coercions++; return 0; } };
    assert.throws(() => resolveThemeRef(evil as unknown as string), (e: unknown) => e instanceof ThemeRefError && e.code === 'TYPE');
    assert.equal(coercions, 0);
    assert.equal(resolveThemeRef(`res://F${suffix}`).path, `res://F${suffix}`);
    assert.equal(resolveThemeRef(`user://F${suffix}`).path, `F${suffix}`);
  });

  it('pins limit-minus-one/exact/plus-one on both schemes and on UTF8 segments', () => {
    const enc = new TextEncoder();
    for (const scheme of ['res://', 'user://']) {
      for (const count of [15, 16, 17]) {
        const ref = scheme + [...Array.from({ length: count - 1 }, () => 'd'), `F${suffix}`].join('/');
        if (count > 16) code(ref, 'SEGMENT'); else assert.equal(resolveThemeRef(ref).source, scheme === 'res://' ? 'pck' : 'user');
      }
      for (const bytes of [254, 255, 256]) {
        const fixed = 'é'.repeat(118);
        const leaf = fixed + 'a'.repeat(bytes - enc.encode(fixed + suffix).length) + suffix;
        assert.equal(enc.encode(leaf).length, bytes);
        const ref = scheme + 'p/' + leaf;
        if (bytes > 255) code(ref, 'SEGMENT'); else assert.equal(resolveThemeRef(ref).source, scheme === 'res://' ? 'pck' : 'user');
      }
      for (const chars of [511, 512, 513]) {
        const rest = chars - scheme.length - suffix.length - 2 - 160 - 160;
        const ref = scheme + 'a'.repeat(160) + '/' + 'b'.repeat(160) + '/' + 'c'.repeat(rest) + suffix;
        assert.equal(ref.length, chars);
        if (chars > 512) code(ref, 'TOO_LONG'); else assert.equal(resolveThemeRef(ref).source, scheme === 'res://' ? 'pck' : 'user');
      }
    }
  });

  it('keeps EXTENSION distinct from SEGMENT for short nonempty leaves', () => {
    for (const scheme of ['res://', 'user://']) {
      for (const leaf of ['a', 'Z', '%', 'é', '😀']) code(scheme + leaf, 'EXTENSION');
      for (const leaf of ['', '.', '..', '/']) code(scheme + leaf, 'SEGMENT');
      assert.equal(resolveThemeRef(scheme + 'F' + suffix).source, scheme === 'res://' ? 'pck' : 'user');
    }
  });

  it('preserves literal percent escapes, case and decomposed unicode in every returned path', () => {
    for (const scheme of ['res://', 'user://']) for (const body of [`p/Cafe${String.fromCharCode(0x301)}/F${suffix}`, `p/%2e%2e/A%2FB${suffix}`, `p/A:B & (v2)/Z${suffix}`, `p/A?B#C/F${suffix}`]) {
      const ref = scheme + body;
      assert.equal(resolveThemeRef(ref).path, scheme === 'res://' ? ref : body);
    }
  });
});
