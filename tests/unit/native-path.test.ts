import { describe, expect, it } from 'vitest';
import { isNativeAbsolutePath } from '../../electron/native-path.ts';
import { vcvarsCommand } from '../../scripts/msvc-environment.mjs';

describe('canonical native absolute path policy', () => {
  it.each([
    'C:\\',
    'C:\\Users\\Example\\Maps\\world.wonderdraft_map',
    'e:\\Games\\Wonderdraft\\Wonderdraft.pck',
    'D:\\non-ascii-é-ü-ß\\🗺️.json',
    'Z:\\with spaces\\a%2eb.json',
    'C:\\.hidden\\nested',
  ])('accepts explicit normalized drive paths: %s', (value) => {
    expect(isNativeAbsolutePath(value, 'win32')).toBe(true);
  });

  it.each([
    '',
    '/',
    '/home/u/maps/world.json',
    'relative\\world.json',
    'C:world.json',
    'C:',
    'C:/Users/Example/world.json',
    '\\\\server\\share\\world.json',
    '\\\\?\\C:\\world.json',
    '\\\\.\\C:\\world.json',
    'C:\\\\world.json',
    'C:\\a\\.\\world.json',
    'C:\\a\\..\\world.json',
    'C:\\a\\..',
    'C:\\a\\',
    'C:\\a.\\world.json',
    'C:\\a \\world.json',
    'C:\\assets\\CON.json',
    'C:\\assets\\NUL',
    'C:\\assets\\COM1.png',
    'C:\\assets\\LPT9.txt',
    'C:\\assets\\CONIN$',
    'C:\\assets\\COM¹.txt',
    'C:\\assets\\world.json:secret',
    'C:\\assets\\star*.json',
    'C:\\assets\\quest?.json',
    'C:\\assets\\tab\\bad\tfile.json',
    'C:\\assets\\bad\0file.json',
    'C:\\assets\\bad' + String.fromCharCode(0xd800) + '.json',
    'C:\\assets\\bad' + String.fromCharCode(0xdc00) + '.json',
  ])('rejects dangerous or ambiguous Windows paths: %s', (value) => {
    expect(isNativeAbsolutePath(value, 'win32')).toBe(false);
  });

  it('enforces the length boundary and avoids user-defined coercion', () => {
    expect(isNativeAbsolutePath('C:\\' + 'a'.repeat(4093), 'win32')).toBe(true);
    expect(isNativeAbsolutePath('C:\\' + 'a'.repeat(4094), 'win32')).toBe(false);
    for (const input of [null, undefined, [], {}, 5, new String('C:\\x')]) {
      expect(isNativeAbsolutePath(input, 'win32')).toBe(false);
    }
    expect(isNativeAbsolutePath({ toString: () => { throw new Error('coercion'); } }, 'win32')).toBe(false);
  });

  it('retains the original POSIX normalization contract exactly', () => {
    for (const good of ['/', '/a', '/a/', '/with spaces/f.json', '/colon:name.json', '/back\\slash.json']) {
      expect(isNativeAbsolutePath(good, 'linux')).toBe(true);
    }
    for (const bad of ['', 'a', 'C:\\file.json', '//a', '/a//b', '/a/./b', '/a/../b', '/bad\0.json']) {
      expect(isNativeAbsolutePath(bad, 'linux')).toBe(false);
    }
  });
});

describe('Windows native-helper build command', () => {
  const vcvars = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\VC\\vcvars64.bat';
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const verify = 'E:\\Georama Workspace\\scripts\\check.mjs';

  it('keeps standard spaced and parenthesized MSVC paths quoted', () => {
    const command = vcvarsCommand(vcvars, node, verify, ['/nologo']);
    expect(command.command).toBe('cmd.exe');
    expect(command.args[2]).toContain(`call "${vcvars}" >nul`);
    expect(command.options).toEqual({ windowsVerbatimArguments: true });
  });

  it.each(['%', '!', '^', '&', '|', '<', '>', '"', '\r', '\n', '\0'])(
    'rejects shell expansion or control character %j in command arguments',
    (character) => {
      expect(() => vcvarsCommand(vcvars + character, node, verify, ['/nologo'])).toThrow(TypeError);
      expect(() => vcvarsCommand(vcvars, node + character, verify, ['/nologo'])).toThrow(TypeError);
      expect(() => vcvarsCommand(vcvars, node, verify + character, ['/nologo'])).toThrow(TypeError);
      expect(() => vcvarsCommand(vcvars, node, verify, ['/nologo' + character])).toThrow(TypeError);
    },
  );
});
