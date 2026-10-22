// Strength round for src/core/assets/resolve.ts, written from the card (T0.6b, rules R1 to R7) and from a table of 145
// operator mutants of the module (122 were killed by the implementer's tests). The survivors showed that the implementer's
// tables never feed the resolver a VALID astral character (a surrogate pair), never test the code-unit edges of the
// surrogate and C1 ranges, and only use references with three or more segments or names of two or more characters.
//
// Mutants that stay alive on purpose (equivalent; the differential run in the commit message shows no input on which
// they differ):
//  - `while (i < n)` as `i <= n` and a high-surrogate test of `i + 1 < n` as `i - 1 < n`, `i + 0 < n` or `i + 1 <= n`: the
//    code unit past the end is NaN, which fails every comparison, and a high surrogate that is the last unit is rejected
//    either way.
//  - `after.length === 0` as `=== 1` and its throw removed: user://assets/ with nothing after it, or one segment, is
//    SEGMENT from the next line (`segments.length < 2`) with the same code.
import { describe, expect, it } from 'vitest';
import { REF_LIMITS, RefError, assetKey, imageBaseName, resolveRef, symbolSetRef } from '../../src/core/assets/resolve.ts';
import type { AssetRef, RefKind } from '../../src/core/assets/resolve.ts';

function codeOf(kind: RefKind, text: unknown): string {
  try {
    resolveRef(kind, text as string);
    return 'ok';
  } catch (error) {
    if (!(error instanceof RefError)) throw error;
    return error.code;
  }
}
const pair = (codePoint: number): string => String.fromCodePoint(codePoint);
const unit = (u: number): string => String.fromCharCode(u);

describe('astral characters (valid surrogate pairs) are ordinary name characters', () => {
  const POINTS = [0x10000, 0x1f600, 0x1d11e, 0x10fc00, 0x10ffff];

  it.each(POINTS)('U+%s sits at the start, in the middle and at the end of a name, in every reference kind', (cp) => {
    const c = pair(cp);
    for (const name of [`${c}x`, `x${c}y`, `x${c}`, c, `${c}${c}`, `a${c}${c}b`]) {
      expect(resolveRef('symbol', `res://sprites/set/${name}`)).toEqual({ source: 'pck', path: `res://sprites/set/${name}.wonderdraft_image` });
      expect(resolveRef('symbol', `res://packs/${name}`)).toEqual({ source: 'pck', path: `res://packs/${name}.wonderdraft_image` });
      expect(resolveRef('symbol', `user://assets/p${c}/set/${name}`)).toEqual({ source: 'user', pack: `p${c}`, relPath: `set/${name}.png` });
      expect(resolveRef('path-style', `res://textures/paths/${name}`)).toEqual({ source: 'pck', path: `res://textures/paths/${name}.wonderdraft_image` });
      expect(resolveRef('border-style', `res://textures/borders/${name}`)).toEqual({ source: 'pck', path: `res://textures/borders/${name}.wonderdraft_image` });
      expect(resolveRef('water-texture', name)).toEqual({ source: 'pck', path: `res://textures/water/${name}.wonderdraft_image` });
      expect(resolveRef('ground-texture', name)).toEqual({ source: 'pck', path: `res://textures/ground/${name}.wonderdraft_image` });
      expect(resolveRef('frame-texture', name)).toEqual({ source: 'pck', path: `res://textures/frames/${name}.wonderdraft_image` });
    }
  });
  it('a pair is followed by the check of the next character: a forbidden one right after it is still found', () => {
    const c = pair(0x1f600);
    for (const bad of ['\\', '\u0000', '\u202e', '\u007f', '\u2028', '\ufeff', unit(0xd800), unit(0xdc00)]) {
      expect({ bad: bad.charCodeAt(0), result: codeOf('symbol', `res://sprites/a/${c}${bad}`) }).toEqual({ bad: bad.charCodeAt(0), result: 'CHARACTER' });
      expect({ bad: bad.charCodeAt(0), result: codeOf('water-texture', `${c}${bad}x`) }).toEqual({ bad: bad.charCodeAt(0), result: 'CHARACTER' });
    }
  });
  it('a pair counts four UTF-8 bytes towards the segment limit', () => {
    const c = pair(0x1f600);
    expect(REF_LIMITS.maxSegmentBytes).toBe(255);
    expect(codeOf('symbol', `res://sprites/${c.repeat(63)}abc`)).toBe('ok');
    expect(codeOf('symbol', `res://sprites/${c.repeat(63)}abcd`)).toBe('SEGMENT');
    expect(codeOf('symbol', `res://sprites/${c.repeat(64)}`)).toBe('SEGMENT');
    expect(codeOf('water-texture', c.repeat(63) + 'abc')).toBe('ok');
    expect(codeOf('water-texture', c.repeat(64))).toBe('SEGMENT');
  });
});

