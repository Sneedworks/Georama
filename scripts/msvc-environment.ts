import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Check actual compiler AND Windows SDK include directories rather than just
 * whether cl.exe exists on PATH. A bare cl.exe often runs from PowerShell with
 * neither the SDK nor the MSVC standard library initialized.
 *
 * This function is pure with injectable fileExists so regression tests can
 * cover detection on Linux, without an installed Windows toolchain.
 */
export function hasMsvcBuildEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  fileExists: (file: string) => boolean = existsSync,
): boolean {
  const includes = (env['INCLUDE'] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  const libraries = (env['LIB'] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  return includes.some((dir) => fileExists(path.win32.join(dir, 'windows.h'))) &&
    includes.some((dir) => fileExists(path.win32.join(dir, 'vector'))) &&
    libraries.some((dir) => fileExists(path.win32.join(dir, 'kernel32.lib'))) &&
    libraries.some((dir) => fileExists(path.win32.join(dir, 'libcmt.lib')));
}
