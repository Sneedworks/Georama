import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, launchApp, rootDir, targetAt } from './harness.mjs';

// The ten GPU case names printed by tests/gpu/*.ts. Exit code is 0 only when
// every one of these was seen and none failed.
const EXPECTED_CASES = [
  'context: attributes',
  'context: loss and restore',
  'caps: real GPU',
  'caps: required formats',
  'checkGl',
  'shader: compile, link, uniforms',
  'texture: create and upload',
  'budget',
  'fbo: completeness and errors',
  'readback: end-to-end render',
  'sdf: 1x1 water',
  'sdf: 4x4 all land',
  'sdf: 5x3 all water',
  'sdf: 7x1 row',
  'sdf: 1x6 column',
  'sdf: 4x3 hand example',
  'sdf: 9x7 two islands',
  'sdf: 8x8 checkerboard',
  'sdf: 64x48 seeded',
  'sdf: refusals and limits',
];

let app;
let cancelled = false;
let settled = false;
let finalCode = 0;
let overallTimeout = null;
let hardExitTimer = null;

// First settlement wins, except a 0 may still be upgraded to non-zero
// (e.g. cleanup failure after a passing run). A non-zero status — timeout,
// bundle error, signal — is therefore sticky and can never be overwritten
// by a late success.
function settle(code) {
  if (!settled) {
    settled = true;
    finalCode = code;
  } else if (finalCode === 0 && code !== 0) {
    finalCode = code;
  }
  process.exitCode = finalCode;
}

// The app currently owned by the runner, if any. Taking it (and clearing the
// slot) makes cleanup idempotent: whoever cleans first owns the instance,
// every later call is a no-op.
async function cleanupCurrent() {
  const owned = app;
  app = null;
  if (!owned) return;
  try {
    await owned.shutdown();
  } catch (error) {
    console.log(`FAIL cleanup: ${error.stack ?? error.message}`);
    settle(1);
  }
  process.exitCode = finalCode;
}

function armHardExit() {
  if (hardExitTimer) return;
  // Backstop only: every await in the main flow is bounded and cleanup
  // closes the connections that unblock a hanging evaluate, so this timer
  // should never fire. It is unref'd so it cannot hold the loop open on its
  // own; it only forces the process out if something else still does.
  hardExitTimer = setTimeout(() => {
    process.exit(finalCode);
  }, 10_000);
  hardExitTimer.unref?.();
}

// Main-flow finish: report, settle the sticky status, stop the timeout,
// clean the owned app, and leave process.exitCode set for a natural exit.
async function shutdownAndExit(code, message) {
  if (message) console.log(message);
  cancelled = true;
  settle(code);
  if (overallTimeout) {
    clearTimeout(overallTimeout);
    overallTimeout = null;
  }
  if (hardExitTimer) {
    clearTimeout(hardExitTimer);
    hardExitTimer = null;
  }
  await cleanupCurrent();
  process.exitCode = finalCode;
}

// Timeout/signal path: mark cancellation, keep the sticky status, clean
// whatever app is currently owned (closing its connections unblocks a
// hanging evaluate), and arm the hard-exit backstop. This never exits
// directly: the main flow owns any late-resolving launch at its next
// boundary check and exits there, so a late child can never be orphaned.
async function cancelWithoutExit(code, message) {
  if (cancelled) return;
  if (message) console.log(message);
  cancelled = true;
  settle(code);
  if (overallTimeout) {
    clearTimeout(overallTimeout);
    overallTimeout = null;
  }
  armHardExit();
  await cleanupCurrent();
}

// 128 + signal number. ALWAYS shut down, also on exceptions and signals.
for (const [signal, exitCode] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    void cancelWithoutExit(exitCode, null);
  });
}

overallTimeout = setTimeout(() => {
  void cancelWithoutExit(1, 'FAIL harness: 180 s overall timeout');
}, 180_000);