describe('lone surrogates are CHARACTER at every position and at the edge of both ranges', () => {
  const LONE = [0xd800, 0xd83d, 0xdbfe, 0xdbff, 0xdc00, 0xde00, 0xdfff];
  it.each(LONE)('U+%s alone', (u) => {
    const c = unit(u);
    for (const name of [c, `${c}x`, `x${c}`, `x${c}y`, `${c}${c}`]) {
      // Two identical high or low units in a row are never a pair either.
      expect({ u, name: name.length, result: codeOf('symbol', `res://sprites/set/${name}`) }).toEqual({ u, name: name.length, result: 'CHARACTER' });
      expect({ u, name: name.length, result: codeOf('water-texture', name) }).toEqual({ u, name: name.length, result: 'CHARACTER' });
    }
  });
  it('a pair in the wrong order, a high unit before a non-low unit and a low unit after a pair are CHARACTER', () => {
    expect(codeOf('symbol', `res://sprites/a/${unit(0xde00)}${unit(0xd83d)}`)).toBe('CHARACTER');
    expect(codeOf('symbol', `res://sprites/a/${unit(0xd83d)}a`)).toBe('CHARACTER');
    expect(codeOf('symbol', `res://sprites/a/${unit(0xdbff)}${unit(0xdbff)}`)).toBe('CHARACTER');
    expect(codeOf('symbol', `res://sprites/a/${pair(0x1f600)}${unit(0xde00)}`)).toBe('CHARACTER');
    expect(codeOf('symbol', `res://sprites/a/${unit(0xd800)}/b`)).toBe('CHARACTER');
  });
});

describe('code unit edges of the forbidden classes (rule R2)', () => {
  // [code unit, allowed]. Each one sits in a name between two letters, in the second to last segment of a symbol reference.
  const EDGES: Array<[number, boolean]> = [
    [0x1f, false], [0x20, true], [0x5b, true], [0x5c, false], [0x5d, true], [0x7e, true], [0x7f, false], [0x80, false], [0x9e, false],
    [0x9f, false], [0xa0, true], [0xa1, true], [0x2027, true], [0x2028, false], [0x2029, false], [0x202a, false], [0x202d, false],
    [0x202e, false], [0x202f, true], [0x2065, true], [0x2066, false], [0x2068, false], [0x2069, false], [0x206a, true], [0xfefe, true],
    [0xfeff, false], [0xff00, true], [0xfffd, true], [0xfffe, false], [0xffff, false],
  ];
  it.each(EDGES)('U+%s', (u, allowed) => {
    const text = `res://sprites/a${unit(u)}b/x`;
    expect({ u, result: codeOf('symbol', text) }).toEqual({ u, result: allowed ? 'ok' : 'CHARACTER' });
    expect({ u, result: codeOf('ground-texture', `a${unit(u)}b`) }).toEqual({ u, result: allowed ? 'ok' : 'CHARACTER' });
  });
  it('the whole string is judged before the kind: a control character wins over a wrong scheme', () => {
    expect(codeOf('symbol', 'http://x\u0000')).toBe('CHARACTER');
    expect(codeOf('path-style', 'res://icons/x\u202e')).toBe('CHARACTER');
  });
});

