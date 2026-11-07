// Windows-only MSVC helper build; the ordinary cross-platform npm build stays
// independent of a local Windows compiler and never substitutes JS path opens.
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasMsvcBuildEnvironment, vcvarsCommand } from './msvc-environment.mjs';

if (process.platform !== 'win32') {
  console.error('Windows selected-file helper requires Windows and MSVC');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'out', 'windows');
mkdirSync(output, { recursive: true });

const source = path.join(root, 'native', 'win-selected-read.cpp');
const exe = path.join(output, 'georama-win-selected-read.exe');
const object = path.join(output, 'win-selected-read.obj');
const args = [
  '/nologo', '/std:c++17', '/EHsc', '/W4', '/WX', '/O2', '/utf-8',
  '/D_WIN32_WINNT=0x0602', '/DUNICODE', '/D_UNICODE',
  '/Fo' + object, '/Fe' + exe, source,
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: 'inherit', windowsHide: true, ...options,
  });
  if (result.error) {
    console.error('Could not start native compiler: ' + result.error.code);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error('Native helper compilation failed. Install MSVC and Windows SDK.');
    process.exit(result.status ?? 1);
  }
}

function failToolchain(message) {
  console.error(message);
  console.error('Install Visual Studio Desktop development with C++ and Windows 10/11 SDK.');
  process.exit(1);
}

// Stale binaries must never make a broken build appear to pass a security gate.
rmSync(exe, { force: true });
const compiler = spawnSync('where.exe', ['cl.exe'], { encoding: 'utf8', windowsHide: true });
if (compiler.status === 0 && hasMsvcBuildEnvironment(process.env)) {
  run('cl.exe', args);
} else {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) failToolchain('Visual Studio Installer vswhere.exe was not found.');
  const probe = spawnSync(vswhere, [
    '-latest', '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8', windowsHide: true });
  const install = probe.status === 0 ? probe.stdout.trim() : '';
  if (!install) failToolchain('No installed Visual Studio C++ toolchain was found.');
  const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!existsSync(vcvars)) failToolchain('Visual Studio is missing vcvars64.bat.');
  const verify = path.join(root, 'scripts', 'check-msvc-environment.mjs');
  const setup = vcvarsCommand(vcvars, process.execPath, verify, args);
  run(setup.command, setup.args, setup.options);
}
if (!existsSync(exe)) failToolchain('Compiler completed without producing the helper.');
console.log('Built native Windows selected-file reader under out/windows/');
