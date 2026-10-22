export const THEME_REF_LIMITS: Readonly<{ maxChars: number; maxSegments: number; maxSegmentBytes: number }> =
  Object.freeze({ maxChars: 512, maxSegments: 16, maxSegmentBytes: 255 });

export type ThemeRefErrorCode = 'TYPE' | 'EMPTY' | 'TOO_LONG' | 'CHARACTER' | 'SCHEME' | 'SEGMENT' | 'EXTENSION';

export class ThemeRefError extends Error {
  readonly code: ThemeRefErrorCode;
  constructor(code: ThemeRefErrorCode, message: string) {
    super(message);
    this.name = 'ThemeRefError';
    this.code = code;
  }
}

export type ThemeRef =
  | Readonly<{ source: 'pck'; path: string }>
  | Readonly<{ source: 'user'; path: string }>;

function hasOnlyAllowedChars(text: string): boolean {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          i += 2;
          continue;
        }
      }
      return false;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false;
    if (c < 0x20) return false;
    if (c >= 0x7f && c <= 0x9f) return false;
    if (c === 0x5c) return false;
    if (c === 0x2028 || c === 0x2029) return false;
    if (c >= 0x202a && c <= 0x202e) return false;
    if (c >= 0x2066 && c <= 0x2069) return false;
    if (c === 0xfeff || c === 0xfffe || c === 0xffff) return false;
    i += 1;
  }
  return true;
}

const RES_PREFIX = 'res://';
const USER_PREFIX = 'user://';
const THEME_SUFFIX = '.wonderdraft_theme';

const segmentEncoder = new TextEncoder();

export function resolveThemeRef(reference: string): ThemeRef {
  if (typeof reference !== 'string') {
    throw new ThemeRefError('TYPE', 'theme reference must be a string');
  }
  if (reference.length === 0) {
    throw new ThemeRefError('EMPTY', 'theme reference must not be empty');
  }
  if (reference.length > THEME_REF_LIMITS.maxChars) {
    throw new ThemeRefError('TOO_LONG', 'theme reference is too long');
  }
  if (!hasOnlyAllowedChars(reference)) {
    throw new ThemeRefError('CHARACTER', 'theme reference has invalid characters');
  }
  // Exact lowercase scheme dispatch; the remainder is validated below.
  let source: 'pck' | 'user';
  let remainder: string;
  if (reference.startsWith(RES_PREFIX)) {
    source = 'pck';
    remainder = reference.slice(RES_PREFIX.length);
  } else if (reference.startsWith(USER_PREFIX)) {
    source = 'user';
    remainder = reference.slice(USER_PREFIX.length);
  } else {
    throw new ThemeRefError('SCHEME', 'unsupported theme reference scheme');
  }
  if (remainder.length === 0) throw new ThemeRefError('SEGMENT', 'invalid theme reference path');
  const segments = remainder.split('/');
  if (segments.length > THEME_REF_LIMITS.maxSegments) {
    throw new ThemeRefError('SEGMENT', 'too many path segments');
  }
  for (const seg of segments) {
    if (seg.length === 0) throw new ThemeRefError('SEGMENT', 'invalid theme reference path');
    if (seg === '.' || seg === '..') throw new ThemeRefError('SEGMENT', 'invalid theme reference path');
    if (seg.charCodeAt(0) === 0x2e) throw new ThemeRefError('SEGMENT', 'invalid theme reference path');
    if (segmentEncoder.encode(seg).length > THEME_REF_LIMITS.maxSegmentBytes) {
      throw new ThemeRefError('SEGMENT', 'path segment is too long');
    }
  }
  // Exact case-sensitive suffix; never appended or stripped.
  if (!reference.endsWith(THEME_SUFFIX)) {
    throw new ThemeRefError('EXTENSION', 'theme reference must end with .wonderdraft_theme');
  }
  if (source === 'pck') return Object.freeze({ source, path: reference }) as ThemeRef;
  return Object.freeze({ source, path: remainder }) as ThemeRef;
}
