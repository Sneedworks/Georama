import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import { connect, launchApp, rootDir, targetAt } from './harness.mjs';

// Probe geometry mirrors tests/gpu/compose-probe.ts exactly.
const MAP_W = 2048;
const MAP_H = 1536;
const VIEW_W = 800;
const VIEW_H = 600;
const FRAMES_PER_VIEW = 120;
const THRESHOLD = Math.round(0.5 * 255);
const ISLAND_X = 1536;
const ISLAND_Y = 512;
const ISLAND_R = 300;
const ISLAND_ALPHA = 210;
const SAMPLE_POINTS = [[0, 0], [VIEW_W - 1, VIEW_H - 1], [400, 300]];

function maskAlpha(x, y) {
  const dx = x - ISLAND_X;
  const dy = y - ISLAND_Y;
  if (dx * dx + dy * dy <= ISLAND_R * ISLAND_R) return ISLAND_ALPHA;
  return Math.floor((255 * x) / (MAP_W - 1));
}

function groundPixel(x, y) {
  return [(x * 7 + y * 13 + 5) & 255, (x * 11 + y * 3 + 67) & 255, (x * 17 + y * 5 + 131) & 255];
}

function waterPixel(x, y) {
  return [(x * 9 + y * 23 + 17) & 255, (x * 19 + y * 29 + 53) & 255, (x * 31 + y * 37 + 89) & 255];
}

// CPU reference of the rendering rule for the final fit frame.
function expectedAt(x, y) {
  const scale = Math.min(VIEW_W / MAP_W, VIEW_H / MAP_H);
  const tx = (VIEW_W - MAP_W * scale) / 2;
  const ty = (VIEW_H - MAP_H * scale) / 2;
  const mu = Math.floor((x + 0.5 - tx) / scale);
  const mv = Math.floor((y + 0.5 - ty) / scale);
  if (mu < 0 || mv < 0 || mu >= MAP_W || mv >= MAP_H) return [0, 0, 0, 0];
  const src = maskAlpha(mu, mv) >= THRESHOLD ? groundPixel(mu, mv) : waterPixel(mu, mv);
  return [src[0], src[1], src[2], 255];
}

