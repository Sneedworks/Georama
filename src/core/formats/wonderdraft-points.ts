/** Text codec for the Godot `var2str` of an Array of Vector2 (path/territory `points` strings).
 * `parsePoints` is a strict single linear pass over UTF-16 code units: no regular
 * expressions, no `split`, no per-point substrings beyond one slice per number token
 * (the token slices partition the input, so total work stays linear). The output
 * buffer starts small and doubles, capped by the point limit; the returned array is
 * always exactly 2*points long. `formatPoints` emits the shortest fixed-notation
 * decimal per float32 that reads back to the same bits (`0` for zero), which is what
 * Godot's writer produces for these strings.
 * The two directions are not symmetric: `formatPoints` throws FORMAT for a float32 that has
 * no fixed-notation decimal of at most 40 digits after the point (tiny subnormals) or whose
 * magnitude is 1e21 or more, although `parsePoints` accepts such a value. A caller that
 * rewrites a points text therefore keeps the original text of every record it did not edit.
 */
export type WdPointsErrorCode = 'FORMAT' | 'LIMIT';
export class WdPointsError extends Error {
  readonly code: WdPointsErrorCode;
  readonly offset: number;
  constructor(code: WdPointsErrorCode, offset: number, detail = '') {
    super(`${code} at ${offset}: ${detail}`);
    this.name = 'WdPointsError';
    this.code = code;
    this.offset = offset;
  }
}
export const POINTS_LIMITS = { maxTextLength: 16777216, maxPoints: 1000000 } as const;

const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
const COMMA = 44;
const MINUS = 45;
const PLUS = 43;
const DOT = 46;
const E_LOWER = 101;
const E_UPPER = 69;

function isWs(c: number): boolean {
  return c === 32 || c === 9 || c === 13 || c === 10;
}

