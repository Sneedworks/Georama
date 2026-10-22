import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function processesUsing(directory) {
  const matches = [];
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const args = (await readFile(`/proc/${entry}/cmdline`, 'utf8')).split('\0');
      if (args.some((arg) => arg.includes(directory))) matches.push(Number(entry));
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH' && error.code !== 'EACCES') throw error;
    }
  }
  return matches;
}

async function exists(directory) {
  try { await stat(directory); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function until(probe, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function checkSignal(signal, expectedCode) {
  let launch;
  let ready = false;
  let status;
  let output = '';
  const harness = spawn(process.execPath, [path.join(root, 'tests/e2e/smoke.mjs')], {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  harness.once('error', (error) => { status = { error: error.message }; });
  harness.once('exit', (code, exitSignal) => { status = { code, signal: exitSignal }; });
  harness.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    output += String(chunk);
    for (;;) {
      const newline = output.indexOf('\n');
      if (newline < 0) break;
      const line = output.slice(0, newline);
      output = output.slice(newline + 1);
      if (line.startsWith('LAUNCH ')) launch = JSON.parse(line.slice(7));
      if (line.startsWith('READY ')) { launch = JSON.parse(line.slice(6)); ready = true; }
    }
  });
  try {
    await until(() => {
      assert.equal(status, undefined, `harness exited before READY: ${JSON.stringify(status)}`);
      return ready;
    }, 'app READY marker', 40_000);
    assert.ok(path.basename(launch.temporaryDirectory).startsWith('georama-e2e-'));
    assert.equal(await exists(launch.temporaryDirectory), true, 'positive control: profile exists while app is up');
    assert.ok((await processesUsing(launch.temporaryDirectory)).length > 0, 'positive control: /proc scan sees the running app');
    console.log(`PASS ${signal}: READY, live profile and process-scan positive controls`);
    assert.equal(harness.kill(signal), true, `send ${signal} to the harness`);
    await until(() => status, 'harness exit');
    const remaining = await processesUsing(launch.temporaryDirectory);
    const directoryExists = await exists(launch.temporaryDirectory);
    console.log(`RESULT ${signal}: ${JSON.stringify({ ...status, remaining, directoryExists })}`);
    assert.deepEqual(remaining, [], 'no process command line mentions the temporary user-data directory');
    console.log(`PASS ${signal}: no process retains the temporary user-data directory`);
    assert.equal(directoryExists, false, 'temporary user-data directory removed');
    console.log(`PASS ${signal}: temporary user-data directory removed`);
    assert.deepEqual(status, { code: expectedCode, signal: null }, '128 + signal number exit status');
    console.log(`PASS ${signal}: exit status ${expectedCode}`);
  } finally {
    // A failing regression test must not itself leave the deliberately leaked app running.
    if (!status) {
      harness.kill('SIGTERM');
      try { await until(() => status, 'emergency harness exit', 5_000); }
      catch { harness.kill('SIGKILL'); await until(() => status, 'forced harness exit', 5_000); }
    }
    if (launch) {
      try { process.kill(-launch.launcherPid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      await until(async () => (await processesUsing(launch.temporaryDirectory)).length === 0, 'emergency process cleanup');
      await rm(launch.temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

try {
  for (const [signal, code] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
    await checkSignal(signal, code);
  }
  console.log('CLEANUP: 3/3 signals passed (SIGHUP, SIGINT, SIGTERM)');
} catch (error) {
  console.error(`FAIL cleanup regression: ${error.stack ?? error.message}`);
  process.exitCode = 1;
}