// Land/water/off-map classification for the same rule, used to require that
// the evidence frame actually contains both kinds of compositor output.
function classOf(x, y) {
  const scale = Math.min(VIEW_W / MAP_W, VIEW_H / MAP_H);
  const tx = (VIEW_W - MAP_W * scale) / 2;
  const ty = (VIEW_H - MAP_H * scale) / 2;
  const mu = Math.floor((x + 0.5 - tx) / scale);
  const mv = Math.floor((y + 0.5 - ty) / scale);
  if (mu < 0 || mv < 0 || mu >= MAP_W || mv >= MAP_H) return 'off';
  return maskAlpha(mu, mv) >= THRESHOLD ? 'land' : 'water';
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

// Minimal RGBA8 PNG encoder: 8-bit truecolour+alpha, one filter byte 0 per row.
function encodePngRgba8(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

let app;
let cancelled = false;
let settled = false;
let finalCode = 0;
let overallTimeout = null;
let hardExitTimer = null;

function settle(code) {
  if (!settled) {
    settled = true;
    finalCode = code;
  } else if (finalCode === 0 && code !== 0) {
    finalCode = code;
  }
  process.exitCode = finalCode;
}

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
  hardExitTimer = setTimeout(() => {
    process.exit(finalCode);
  }, 10_000);
  hardExitTimer.unref?.();
}

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
  const evidenceDir = process.env.GEORAMA_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'T09-compose');
  let bundle;
  try {
    const result = await build({
      entryPoints: [path.join(root, 'tests/gpu/compose-probe.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'GeoramaComposeProbe',
      platform: 'browser',
      target: 'es2022',
      write: false,
    });
    bundle = result.outputFiles[0].text;
  } catch (error) {
    await shutdownAndExit(1, `FAIL bundle: could not bundle tests/gpu/compose-probe.ts: ${error.message}`);
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }

  // Hidden harness: launchApp sets GEORAMA_E2E=1, so the window stays hidden.
  try {
    app = await launchApp();
  } catch (error) {
    await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }
  const { child, temporaryDirectory, connections, rendererPort, shutdown } = app;
  app.shutdown = shutdown;
  console.log(`LAUNCH ${JSON.stringify({ temporaryDirectory, launcherPid: child.pid, hidden: true })}`);

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

  let probe;
  try {
    probe = await page.evaluate(`${bundle};GeoramaComposeProbe.runComposeProbe()`);
  } catch (error) {
    await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }

  // Shape checks: numbers plus the full-frame readback.
  const shapeOk =
    probe !== null && typeof probe === 'object' &&
    Number.isFinite(probe.p50Ms) && Number.isFinite(probe.p95Ms) &&
    probe.frameCount === FRAMES_PER_VIEW * 2 &&
    Array.isArray(probe.samples) && probe.samples.length === SAMPLE_POINTS.length &&
    Array.isArray(probe.times) && probe.times.length === probe.frameCount &&
    probe.times.every((t) => Number.isFinite(t)) &&
    typeof probe.rgbaBase64 === 'string' && probe.rgbaBase64.length > 0 &&
    probe.width === VIEW_W && probe.height === VIEW_H;
  if (!shapeOk) {
    await shutdownAndExit(1, `FAIL probe: bad result shape ${JSON.stringify(probe)?.slice(0, 200)}`);
    return;
  }
  console.log(`PROBE p50=${probe.p50Ms} ms p95=${probe.p95Ms} ms frames=${probe.frameCount}`);

  // Exact sample checks against the CPU reference. No tolerance.
  let samplesOk = true;
  for (let i = 0; i < SAMPLE_POINTS.length; i++) {
    const [x, y] = SAMPLE_POINTS[i];
    const want = expectedAt(x, y);
    const got = probe.samples[i];
    const match = Array.isArray(got) && got.length === 4 && got.every((v, c) => v === want[c]);
    console.log(`SAMPLE (${x},${y}) got=[${got}] want=[${want}] ${match ? 'PASS' : 'FAIL'}`);
    if (!match) samplesOk = false;
  }
  if (!samplesOk) {
    await shutdownAndExit(1, 'FAIL probe: sample mismatch against CPU reference');
    return;
  }

  // Full-frame readback: a missing or short readback exits non-zero.
  let frame;
  try {
    frame = Buffer.from(probe.rgbaBase64, 'base64');
  } catch (error) {
    await shutdownAndExit(1, `FAIL readback: could not decode rgbaBase64: ${error.message}`);
    return;
  }
  const totalPixels = VIEW_W * VIEW_H;
  if (frame.length !== totalPixels * 4) {
    await shutdownAndExit(1, `FAIL readback: expected ${totalPixels * 4} bytes, got ${frame.length}`);
    return;
  }

  // Byte equality for every pixel against the double-precision CPU reference,
  // plus at least one land pixel and at least one water pixel. Any mismatch
  // is reported and fails; the check is never weakened.
  let exactMatchPixels = 0;
  let landPixels = 0;
  let waterPixels = 0;
  let uniform = true;
  let firstPixel = null;
  const mismatches = [];
  for (let y = 0; y < VIEW_H; y++) {
    for (let x = 0; x < VIEW_W; x++) {
      const i = (y * VIEW_W + x) * 4;
      const got = [frame[i], frame[i + 1], frame[i + 2], frame[i + 3]];
      const want = expectedAt(x, y);
      if (got[0] === want[0] && got[1] === want[1] && got[2] === want[2] && got[3] === want[3]) {
        exactMatchPixels++;
      } else if (mismatches.length < 5) {
        mismatches.push(`pixel (${x},${y}): expected [${want}], got [${got}]`);
      }
      const cls = classOf(x, y);
      if (cls === 'land') landPixels++;
      else if (cls === 'water') waterPixels++;
      const key = (got[0] * 16777216 + got[1] * 65536 + got[2] * 256 + got[3]) >>> 0;
      if (firstPixel === null) firstPixel = key;
      else if (key !== firstPixel) uniform = false;
    }
  }
  console.log(`FRAME exact=${exactMatchPixels}/${totalPixels} land=${landPixels} water=${waterPixels} uniform=${uniform}`);
  if (mismatches.length > 0) {
    for (const line of mismatches) console.log(`MISMATCH ${line}`);
    await shutdownAndExit(1, `FAIL frame: ${totalPixels - exactMatchPixels} pixels differ from the CPU reference`);
    return;
  }
  if (uniform) {
    await shutdownAndExit(1, 'FAIL frame: uniform frame (a single repeated pixel is not compositor evidence)');
    return;
  }
  if (landPixels === 0 || waterPixels === 0) {
    await shutdownAndExit(1, `FAIL frame: need land and water pixels, got land=${landPixels} water=${waterPixels}`);
    return;
  }

  let png;
  try {
    png = encodePngRgba8(VIEW_W, VIEW_H, frame);
  } catch (error) {
    await shutdownAndExit(1, `FAIL evidence: could not encode PNG: ${error.stack ?? error.message}`);
    return;
  }
  if (cancelled) {
    await shutdownAndExit(finalCode, null);
    return;
  }

  try {
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, 'probe.json'),
      JSON.stringify({
        p50Ms: probe.p50Ms,
        p95Ms: probe.p95Ms,
        frameCount: probe.frameCount,
        samples: probe.samples,
        samplesOk,
        width: VIEW_W,
        height: VIEW_H,
        exactMatchPixels,
        totalPixels,
        landPixels,
        waterPixels,
        files: { report: 'probe.json', screenshot: 'shot.png' },
        times: probe.times,
      }),
    );
    await writeFile(path.join(evidenceDir, 'shot.png'), png);
  } catch (error) {
    await shutdownAndExit(1, `FAIL evidence: ${error.stack ?? error.message}`);
    return;
  }
  console.log(`SCREENSHOT ${png.length} bytes, frame ${VIEW_W}x${VIEW_H}, exact ${exactMatchPixels}/${totalPixels}`);
  await shutdownAndExit(0, `COMPOSE OK p50=${probe.p50Ms} p95=${probe.p95Ms} evidence=${evidenceDir}`);
}

try {
  await main();
} catch (error) {
  await shutdownAndExit(1, `FAIL harness: ${error.stack ?? error.message}`);
}
