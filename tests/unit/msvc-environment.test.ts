import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasMsvcBuildEnvironment } from '../../scripts/msvc-environment.mjs';

const vcInclude = 'C:\\VS\\VC\\include';
const sdkInclude = 'C:\\Windows Kits\\10\\Include\\um';
const vcLib = 'C:\\VS\\VC\\lib\\x64';
const sdkLib = 'C:\\Windows Kits\\10\\Lib\\um\\x64';
const complete = {
  INCLUDE: [vcInclude, sdkInclude].join(';'),
  LIB: [vcLib, sdkLib].join(';'),
};
const completeFiles = new Set([
  path.win32.join(vcInclude, 'vector'),
  path.win32.join(sdkInclude, 'windows.h'),
  path.win32.join(vcLib, 'libcmt.lib'),
  path.win32.join(sdkLib, 'kernel32.lib'),
]);

describe('MSVC build environment readiness (host-independent)', () => {
  const exists = (candidate: string): boolean => completeFiles.has(candidate);

  it('accepts a fully initialized compiler and Windows SDK environment', () => {
    expect(hasMsvcBuildEnvironment(complete, exists)).toBe(true);
  });
  it('rejects cl.exe-on-PATH-only environments without INCLUDE or LIB', () => {
    expect(hasMsvcBuildEnvironment({}, exists)).toBe(false);
    expect(hasMsvcBuildEnvironment({ INCLUDE: '', LIB: '' }, exists)).toBe(false);
  });
  it('rejects an SDK-less MSVC environment even if standard C++ headers work', () => {
    const files = new Set(completeFiles);
    files.delete(path.win32.join(sdkInclude, 'windows.h'));
    expect(hasMsvcBuildEnvironment(complete, (v: string) => files.has(v))).toBe(false);
  });
  it('rejects incomplete C++ headers even when Windows SDK is present', () => {
    const files = new Set(completeFiles);
    files.delete(path.win32.join(vcInclude, 'vector'));
    expect(hasMsvcBuildEnvironment(complete, (v: string) => files.has(v))).toBe(false);
  });
  it.each(['libcmt.lib', 'kernel32.lib'])('rejects absent %s libraries', (name) => {
    const files = new Set(completeFiles);
    const folder = name === 'libcmt.lib' ? vcLib : sdkLib;
    files.delete(path.win32.join(folder, name));
    expect(hasMsvcBuildEnvironment(complete, (v: string) => files.has(v))).toBe(false);
  });
  it('ignores empty include/library path entries', () => {
    expect(hasMsvcBuildEnvironment({
      INCLUDE: ';' + complete.INCLUDE + ';;',
      LIB: ';' + complete.LIB + ';',
    }, exists)).toBe(true);
  });
});
