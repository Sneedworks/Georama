/**
 * Minimal native-Windows Electron startup smoke test.
 *
 * Unlike the Linux E2E harness, this intentionally does not assume Unix
 * process groups, /proc, X11 or Wayland. It checks the real renderer, preload,
 * trusted IPC, and the custom app protocol through an isolated test profile.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, freePort, rootDir, targetAt } from './harness.mjs';

if (process.platform !== 'win32') {
  throw new Error('The native Windows startup smoke test must run under Windows');
}

const root = rootDir();
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'georama-win-launch-'));
const port = await freePort();
let child;
let page;

try {
  child = spawn(process.execPath, [
    path.join(root, 'scripts', 'run-electron.mjs'),
    '.',
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://127.0.0.1:${port}`,
    `--remote-debugging-address=127.0.0.1`,
    `--user-data-dir=${temporaryDirectory}`,
    '--disable-gpu',
  ], {
    cwd: root,
    env: { ...process.env, GEORAMA_E2E: '1', GEORAMA_DEVTOOLS: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (part) => {
    stderr = (stderr + String(part)).slice(-4096);
  });

  // Remove early-exit listeners after readiness; otherwise a normal app close
  // would reject the already-lost Promise.race branch as an unhandled rejection.
  let failStartup;
  const earlyFailure = new Promise((_, reject) => {
    failStartup = reject;
  });
  const onSpawnError = (error) => failStartup(error);
  const onEarlyExit = (code, signal) => failStartup(
    new Error(`Electron launcher exited before readiness (code=${code}, signal=${signal}): ${stderr}`),
  );
  child.once('error', onSpawnError);
  child.once('exit', onEarlyExit);
  let target;
  try {
    target = await Promise.race([
      targetAt(port, (entry) => entry.type === 'page' && entry.url.startsWith('georama://app/'), child),
      earlyFailure,
    ]);
  } finally {
    child.off('error', onSpawnError);
    child.off('exit', onEarlyExit);
  }
  page = await connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');

  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = await page.evaluate(
        `document.readyState === 'complete' &&
         document.querySelector('.app-info')?.textContent.includes('Electron')`,
      );
    } catch {
      // Electron may still be initializing the preload and renderer.
    }
    if (ready) break;
    await delay(100);
  }
  assert.equal(ready, true, 'welcome screen and preload failed to initialize');

  assert.equal(await page.evaluate('document.title'), "Ge'orama");
  assert.deepEqual(
    await page.evaluate('Object.keys(window.georama)'),
    ['getAppInfo'],
  );
  assert.equal(await page.evaluate('Object.isFrozen(window.georama)'), true);
  const info = await page.evaluate('window.georama.getAppInfo()');
  assert.equal(info.platform, 'win32');
  assert.equal(info.name, "Ge'orama");
  assert.equal(info.id, 'georama');
  assert.equal(info.e2e, true);
  assert.equal(await page.evaluate('typeof require'), 'undefined');
  assert.equal(await page.evaluate('typeof process'), 'undefined');

  // Verify the custom protocol is actually serving the renderer with its CSP.
  const csp = await page.evaluate(
    `fetch(location.href).then(response => response.headers.get('content-security-policy'))`,
  );
  assert.ok(csp?.includes("default-src 'none'"), 'missing deny-by-default CSP');

  console.log('PASS Windows native launcher, Electron renderer, preload IPC and app protocol');
} finally {
  // Browser.close requests a graceful Electron shutdown, which lets the
  // launcher reap it. A bounded Windows taskkill fallback prevents orphans.
  if (page) {
    try { await page.send('Browser.close', {}, 1500); } catch { /* browser may close first */ }
    try { page.close(); } catch { /* already disconnected */ }
  }
  if (child) {
    let exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited) {
      exited = await Promise.race([
        new Promise((resolve) => child.once('exit', () => resolve(true))),
        delay(3000).then(() => false),
      ]);
    }
    if (!exited && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true, timeout: 5000,
      });
    }
  }
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
