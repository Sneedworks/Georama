import { describe, expect, it } from 'vitest';
import { resolveThemeRef } from '../../src/core/assets/theme-ref.ts';

describe('theme ref minimal', () => {
  it('resolves a valid pck reference', () => {
    expect(resolveThemeRef('res://themes/synthetic/Willow.wonderdraft_theme')).toEqual({
      source: 'pck',
      path: 'res://themes/synthetic/Willow.wonderdraft_theme',
    });
  });
});

describe('theme ref type/empty/length', () => {
  it('enforces the 512 UTF-16 length boundary', () => {
    // Three segments keep every segment under 255 bytes so length is isolated.
    const at = (total: number): string => {
      const body = total - 'res://'.length - '.wonderdraft_theme'.length;
      const right = body - 2 - 162 - 162;
      return `res://${'a'.repeat(162)}/${'b'.repeat(162)}/${'c'.repeat(right)}.wonderdraft_theme`;
    };
    expect(at(511).length).toBe(511);
    expect(at(512).length).toBe(512);
    expect(at(513).length).toBe(513);
    expect(() => resolveThemeRef(at(511))).not.toThrow();
    expect(() => resolveThemeRef(at(512))).not.toThrow();
    expect(() => resolveThemeRef(at(513))).toThrowError(
      expect.objectContaining({ name: 'ThemeRefError', code: 'TOO_LONG' }),
    );
  });
});

describe('theme ref characters', () => {
  const goodBase = 'res://themes/synthetic/Willow.wonderdraft_theme';
  const withCp = (cp: number): string =>
    `res://themes/synth${String.fromCharCode(cp)}etic/Willow.wonderdraft_theme`;
  it('rejects C0 controls, DEL and C1 with CHARACTER', () => {
    for (const cp of [0x00, 0x01, 0x07, 0x08, 0x09, 0x0a, 0x1f, 0x7f, 0x80, 0x9f]) {
      expect(() => resolveThemeRef(withCp(cp))).toThrowError(
        expect.objectContaining({ name: 'ThemeRefError', code: 'CHARACTER' }),
      );
    }
    expect(() => resolveThemeRef(goodBase.replace('Willow', 'space test Willow'))).not.toThrow();
    expect(() => resolveThemeRef(goodBase.replace('Willow', '~Willow~'))).not.toThrow();
  });
  it('rejects invisible unicode, backslash and unpaired surrogates', () => {
    const badCps = [
      0x2028, 0x2029, 0x202a, 0x202b, 0x202e, 0x2066, 0x2069, 0xfeff, 0xfffe, 0xffff, 0x005c,
    ];
    for (const cp of badCps) {
      expect(() => resolveThemeRef(withCp(cp))).toThrowError(
        expect.objectContaining({ name: 'ThemeRefError', code: 'CHARACTER' }),
      );
    }
    expect(() => resolveThemeRef(withCp(0xd800))).toThrowError(
      expect.objectContaining({ name: 'ThemeRefError', code: 'CHARACTER' }),
    );
    expect(() => resolveThemeRef(withCp(0xdc00))).toThrowError(
      expect.objectContaining({ name: 'ThemeRefError', code: 'CHARACTER' }),
    );
    // Boundary code points that must stay allowed.
    for (const cp of [0x2027, 0x202f, 0x2065, 0x206a, 0xfffd, 0x00a0]) {
      expect(() => resolveThemeRef(withCp(cp))).not.toThrow();
    }
    // Paired non-BMP characters and ordinary punctuation stay allowed.
    const pair = `${String.fromCharCode(0xd83d)}${String.fromCharCode(0xde00)}`;
    expect(() =>
      resolveThemeRef(`res://themes/synthetic/Caf${String.fromCharCode(0xe9)} ${pair} & (v2).wonderdraft_theme`),
    ).not.toThrow();
    expect(() => resolveThemeRef('res://themes/a%20b/Willow.wonderdraft_theme')).not.toThrow();
  });
  it('reports CHARACTER before SCHEME', () => {
    expect(() =>
      resolveThemeRef(`bogus://a${String.fromCharCode(0x07)}b.wonderdraft_theme`),
    ).toThrowError(expect.objectContaining({ code: 'CHARACTER' }));
  });
  it('reports TOO_LONG before CHARACTER', () => {
    const longBad =
      `res://${'a'.repeat(162)}/${'b'.repeat(162)}/${'c'.repeat(163)}${String.fromCharCode(0x07)}.wonderdraft_theme`;
    expect(longBad.length).toBeGreaterThan(512);
    expect(() => resolveThemeRef(longBad)).toThrowError(
      expect.objectContaining({ code: 'TOO_LONG' }),
    );
  });
});

