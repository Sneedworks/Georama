import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  POINTS_LIMITS,
  WdPointsError,
  formatPoints,
  parsePoints,
} from '../../src/core/formats/wonderdraft-points.ts';

const f = (...v: number[]): Float32Array => new Float32Array(v);

function fmtErr(text: string): { code: string; offset: number; name: string; message: string } {
  let caught: unknown;
  try {
    parsePoints(text);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(WdPointsError);
  const e = caught as WdPointsError;
  expect(e.name).toBe('WdPointsError');
  expect(e.message.startsWith(`${e.code} at ${e.offset}: `)).toBe(true);
  return { code: e.code, offset: e.offset, name: e.name, message: e.message };
}

function fmtErrOf(fn: () => unknown): WdPointsError {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(WdPointsError);
  return caught as WdPointsError;
}

/** Small seeded PRNG so the property test is deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parse basics', () => {
  it('parses spaced, compact and tab/newline-separated points', () => {
    expect(Array.from(parsePoints('[ Vector2( 1, 2 ), Vector2( 3.5, -4.25 ) ]'))).toEqual([
      1, 2, 3.5, -4.25,
    ]);
    expect(Array.from(parsePoints('[Vector2(1,2),Vector2(3,4)]'))).toEqual([1, 2, 3, 4]);
    expect(Array.from(parsePoints('[\tVector2(\r\n1 ,\n2\t)\n]'))).toEqual([1, 2]);
  });

  it('parses empty arrays', () => {
    expect(parsePoints('[]').length).toBe(0);
    expect(parsePoints('[  ]').length).toBe(0);
    expect(parsePoints('[\t\r\n ]').length).toBe(0);
  });

  it('parses exponents and underflow-to-zero', () => {
    expect(Array.from(parsePoints('[ Vector2( 1e3, -2.5E-2 ) ]'))).toEqual([1000, Math.fround(-0.025)]);
    expect(Array.from(parsePoints('[ Vector2( 1e-999, 2 ) ]'))).toEqual([0, 2]);
  });
});

describe('float32 semantics', () => {
  it('rounds 0.1 and 16777217 to float32', () => {
    const got = parsePoints('[ Vector2( 0.1, 16777217 ) ]');
    expect(got[0]).toBe(Math.fround(0.1));
    expect(got[1]).toBe(16777216);
  });
});

describe('rejections carry exact code and offset', () => {
  it('rejects structural errors', () => {
    expect(fmtErr('Vector2( 1, 2 )')).toMatchObject({ code: 'FORMAT', offset: 0 });
    const unterminated = '[ Vector2( 1, 2 )';
    expect(fmtErr(unterminated)).toMatchObject({ code: 'FORMAT', offset: unterminated.length });
    expect(fmtErr('[ Vector3( 1, 2 ) ]')).toMatchObject({ code: 'FORMAT', offset: 2 });
    const missingSecond = '[ Vector2( 1 ) ]';
    expect(fmtErr(missingSecond)).toMatchObject({ code: 'FORMAT', offset: missingSecond.indexOf(')') });
    const threeNums = '[ Vector2( 1, 2, 3 ) ]';
    expect(fmtErr(threeNums)).toMatchObject({ code: 'FORMAT', offset: threeNums.indexOf(', 3') });
    const trailingComma = '[ Vector2( 1, 2 ), ]';
    expect(fmtErr(trailingComma)).toMatchObject({ code: 'FORMAT', offset: trailingComma.indexOf(']') });
    const doubleComma = '[ Vector2( 1, 2 ),, Vector2( 3, 4 ) ]';
    expect(fmtErr(doubleComma)).toMatchObject({ code: 'FORMAT', offset: doubleComma.indexOf(',,') + 1 });
    const afterClose = '[ Vector2( 1, 2 ) ]!';
    expect(fmtErr(afterClose)).toMatchObject({ code: 'FORMAT', offset: afterClose.indexOf('!') });
    expect(fmtErr('')).toMatchObject({ code: 'FORMAT', offset: 0 });
    expect(fmtErr('   ')).toMatchObject({ code: 'FORMAT', offset: 3 });
    expect(fmtErr('[ ')).toMatchObject({ code: 'FORMAT', offset: 2 });
  });

  it('rejects malformed numbers at the token start', () => {
    for (const token of ['.5', '5.', '+1', '0x10', 'Infinity', 'nan', 'inf', '1e999']) {
      const text = `[ Vector2( ${token}, 2 ) ]`;
      expect(fmtErr(text), token).toMatchObject({ code: 'FORMAT', offset: text.indexOf(token) });
    }
    expect(fmtErr('[ Vector2( --1, 2 ) ]')).toMatchObject({ code: 'FORMAT', offset: 11 });
    expect(fmtErr('[ Vector2( 1_000, 2 ) ]')).toMatchObject({ code: 'FORMAT', offset: 11 });
  });

  it('rejects an embedded NUL at its index', () => {
    const text = '[ Vector2( 1, 2 \u0000) ]';
    expect(fmtErr(text)).toMatchObject({ code: 'FORMAT', offset: text.indexOf('\u0000') });
  });
});

describe('format exact strings', () => {
  it('formats points Godot-style', () => {
    expect(formatPoints(f(1, 2, 3.5, -4.25))).toBe('[ Vector2( 1, 2 ), Vector2( 3.5, -4.25 ) ]');
    expect(formatPoints(f(Math.fround(7410.68), Math.fround(2673.62)))).toBe(
      '[ Vector2( 7410.68, 2673.62 ) ]',
    );
    expect(formatPoints(f(0.1, 100))).toBe('[ Vector2( 0.1, 100 ) ]');
    expect(formatPoints(f(-0, 0))).toBe('[ Vector2( 0, 0 ) ]');
    expect(formatPoints(f(Math.fround(1e-7), 1))).toBe('[ Vector2( 0.0000001, 1 ) ]');
    // Godot's writer emits two spaces for an empty Array; this shape is NOT
    // observed in the corpus, so it is pinned here instead of measured.
    expect(formatPoints(new Float32Array(0))).toBe('[  ]');
  });

  it('rejects odd length and non-finite values with the value index', () => {
    expect(fmtErrOf(() => formatPoints(f(1, 2, 3)))).toMatchObject({ code: 'FORMAT', offset: 2 });
    expect(fmtErrOf(() => formatPoints(f(1)))).toMatchObject({ code: 'FORMAT', offset: 0 });
    expect(fmtErrOf(() => formatPoints(f(1, NaN)))).toMatchObject({ code: 'FORMAT', offset: 1 });
    expect(fmtErrOf(() => formatPoints(f(Infinity, 0)))).toMatchObject({ code: 'FORMAT', offset: 0 });
    expect(fmtErrOf(() => formatPoints(f(0, -Infinity)))).toMatchObject({ code: 'FORMAT', offset: 1 });
  });

  it('rejects magnitudes toFixed cannot print with FORMAT', () => {
    expect(fmtErrOf(() => formatPoints(f(1e21, 0)))).toMatchObject({ code: 'FORMAT', offset: 0 });
    expect(fmtErrOf(() => formatPoints(f(0, -1e22)))).toMatchObject({ code: 'FORMAT', offset: 1 });
  });
});

describe('property: format/parse round-trips bits', () => {
  it('seeded values survive formatPoints then parsePoints', () => {
    const rand = mulberry32(0x9e3779b9);
    const round2 = (x: number): number => Math.fround(Math.round(x * 100) / 100);
    // -0 formats as "0" (pinned above), so canonicalize it here: the card
    // requires exact bit equality below, which only holds for +0.
    const canonical = (x: number): number => (x === 0 ? 0 : x);
    const values: number[] = [];
    for (let i = 0; i < 2000; i++) values.push(canonical(round2((rand() - 0.5) * 20000)));
    const bits = new Uint32Array(1);
    const asFloat = new Float32Array(bits.buffer);
    let guard = 0;
    while (values.length < 2500 && guard++ < 100000) {
      bits[0] = (rand() * 0x100000000) >>> 0;
      const v = asFloat[0];
      if (Number.isFinite(v) && Math.abs(v) >= 1e-6 && Math.abs(v) <= 1e9) values.push(v);
    }
    expect(values.length).toBe(2500);
    for (let i = 0; i < values.length; i += 2) {
      const pair = f(values[i], values[i + 1]);
      const s = formatPoints(pair);
      const back = parsePoints(s);
      expect(back.length).toBe(2);
      expect(Array.from(new Uint32Array(back.buffer))).toEqual(Array.from(new Uint32Array(pair.buffer)));
      const nums = s.match(/-?[\d.]+/g) ?? [];
      for (const n of nums) {
        expect(n).toMatch(/^-?\d+(\.\d*[1-9])?$/);
        expect(n).not.toContain('e');
        expect(n).not.toContain('E');
      }
      expect(s).not.toContain('NaN');
      expect(s).not.toContain('Infinity');
    }
  });
});

describe('hostile inputs stay fast and capped', () => {
  it('rejects a 50 MB string at offset 0 in under 100 ms', () => {
    const big = 'x'.repeat(50 * 1024 * 1024);
    const start = performance.now();
    const err = fmtErrOf(() => parsePoints(big));
    expect(performance.now() - start).toBeLessThan(100);
    expect(err.code).toBe('LIMIT');
    expect(err.offset).toBe(0);
  });

  it('rejects the 1,000,001st point at its start offset', () => {
    const unit = 'Vector2(1,2),';
    const text = `[${unit.repeat(1000001)}]`;
    expect(text.length).toBeLessThan(POINTS_LIMITS.maxTextLength);
    const err = fmtErrOf(() => parsePoints(text));
    expect(err.code).toBe('LIMIT');
    expect(err.offset).toBe(1 + unit.length * 1000000);
  });

  it('fails 1 MB of open parens in under 100 ms', () => {
    const text = `[${'Vector2('.repeat(131072)}`;
    const start = performance.now();
    const err = fmtErrOf(() => parsePoints(text));
    expect(performance.now() - start).toBeLessThan(100);
    expect(err.code).toBe('FORMAT');
  });

  it('fails a 1 MB digit number as overflow in under 200 ms', () => {
    const text = `[Vector2(${'1'.repeat(1024 * 1024)},2)]`;
    const start = performance.now();
    const err = fmtErrOf(() => parsePoints(text));
    expect(performance.now() - start).toBeLessThan(200);
    expect(err.code).toBe('FORMAT');
  });

  it('parses a valid 10 MB text in under 1.5 s', () => {
    const point = 'Vector2(123.456,-78.25)';
    const reps = Math.ceil((10 * 1024 * 1024) / (point.length + 1));
    const text = `[${point}${`,${point}`.repeat(reps - 1)}]`;
    const start = performance.now();
    const got = parsePoints(text);
    expect(performance.now() - start).toBeLessThan(1500);
    expect(got.length).toBe(reps * 2);
    expect(got[0]).toBe(Math.fround(123.456));
    expect(got[1]).toBe(Math.fround(-78.25));
  });
});

describe('limits and purity', () => {
  it('exposes the documented limits', () => {
    expect(POINTS_LIMITS.maxTextLength).toBe(16777216);
    expect(POINTS_LIMITS.maxPoints).toBe(1000000);
  });

  it('returns equal but distinct arrays', () => {
    const text = '[ Vector2( 1, 2 ) ]';
    const a = parsePoints(text);
    const b = parsePoints(text);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a).toBeInstanceOf(Float32Array);
  });

  it('format rejects more than maxPoints with LIMIT', () => {
    const values = new Float32Array((POINTS_LIMITS.maxPoints + 1) * 2);
    const err = fmtErrOf(() => formatPoints(values));
    expect(err.code).toBe('LIMIT');
  });
});

// Gaps the independent reviews found: mutants of the parser and the formatter that
// the first test set did not kill, plus the one place where the code deviated from
// the card (rule P5: LIMIT only where a point beyond the maximum really starts).
describe('review follow-ups', () => {
  it('requires the keyword exactly as Vector2, one letter at a time', () => {
    const word = 'Vector2';
    let flippedCount = 0;
    for (let k = 0; k < word.length; k++) {
      const ch = word[k];
      const other = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
      if (other === ch) continue; // the digit has no case
      flippedCount++;
      const flipped = word.slice(0, k) + other + word.slice(k + 1);
      expect(fmtErr(`[ ${flipped}( 1, 2 ) ]`), flipped).toMatchObject({ code: 'FORMAT', offset: 2 });
    }
    expect(flippedCount).toBe(6);
    expect(fmtErr('[ Vector2x( 1, 2 ) ]')).toMatchObject({ code: 'FORMAT', offset: 9 });
    expect(fmtErr('[ Vector 2( 1, 2 ) ]')).toMatchObject({ code: 'FORMAT', offset: 2 });
  });

  it('rejects an exponent without digits at the token start and accepts signed exponents', () => {
    // [ Vector2( is 11 characters, so the token starts at index 11.
    for (const token of ['1e', '1e+', '1e-', '1.5e-', '1E', '1E+']) {
      expect(fmtErr(`[ Vector2( ${token}, 2 ) ]`), token).toMatchObject({ code: 'FORMAT', offset: 11 });
    }
    expect(Array.from(parsePoints('[ Vector2( 1e+5, 1.5E-1 ) ]'))).toEqual([100000, Math.fround(0.15)]);
  });

  it('applies the text length limit with a strict greater-than', () => {
    expect(fmtErr('x'.repeat(POINTS_LIMITS.maxTextLength))).toMatchObject({ code: 'FORMAT', offset: 0 });
    expect(fmtErr('x'.repeat(POINTS_LIMITS.maxTextLength + 1))).toMatchObject({ code: 'LIMIT', offset: 0 });
  });

  it('reports LIMIT only for a point that really starts beyond maxPoints', () => {
    const unit = 'Vector2(1,2),';
    // Exactly maxPoints points parse.
    const exact = `[${unit.repeat(POINTS_LIMITS.maxPoints - 1)}Vector2(1,2)]`;
    expect(exact.length).toBeLessThan(POINTS_LIMITS.maxTextLength);
    expect(parsePoints(exact).length).toBe(POINTS_LIMITS.maxPoints * 2);
    // A stray comma after the last allowed point is a grammar error at the ], not a limit.
    const strayComma = `[${unit.repeat(POINTS_LIMITS.maxPoints)}]`;
    expect(fmtErr(strayComma)).toMatchObject({ code: 'FORMAT', offset: strayComma.length - 1 });
    // The first point beyond the maximum is the limit, at the offset where it starts.
    const excess = `[${unit.repeat(POINTS_LIMITS.maxPoints)}Vector2(1,2)]`;
    expect(fmtErr(excess)).toMatchObject({ code: 'LIMIT', offset: 1 + unit.length * POINTS_LIMITS.maxPoints });
  });

  it('formats values that need more than 20 decimals, up to the 40 decimal bound', () => {
    const tiny30 = Math.fround(1e-30);
    const tiny40 = Math.fround(1e-40);
    const text = formatPoints(f(tiny30, tiny40));
    expect(text).toBe(`[ Vector2( 0.${'0'.repeat(29)}1, 0.${'0'.repeat(39)}1 ) ]`);
    const back = parsePoints(text);
    expect(back[0]).toBe(tiny30);
    expect(back[1]).toBe(tiny40);
  });

  it('parses a value it cannot print: no fixed-notation form within 40 decimals', () => {
    const tiny41 = Math.fround(1e-41);
    expect(parsePoints('[ Vector2( 0, 1e-41 ) ]')[1]).toBe(tiny41);
    expect(fmtErrOf(() => formatPoints(f(0, tiny41)))).toMatchObject({ code: 'FORMAT', offset: 1 });
  });
});
