// Windows-only helper build. No changes to the normal npm build or Linux gates.
// Uses the VS Developer shell if active, otherwise discovers VS Build Tools.
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('Windows native helper requires Windows and MSVC');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'out', 'windows');
mkdirSync(output, { recursive: true });

const source = path.join(root, 'native', 'win-asset-read.cpp');
const exe = path.join(output, 'georama-win-asset-read.exe');
const object = path.join(output, 'win-asset-read.obj');
const args = [
  '/nologo', '/std:c++17', '/EHsc', '/W4', '/WX', '/O2', '/utf-8',
  '/D_WIN32_WINNT=0x0602', '/DUNICODE', '/D_UNICODE',
  '/Fo' + object, '/Fe' + exe, source,
];

function run(command, a) {
  const result = spawnSync(command, a, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) {
    console.error('Compiler process failed: ' + result.error.code);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const compiler = spawnSync('where.exe', ['cl.exe'], { encoding: 'utf8', windowsHide: true });
if (compiler.status === 0) {
  run('cl.exe', args);
} else {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) {
    console.error('MSVC not found. Install Visual Studio 2022 C++ Build Tools (x64) or run from Developer PowerShell.');
    process.exit(1);
  }
  const probe = spawnSync(vswhere, [
    '-latest', '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ], { encoding: 'utf8', windowsHide: true });
  const install = probe.status === 0 ? probe.stdout.trim() : '';
  const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!install || !existsSync(vcvars)) {
    console.error('No Visual Studio x64 C++ toolchain found.');
    process.exit(1);
  }
  const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
  const command = 'call ' + quote(vcvars) + ' >nul && cl ' + args.map(quote).join(' ');
  run('cmd.exe', ['/d', '/s', '/c', command]);
}
if (!existsSync(exe)) {
  console.error('MSVC did not produce the helper executable');
  process.exit(1);
}
console.log('Built Windows read-only asset helper under out/windows/');
