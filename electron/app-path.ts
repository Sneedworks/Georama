import path from 'node:path';

/** Decode once, rejecting ambiguous paths before joining the renderer root. */
export function resolveAppPath(rootDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded === '/' || decoded === '' ? ['index.html'] : decoded.split('/');
  if (segments.some((segment) => segment === '..' || segment.includes('%'))) return null;
  const result = path.join(rootDir, ...segments.filter((segment) => segment !== '' && segment !== '.'));
  return result === rootDir || result.startsWith(rootDir + path.sep) ? result : null;
}