function isDelim(c: number): boolean {
  return c === COMMA || c === OPEN_PAREN || c === CLOSE_PAREN || c === OPEN_BRACKET || c === CLOSE_BRACKET;
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function parsePoints(text: string): Float32Array {
  const n = text.length;
  if (n > POINTS_LIMITS.maxTextLength) throw new WdPointsError('LIMIT', 0, 'text exceeds maxTextLength');
  let i = 0;
  const skipWs = (): void => {
    while (i < n && isWs(text.charCodeAt(i))) i++;
  };
  const fail = (offset: number, detail: string): never => {
    throw new WdPointsError('FORMAT', offset, detail);
  };
  const atEnd = (detail: string): never => fail(n, detail);
  /** Check the literal keyword `Vector2` at the cursor without slicing. */
  const atKeyword = (): boolean => {
    return i + 7 <= n &&
      text.charCodeAt(i) === 86 &&
      text.charCodeAt(i + 1) === 101 &&
      text.charCodeAt(i + 2) === 99 &&
      text.charCodeAt(i + 3) === 116 &&
      text.charCodeAt(i + 4) === 111 &&
      text.charCodeAt(i + 5) === 114 &&
      text.charCodeAt(i + 6) === 50;
  };
  /** Parse one NUM token at the cursor; errors point at the token start. */
  const parseNum = (): number => {
    const start = i;
    let j = start;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isWs(c) || isDelim(c)) break;
      j++;
    }
    let k = start;
    if (k < j && text.charCodeAt(k) === MINUS) k++;
    const intStart = k;
    while (k < j && isDigit(text.charCodeAt(k))) k++;
    if (k === intStart) fail(start, 'bad number');
    if (k < j && text.charCodeAt(k) === DOT) {
      k++;
      const fracStart = k;
      while (k < j && isDigit(text.charCodeAt(k))) k++;
      if (k === fracStart) fail(start, 'bad number');
    }
    if (k < j && (text.charCodeAt(k) === E_LOWER || text.charCodeAt(k) === E_UPPER)) {
      k++;
      if (k < j && (text.charCodeAt(k) === PLUS || text.charCodeAt(k) === MINUS)) k++;
      const expStart = k;
      while (k < j && isDigit(text.charCodeAt(k))) k++;
      if (k === expStart) fail(start, 'bad number');
    }
    if (k !== j) fail(start, 'bad number');
    const v = Math.fround(Number(text.slice(start, j)));
    if (!Number.isFinite(v)) fail(start, 'non-finite float32');
    i = j;
    return v;
  };
  const expectChar = (c: number, detail: string): void => {
    if (i >= n) atEnd(detail);
    if (text.charCodeAt(i) !== c) fail(i, detail);
    i++;
  };
  let cap = 16;
  let out = new Float32Array(cap);
  let len = 0;
  const push = (v: number): void => {
    if (len === cap) {
      cap = cap >= POINTS_LIMITS.maxPoints * 2 ? cap + 2 : Math.min(cap * 2, POINTS_LIMITS.maxPoints * 2);
      const next = new Float32Array(cap);
      next.set(out);
      out = next;
    }
    out[len++] = v;
  };

  skipWs();
  if (i >= n) atEnd('expected [');
  if (text.charCodeAt(i) !== OPEN_BRACKET) fail(i, 'expected [');
  i++;
  skipWs();
  if (i < n && text.charCodeAt(i) === CLOSE_BRACKET) {
    i++;
    skipWs();
    if (i !== n) fail(i, 'trailing text after ]');
    return new Float32Array(0);
  }
  let points = 0;
  for (;;) {
    const pointStart = i;
    if (i >= n) atEnd('expected Vector2');
    if (!atKeyword()) fail(i, 'expected Vector2');
    // The limit is about a point that really starts here: a stray comma before the
    // closing bracket stays a grammar error (FORMAT), as rule P5 of the card says.
    if (points >= POINTS_LIMITS.maxPoints) throw new WdPointsError('LIMIT', pointStart, 'too many points');
    i += 7;
    skipWs();
    expectChar(OPEN_PAREN, 'expected (');
    skipWs();
    const x = parseNum();
    skipWs();
    expectChar(COMMA, 'expected ,');
    skipWs();
    const y = parseNum();
    skipWs();
    expectChar(CLOSE_PAREN, 'expected )');
    push(x);
    push(y);
    points++;
    skipWs();
    if (i >= n) atEnd('expected , or ]');
    const c = text.charCodeAt(i);
    if (c === COMMA) {
      i++;
      skipWs();
      continue;
    }
    if (c === CLOSE_BRACKET) {
      i++;
      skipWs();
      if (i !== n) fail(i, 'trailing text after ]');
      return out.slice(0, len);
    }
    fail(i, 'expected , or ]');
  }
}

/** Shortest fixed-notation decimal of a float32 that reads back to the same bits. */
function numText(v: number): string | undefined {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1e21) return undefined;
  for (let d = 0; d <= 40; d++) {
    const t = v.toFixed(d);
    if (Math.fround(Number(t)) === v) return t;
  }
  return undefined;
}

export function formatPoints(values: Float32Array): string {
  if (values.length % 2 === 1) throw new WdPointsError('FORMAT', values.length - 1, 'odd value count');
  const count = values.length / 2;
  if (count > POINTS_LIMITS.maxPoints) throw new WdPointsError('LIMIT', POINTS_LIMITS.maxPoints * 2, 'too many points');
  if (count === 0) return '[  ]';
  const parts = new Array<string>(count);
  for (let p = 0; p < count; p++) {
    const x = values[p * 2];
    const y = values[p * 2 + 1];
    if (!Number.isFinite(x)) throw new WdPointsError('FORMAT', p * 2, 'non-finite value');
    if (!Number.isFinite(y)) throw new WdPointsError('FORMAT', p * 2 + 1, 'non-finite value');
    const xt = numText(x);
    if (xt === undefined) throw new WdPointsError('FORMAT', p * 2, 'no fixed-notation form');
    const yt = numText(y);
    if (yt === undefined) throw new WdPointsError('FORMAT', p * 2 + 1, 'no fixed-notation form');
    parts[p] = 'Vector2( ' + xt + ', ' + yt + ' )';
  }
  return '[ ' + parts.join(', ') + ' ]';
}
