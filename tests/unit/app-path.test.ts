import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppPath } from '../../electron/app-path';

const root = path.resolve('/georama-renderer');

describe('resolveAppPath', () => {
  it.each([
    ['/', 'index.html'],
    ['', 'index.html'],
    ['/assets/a.js', 'assets/a.js'],
    ['//x/./y.css', 'x/y.css'],
    ['/assets/a%20b.js', 'assets/a b.js'],
  ])('resolves %s beneath the renderer root', (input, relative) => {
    expect(resolveAppPath(root, input)).toBe(path.join(root, relative));
  });

  it.each([
    '/../a',
    '/a/../../b',
    '/%2e%2e/a',
    '/%2E%2E/a',
    '/a%2f..%2f..%2fb',
    String.raw`/a\b`,
    '/a%5cb',
    '/a%00b',
    '/%E0%A4%A',
    '/%252e%252e/a',
    '/a%b',
    '/a%25b',
    '/a\u0000b',
  ])('rejects unsafe or ambiguous pathname %s', (input) => {
    expect(resolveAppPath(root, input)).toBeNull();
  });

  it('never treats a sibling with the same root prefix as inside the root', () => {
    expect(resolveAppPath(root, '/../georama-renderer-other/a')).toBeNull();
  });
});