describe('the smallest valid references', () => {
  it('a res:// reference may have exactly two segments', () => {
    const sprites = resolveRef('symbol', 'res://sprites/x');
    expect(sprites).toEqual({ source: 'pck', path: 'res://sprites/x.wonderdraft_image' });
    expect(resolveRef('symbol', 'res://packs/x')).toEqual({ source: 'pck', path: 'res://packs/x.wonderdraft_image' });
    expect(symbolSetRef(sprites)).toEqual({ source: 'pck', path: 'res://sprites/.wonderdraft_symbols' });
    expect(imageBaseName(sprites)).toBe('x');
    expect(assetKey(sprites)).toBe('pck:res://sprites/x.wonderdraft_image');
  });
  it('a user reference may have exactly two segments: the pack and one file', () => {
    const user = resolveRef('symbol', 'user://assets/p/f');
    expect(user).toEqual({ source: 'user', pack: 'p', relPath: 'f.png' });
    expect(symbolSetRef(user)).toEqual({ source: 'user', pack: 'p', relPath: '.wonderdraft_symbols' });
    expect(imageBaseName(user)).toBe('f');
    expect(assetKey(user)).toBe('user:p/f.png');
  });
  it('one segment is not enough: the root alone or a pack alone', () => {
    for (const text of ['res://sprites', 'res://packs', 'res://sprites/', 'user://assets/p', 'user://assets/p/', 'user://assets/', 'res://']) {
      expect({ text, result: codeOf('symbol', text) }).toEqual({ text, result: 'SEGMENT' });
    }
  });
  it('one-character names are valid for every style and theme kind', () => {
    expect(resolveRef('path-style', 'res://textures/paths/a')).toEqual({ source: 'pck', path: 'res://textures/paths/a.wonderdraft_image' });
    expect(resolveRef('border-style', 'res://textures/borders/a')).toEqual({ source: 'pck', path: 'res://textures/borders/a.wonderdraft_image' });
    expect(resolveRef('water-texture', 'a')).toEqual({ source: 'pck', path: 'res://textures/water/a.wonderdraft_image' });
    expect(resolveRef('ground-texture', 'a')).toEqual({ source: 'pck', path: 'res://textures/ground/a.wonderdraft_image' });
    expect(resolveRef('frame-texture', 'a')).toEqual({ source: 'pck', path: 'res://textures/frames/a.wonderdraft_image' });
    expect(resolveRef('symbol', 'res://sprites/a/b')).toEqual({ source: 'pck', path: 'res://sprites/a/b.wonderdraft_image' });
  });
  it('a style reference with nothing after the prefix, or with a slash in the name, is SEGMENT', () => {
    expect(codeOf('path-style', 'res://textures/paths/')).toBe('SEGMENT');
    expect(codeOf('border-style', 'res://textures/borders/')).toBe('SEGMENT');
    expect(codeOf('path-style', 'res://textures/paths/a/b')).toBe('SEGMENT');
    expect(codeOf('border-style', 'res://textures/borders/a/')).toBe('SEGMENT');
  });
});

describe('an unknown kind is refused, not guessed', () => {
  it('every value that is not one of the six kinds is NAME and the error names it', () => {
    for (const kind of ['bogus', '', 'Symbol', 'SYMBOL', 'symbol ', '__proto__', 'toString', 'constructor', null, undefined, 42, {}, []]) {
      let seen: RefError | null = null;
      try {
        resolveRef(kind as RefKind, 'res://sprites/a/b');
      } catch (error) {
        seen = error as RefError;
      }
      expect({ kind: String(kind), name: seen?.name, code: seen?.code }).toEqual({ kind: String(kind), name: 'RefError', code: 'NAME' });
    }
  });
  it('the string checks come before the kind is looked at', () => {
    expect(codeOf('bogus' as RefKind, '')).toBe('EMPTY');
    expect(codeOf('bogus' as RefKind, 'a'.repeat(513))).toBe('TOO_LONG');
    expect(codeOf('bogus' as RefKind, 'a\u0000')).toBe('CHARACTER');
    expect(codeOf('bogus' as RefKind, 'res://sprites/a/b')).toBe('NAME');
  });
  it('returned references cannot be used to change the next result', () => {
    const first: AssetRef = resolveRef('symbol', 'res://sprites/a/b');
    try {
      (first as { path: string }).path = 'changed';
    } catch {
      // A frozen result is fine too.
    }
    expect(resolveRef('symbol', 'res://sprites/a/b')).toEqual({ source: 'pck', path: 'res://sprites/a/b.wonderdraft_image' });
  });
});