async function main() {
  const root = rootDir();
  const sdfSizes = process.env.GEORAMA_SDF_TIMING_SIZES ?? '';
  let sdfSizesValue = null;
  if (sdfSizes !== '') {
    let valid = /^\d+x\d+(,\d+x\d+)*$/.test(sdfSizes);
    if (valid) {
      for (const part of sdfSizes.split(',')) {
        const [w, h] = part.split('x').map(Number);
        if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1 || w > 16384 || h > 16384) {
          valid = false;
          break;
        }
      }
    }
    if (!valid) {
      await shutdownAndExit(1, `FAIL harness: invalid GEORAMA_SDF_TIMING_SIZES ${JSON.stringify(sdfSizes)}`);
      return;
    }
    sdfSizesValue = sdfSizes;
  }
  let bundle;
  try {
    const result = await build({
      entryPoints: [path.join(root, 'tests/gpu/index.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'GeoramaGpuTests',
      platform: 'browser',
      target: 'es2022',
      write: false,
    });
    bundle = result.outputFiles[0].text;
  } catch (error) {
    await shutdownAndExit(1, `FAIL bundle: could not bundle tests/gpu/index.ts: ${error.message}`);
    return;
  }
  // The bundle may have resolved after cancellation: never launch then.
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }

  try {
    app = await launchApp();
  } catch (error) {
    await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
    return;
  }
  // The launch may have resolved after cancellation (timeout or signal fired
  // while it was in flight): the late child is now owned here and must be
  // cleaned, and the sticky status must survive.
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }
  const { child, temporaryDirectory, connections, rendererPort, shutdown } = app;
  app.shutdown = shutdown;
  console.log(`LAUNCH ${JSON.stringify({ temporaryDirectory, launcherPid: child.pid })}`);

  let pageTarget;
  try {
    pageTarget = await targetAt(
      rendererPort,
      (target) => target.type === 'page' && target.url.startsWith('georama://app/'),
      child,
    );
  } catch (error) {
    await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }
  let page;
  try {
    page = await connect(pageTarget.webSocketDebuggerUrl, connections);
    await page.send('Runtime.enable');
  } catch (error) {
    await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !await page.evaluate(`document.readyState === 'complete'`)) {
    if (cancelled) {
      await shutdownAndExit(finalCode, null);
      return;
    }
    await delay(100);
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }

  const only = process.env.GEORAMA_GPU_ONLY ?? '';
  // The timing case runs all its passes inside this one evaluate; see docs/plans/2026-10-22-sdf-timing-card.md.
  const SDF_TIMING_TIMEOUT_MS = 300_000;
  const sdfEvalTimeoutMs = sdfSizesValue === null ? 10_000 : SDF_TIMING_TIMEOUT_MS;
  let report;
  try {
    report = await page.evaluate(`globalThis.__GEORAMA_SDF_SIZES__ = ${JSON.stringify(sdfSizesValue)};${bundle};GeoramaGpuTests.runAll(${JSON.stringify(only)})`, sdfEvalTimeoutMs);
  } catch (error) {
    await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
    return;
  }
  // The evaluation may have succeeded after cancellation: a late success
  // must neither print nor overwrite the sticky failure status.
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }

  console.log(`RENDERER ${report.renderer}`);
  for (const format of report.formats) {
    console.log(`FORMAT ${format.name} texture=${format.texture} renderable=${format.renderable} roundTrip=${format.roundTrip}`);
  }
  let passed = 0;
  let failed = 0;
  const seen = new Set();
  for (const result of report.results) {
    seen.add(result.name);
    if (result.ok) {
      passed += 1;
      console.log(`PASS ${result.name} (${result.ms} ms)`);
      if (typeof result.detail === 'string' && result.detail !== '') {
        console.log(`DETAIL ${result.detail}`);
      }
    } else {
      failed += 1;
      console.log(`FAIL ${result.name}: ${result.detail}`);
    }
  }
  console.log(`GPU CASES ${passed} passed, ${failed} failed`);
  if (only !== '') {
    // Filtered iteration run: pass when every executed case passed.
    await shutdownAndExit(failed === 0 && seen.size > 0 ? 0 : 1, null);
  } else {
    const missing = EXPECTED_CASES.filter((name) => !seen.has(name));
    if (missing.length > 0) console.log(`FAIL missing cases: ${missing.join(', ')}`);
    const defaultOk = failed === 0 && missing.length === 0;
    const firstlightDir = process.env.GEORAMA_FIRSTLIGHT_DIR ?? '';
    if (!defaultOk || firstlightDir === '') {
      await shutdownAndExit(defaultOk ? 0 : 1, null);
      return;
    }
    await runFirstLight(page, root);
  }
}

const FIRSTLIGHT_EVAL_TIMEOUT_MS = 120_000;

function firstlightCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Env-gated first-light phase: runs after the default suite passes in the
// same Electron instance. Reads the extracted window layers, draws them
// through the compositor at 1:1 and requires an exact CPU/GPU match.
async function runFirstLight(page, root) {
  const dir = process.env.GEORAMA_FIRSTLIGHT_DIR ?? '';
  let meta;
  let maskBytes;
  let groundBytes;
  let waterBytes;
  try {
    meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
    maskBytes = await readFile(path.join(dir, 'mask.rgba'));
    groundBytes = await readFile(path.join(dir, 'ground.rgba'));
    waterBytes = await readFile(path.join(dir, 'water.rgba'));
  } catch {
    await shutdownAndExit(1, 'FAIL firstlight: unreadable input');
    return;
  }
  const width = firstlightCount(typeof meta === 'object' && meta !== null ? meta.width : undefined);
  const height = firstlightCount(typeof meta === 'object' && meta !== null ? meta.height : undefined);
  const threshold = firstlightCount(typeof meta === 'object' && meta !== null ? meta.threshold : undefined);
  if (width === null || width < 1 || height === null || height < 1 || threshold === null || threshold > 255) {
    await shutdownAndExit(1, 'FAIL firstlight: unreadable input');
    return;
  }
  if (
    maskBytes.length !== width * height * 4 ||
    groundBytes.length !== width * height * 4 ||
    waterBytes.length !== width * height * 4
  ) {
    await shutdownAndExit(1, 'FAIL firstlight: unreadable input');
    return;
  }
  let bundle;
  try {
    const result = await build({
      entryPoints: [path.join(root, 'tests/gpu/firstlight.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'GeoramaFirstLight',
      platform: 'browser',
      target: 'es2022',
      write: false,
    });
    bundle = result.outputFiles[0].text;
  } catch {
    await shutdownAndExit(1, 'FAIL firstlight: bundle error');
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }
  let report;
  try {
    const input = {
      width,
      height,
      threshold,
      mask: maskBytes.toString('base64'),
      ground: groundBytes.toString('base64'),
      water: waterBytes.toString('base64'),
    };
    report = await page.evaluate(
      `globalThis.__GEORAMA_FIRSTLIGHT_INPUT__ = ${JSON.stringify(input)};${bundle};GeoramaFirstLight.runFirstLight(globalThis.__GEORAMA_FIRSTLIGHT_INPUT__)`,
      FIRSTLIGHT_EVAL_TIMEOUT_MS,
    );
  } catch {
    await shutdownAndExit(1, 'FAIL firstlight: evaluate error');
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }
  const exact = firstlightCount(report?.exact);
  const total = firstlightCount(report?.total);
  const land = firstlightCount(report?.land);
  const water = firstlightCount(report?.water);
  const orientation = report?.orientation;
  const ms = typeof report?.ms === 'number' && Number.isFinite(report.ms) && report.ms >= 0 ? report.ms : null;
  if (
    exact === null ||
    total === null ||
    land === null ||
    water === null ||
    (orientation !== 'PASS' && orientation !== 'FAIL') ||
    ms === null
  ) {
    await shutdownAndExit(1, 'FAIL firstlight: unreadable result');
    return;
  }
  console.log(`FIRSTLIGHT exact=${exact}/${total} land=${land} water=${water} orientation=${orientation}`);
  const outDir = process.env.GEORAMA_FIRSTLIGHT_OUT ?? '';
  if (outDir !== '') {
    try {
      const { encodePngRgba8 } = await import('./firstlight-png.mjs');
      const rgba = Buffer.from(report.readbackBase64, 'base64');
      if (rgba.length !== width * height * 4) throw new Error('readback size');
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, 'firstlight-render.png'), encodePngRgba8(width, height, rgba));
      await writeFile(
        path.join(outDir, 'firstlight-report.json'),
        `${JSON.stringify({ exact, total, land, water, orientation, ms }, null, 2)}\n`,
      );
    } catch {
      await shutdownAndExit(1, 'FAIL firstlight: unreadable result');
      return;
    }
  }
  if (exact === total && orientation === 'PASS') {
    await shutdownAndExit(0, null);
  } else {
    await shutdownAndExit(1, `FAIL firstlight: exact=${exact}/${total} land=${land} water=${water} orientation=${orientation}`);
  }
}

try {
  await main();
} catch (error) {
  await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
}