describe('theme ref scheme and source mapping', () => {
  it('accepts only exact lowercase res:// and user://', () => {
    const bad = [
      'RES://themes/synthetic/Willow.wonderdraft_theme',
      'Res://themes/synthetic/Willow.wonderdraft_theme',
      'res:/themes/synthetic/Willow.wonderdraft_theme',
      'USER://themes/synthetic/Willow.wonderdraft_theme',
      'user:/themes/synthetic/Willow.wonderdraft_theme',
      'file://themes/synthetic/Willow.wonderdraft_theme',
      'bogus',
    ];
    for (const ref of bad) {
      expect(() => resolveThemeRef(ref)).toThrowError(
        expect.objectContaining({ name: 'ThemeRefError', code: 'SCHEME' }),
      );
    }
  });
  it('maps pck and user sources to their stored paths', () => {
    expect(resolveThemeRef('res://themes/synthetic/Willow.wonderdraft_theme')).toEqual({
      source: 'pck',
      path: 'res://themes/synthetic/Willow.wonderdraft_theme',
    });
    expect(resolveThemeRef('user://themes/synthetic/Willow.wonderdraft_theme')).toEqual({
      source: 'user',
      path: 'themes/synthetic/Willow.wonderdraft_theme',
    });
    expect(resolveThemeRef('user://assets/p/themes/X.wonderdraft_theme')).toEqual({
      source: 'user',
      path: 'assets/p/themes/X.wonderdraft_theme',
    });
    // Any safe directory passes; the suffix keeps resolution data-only.
    expect(resolveThemeRef('res://anything/here/X.wonderdraft_theme')).toEqual({
      source: 'pck',
      path: 'res://anything/here/X.wonderdraft_theme',
    });
    // Stricter backend punctuation still resolves here; the native reader refines later.
    expect(() => resolveThemeRef('user://themes/a:b/X.wonderdraft_theme')).not.toThrow();
    // Percent escapes stay opaque: %2e%2e is literal text, not dot segments.
    expect(() => resolveThemeRef('res://themes/%2e%2e/Willow.wonderdraft_theme')).not.toThrow();
  });
});

describe('theme ref segments', () => {
  it('refuses empty, dot and dotfile segments with SEGMENT', () => {
    const bad = [
      'res://themes/synthetic/Willow.wonderdraft_theme',
      'res://themes/../Willow.wonderdraft_theme',
      'res://./Willow.wonderdraft_theme',
      'res://themes//Willow.wonderdraft_theme',
      'res:///themes/Willow.wonderdraft_theme',
      'res://themes/synthetic/',
      'res://.hidden/Willow.wonderdraft_theme',
      'res://themes/.config/Willow.wonderdraft_theme',
      'user://themes/./Willow.wonderdraft_theme',
      'user://',
    ];
    for (const ref of bad.slice(1)) {
      expect(() => resolveThemeRef(ref)).toThrowError(
        expect.objectContaining({ name: 'ThemeRefError', code: 'SEGMENT' }),
      );
    }
    // Control stays valid beside every refusal.
    expect(() => resolveThemeRef(bad[0])).not.toThrow();
  });
  it('reports SEGMENT before EXTENSION', () => {
    expect(() => resolveThemeRef('res://themes/../Willow')).toThrowError(
      expect.objectContaining({ code: 'SEGMENT' }),
    );
    expect(() => resolveThemeRef('res://themes//other')).toThrowError(
      expect.objectContaining({ code: 'SEGMENT' }),
    );
  });
  it('enforces at most 16 segments', () => {
    const dirs16 = Array.from({ length: 15 }, (_, i) => `d${i}`).join('/');
    const ok16 = `res://${dirs16}/F.wonderdraft_theme`;
    expect(ok16.slice('res://'.length).split('/').length).toBe(16);
    expect(() => resolveThemeRef(ok16)).not.toThrow();
    const dirs17 = Array.from({ length: 16 }, (_, i) => `d${i}`).join('/');
    expect(() => resolveThemeRef(`res://${dirs17}/F.wonderdraft_theme`)).toThrowError(
      expect.objectContaining({ code: 'SEGMENT' }),
    );
    expect(() => resolveThemeRef('user://themes/synthetic/Willow.wonderdraft_theme')).not.toThrow();
  });
  it('enforces 255 UTF-8 bytes per segment', () => {
    const seg = (n: number, ch: string): string => ch.repeat(n);
    // The final segment includes the suffix: 237 + 18 = 255 fits, 238 + 18 = 256 does not.
    expect(() => resolveThemeRef(`res://themes/${seg(237, 'a')}.wonderdraft_theme`)).not.toThrow();
    expect(() => resolveThemeRef(`res://themes/${seg(238, 'a')}.wonderdraft_theme`)).toThrowError(
      expect.objectContaining({ code: 'SEGMENT' }),
    );
    // Multibyte exact boundary: e-acute is 2 bytes, so 118 + X + suffix = 255 fits.
    const e = String.fromCharCode(0xe9);
    expect(() => resolveThemeRef(`res://themes/${seg(118, e)}X.wonderdraft_theme`)).not.toThrow();
    expect(() => resolveThemeRef(`res://themes/${seg(119, e)}X.wonderdraft_theme`)).toThrowError(
      expect.objectContaining({ code: 'SEGMENT' }),
    );
  });
});

