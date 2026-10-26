import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Detect a usable MSVC + Windows SDK environment, not merely a cl.exe on PATH.
 * PowerShell commonly finds cl.exe without initializing INCLUDE and LIB.
 * The injectable fileExists keeps this check unit-testable off Windows.
 */
export function hasMsvcBuildEnvironment(env, fileExists = existsSync) {
  const includes = (env.INCLUDE ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const libraries = (env.LIB ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  return includes.some((dir) => fileExists(path.win32.join(dir, 'windows.h'))) &&
    includes.some((dir) => fileExists(path.win32.join(dir, 'vector'))) &&
    libraries.some((dir) => fileExists(path.win32.join(dir, 'kernel32.lib'))) &&
    libraries.some((dir) => fileExists(path.win32.join(dir, 'libcmt.lib')));
}