describe('theme ref extension', () => {
  it('requires the exact case-sensitive suffix with EXTENSION', () => {
    const bad = [
      'res://themes/synthetic/Willow.gd',
      'res://themes/synthetic/Willow.png',
      'res://themes/synthetic/Willow.WONDERDRAFT_THEME',
      'res://themes/synthetic/Willow.Wonderdraft_Theme',
      'res://themes/synthetic/Willow.wonderdraft_themes',
      'res://themes/synthetic/Willow.wonderdraft_them',
      'res://themes/synthetic/Willow',
      'res://themes/synthetic/Willow.wonderdraft_theme ',
      'res://themes/synthetic/Willow.wonderdraft_theme/bak',
      'user://themes/synthetic/Willow.png',
      'user://themes/synthetic/Willow.wonderdraft_theme.bak',
    ];
    for (const ref of bad) {
      expect(() => resolveThemeRef(ref)).toThrowError(
        expect.objectContaining({ name: 'ThemeRefError', code: 'EXTENSION' }),
      );
    }
    // Controls stay valid beside every refusal.
    expect(() => resolveThemeRef('res://themes/synthetic/Willow.wonderdraft_theme')).not.toThrow();
    expect(() => resolveThemeRef('user://themes/synthetic/Willow.wonderdraft_theme')).not.toThrow();
  });
  it('never appends or strips the suffix', () => {
    expect(resolveThemeRef('res://themes/F.wonderdraft_theme')).toEqual({
      source: 'pck',
      path: 'res://themes/F.wonderdraft_theme',
    });
    // A folder-style reference without the file name is an extension failure, not a default.
    expect(() => resolveThemeRef('res://themes/synthetic')).toThrowError(
      expect.objectContaining({ code: 'EXTENSION' }),
    );
  });
});

describe('theme ref shape and boundaries', () => {
  it('freezes limits and every resolved reference', async () => {
    const mod = await import('../../src/core/assets/theme-ref.ts');
    expect(mod.THEME_REF_LIMITS).toEqual({ maxChars: 512, maxSegments: 16, maxSegmentBytes: 255 });
    expect(Object.isFrozen(mod.THEME_REF_LIMITS)).toBe(true);
    for (const ref of [
      'res://themes/synthetic/Willow.wonderdraft_theme',
      'user://themes/synthetic/Willow.wonderdraft_theme',
    ]) {
      const out = mod.resolveThemeRef(ref);
      expect(Object.isFrozen(out)).toBe(true);
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    }
  });
  it('keeps error messages generic with no input echo', () => {
    const marker = 'UNIQUE_MARKER_q7zX';
    const bad = [
      `res://themes/${marker}/Willow.gd`,
      `bogus://${marker}/Willow.wonderdraft_theme`,
      `res://themes/${marker}//Willow.wonderdraft_theme`,
    ];
    for (const ref of bad) {
      try {
        resolveThemeRef(ref);
        expect.unreachable(ref);
      } catch (e) {
        const err = e as Error & { code: string };
        expect(err.name).toBe('ThemeRefError');
        expect(typeof err.code).toBe('string');
        expect(err.message).not.toContain(marker);
        expect(err.message).not.toContain(ref);
      }
    }
  });
  it('sweeps every C0/C1, bidi and FE boundary code point', () => {
    const withCp = (cp: number): string =>
      `res://themes/synth${String.fromCharCode(cp)}etic/Willow.wonderdraft_theme`;
    for (let cp = 0x00; cp <= 0x1f; cp += 1) {
      expect(() => resolveThemeRef(withCp(cp))).toThrowError(
        expect.objectContaining({ code: 'CHARACTER' }),
      );
    }
    for (let cp = 0x7f; cp <= 0x9f; cp += 1) {
      expect(() => resolveThemeRef(withCp(cp))).toThrowError(
        expect.objectContaining({ code: 'CHARACTER' }),
      );
    }
    for (let cp = 0x202a; cp <= 0x202e; cp += 1) {
      expect(() => resolveThemeRef(withCp(cp))).toThrowError(
        expect.objectContaining({ code: 'CHARACTER' }),
      );
    }
    for (let cp = 0x2066; cp <= 0x2069; cp += 1) {
      expect(() => resolveThemeRef(withCp(cp))).toThrowError(
        expect.objectContaining({ code: 'CHARACTER' }),
      );
    }
    // Just outside every rejected range: allowed.
    for (const cp of [0x20, 0x7e, 0xa0, 0x2027, 0x202f, 0x2065, 0x206a, 0xfffd]) {
      expect(() => resolveThemeRef(withCp(cp))).not.toThrow();
    }
  });
  it('treats equivalent unicode spellings as opaque text without normalizing', () => {
    const e = String.fromCharCode(0xe9);
    const decomposed = `res://themes/synthetic/Cafe${String.fromCharCode(0x65, 0x301)}/X.wonderdraft_theme`;
    expect(() => resolveThemeRef(`res://themes/synthetic/Caf${e}/X.wonderdraft_theme`)).not.toThrow();
    expect(() => resolveThemeRef(decomposed)).not.toThrow();
  });
});

describe('theme ref input type guard', () => {
  it('rejects non-string inputs with TYPE without coercion', () => {
    const wrongInputs: unknown[] = [
      null,
      undefined,
      42,
      ['res://themes/synthetic/F.wonderdraft_theme'],
      { path: 'res://themes/synthetic/F.wonderdraft_theme' },
      (() => 'res://themes/synthetic/F.wonderdraft_theme') as unknown,
      Symbol('ref'),
    ];
    for (const bad of wrongInputs) {
      expect(() => resolveThemeRef(bad as string)).toThrowError(
        expect.objectContaining({ name: 'ThemeRefError', code: 'TYPE' }),
      );
    }
    let toStringCalls = 0;
    let valueOfCalls = 0;
    const sneaky = {
      toString() {
        toStringCalls += 1;
        return 'res://themes/synthetic/F.wonderdraft_theme';
      },
      valueOf() {
        valueOfCalls += 1;
        return 'res://themes/synthetic/F.wonderdraft_theme';
      },
    };
    expect(() => resolveThemeRef(sneaky as unknown as string)).toThrowError(
      expect.objectContaining({ name: 'ThemeRefError', code: 'TYPE' }),
    );
    expect(toStringCalls).toBe(0);
    expect(valueOfCalls).toBe(0);
    // Positive control: legitimate reference still resolves.
    expect(resolveThemeRef('res://themes/synthetic/F.wonderdraft_theme')).toEqual({
      source: 'pck',
      path: 'res://themes/synthetic/F.wonderdraft_theme',
    });
  });
});

describe('theme ref empty guard', () => {
  it('rejects the empty string with EMPTY', () => {
    expect(() => resolveThemeRef('')).toThrowError(
      expect.objectContaining({ name: 'ThemeRefError', code: 'EMPTY' }),
    );
    // Positive control: legitimate reference still resolves.
    expect(resolveThemeRef('res://themes/synthetic/F.wonderdraft_theme')).toEqual({
      source: 'pck',
      path: 'res://themes/synthetic/F.wonderdraft_theme',
    });
  });
});
