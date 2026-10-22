import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface RunnerScenario {
  /** Overall-timeout value injected into the runner copy (replaces the 180_000 literal). */
  timeoutMs: number;
  /** Extra env for the runner child (stub controls). */
  env?: Record<string, string>;
  /** Absolute path to the gl.mjs source under test. Defaults to the repo runner. */
  runnerSource?: string;
}

export interface RunnerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class RunnerHandle {
  readonly dir: string;
  readonly child: ChildProcess;
  private chunks: string[] = [];
  private exited: Promise<RunnerExit> | null = null;

  constructor(dir: string, child: ChildProcess) {
    this.dir = dir;
    this.child = child;
    child.stdout?.on('data', (data) => {
      this.chunks.push(String(data));
    });
    child.stderr?.on('data', (data) => {
      this.chunks.push(String(data));
    });
  }

  output(): string {
    return this.chunks.join('');
  }

  /** Observable barrier: resolves once the runner has printed something matching pattern. */
  async waitForOutput(pattern: RegExp, timeoutMs: number): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (pattern.test(this.output())) return;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`timed out waiting for ${pattern} in runner output:\n${this.output()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  waitExit(timeoutMs: number): Promise<RunnerExit> {
    this.exited ??= new Promise<RunnerExit>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`runner did not exit within ${timeoutMs} ms; output:\n${this.output()}`));
      }, timeoutMs);
      this.child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    return this.exited;
  }

  kill(): void {
    try {
      this.child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

const STUB_ESBUILD_SOURCE = `import { setTimeout as delay } from 'node:timers/promises';

export async function build(options) {
  console.log('STUB build start');
  const ms = Number(process.env.STUB_BUILD_MS ?? '0');
  if (ms > 0) await delay(ms);
  if ((process.env.STUB_BUILD_MODE ?? 'ok') === 'throw') {
    throw new Error('stub bundle failure: Could not resolve tests/gpu/index.ts');
  }
  console.log('STUB build done');
  return { outputFiles: [{ text: 'globalThis.GeoramaGpuTests = {};' }] };
}
`;

const STUB_HARNESS_SOURCE = `import { setTimeout as delay } from 'node:timers/promises';

let closed = false;

export function rootDir() {
  return process.env.STUB_ROOT ?? process.cwd();
}

export async function targetAt(port, predicate, child) {
  console.log('STUB target ready');
  return { webSocketDebuggerUrl: 'ws://127.0.0.1:9/stub' };
}

export async function connect(url, connections) {
  const page = {
    async send(method, params) {
      return {};
    },
    async evaluate(expression) {
      if (String(expression).indexOf('document.readyState') !== -1) return true;
      return await stubEvaluate();
    },
    on() {},
    close() { closed = true; },
  };
  if (connections) connections.push(page);
  return page;
}

function passReport() {
  const names = [
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
  return {
    renderer: 'STUB',
    vendor: 'STUB',
    maxTextureSize: 32768,
    formats: [],
    results: names.map((name) => ({ name, ok: true, detail: '', ms: 1 })),
  };
}

async function stubEvaluate() {
  const mode = process.env.STUB_EVAL_MODE ?? 'ok';
  if (mode === 'throw') throw new Error('stub evaluate failure');
  if (mode === 'hang') {
    const lateMs = Number(process.env.STUB_EVAL_LATE_MS ?? '2000');
    const ignoreClose = process.env.STUB_EVAL_IGNORE_CLOSE === '1';
    const start = Date.now();
    while (Date.now() - start < lateMs) {
      if (!ignoreClose && closed) throw new Error('Debugger connection closed');
      await delay(20);
    }
    if (!ignoreClose && closed) throw new Error('Debugger connection closed');
    return passReport();
  }
  return passReport();
}

export async function launchApp() {
  const mode = process.env.STUB_LAUNCH_MODE ?? 'ok';
  const ms = Number(process.env.STUB_LAUNCH_MS ?? '0');
  console.log('STUB launch start');
  if (ms > 0) await delay(ms);
  if (mode === 'throw') throw new Error('stub launch failure');
  let calls = 0;
  const shutdown = async () => {
    calls += 1;
    console.log('STUB shutdown call ' + calls);
    if (calls > 1) return;
    closed = true;
    console.log('STUB shutdown');
    if (process.env.STUB_SHUTDOWN_THROW === '1') throw new Error('stub shutdown failure');
  };
  console.log('STUB launch done');
  return {
    child: { pid: 424242, exitCode: null, signalCode: null },
    temporaryDirectory: 'stub-tmp',
    connections: [],
    rendererPort: 9,
    shutdown,
  };
}
`;

/**
 * Copy the real runner into an isolated scratch directory with its imports
 * rewired to deterministic stubs, then spawn it as a child Node process.
 * No production knob is added: the overall timeout is shrunk by rewriting the
 * 180_000 literal in the copy only.
 */
export async function launchGlRunner(scenario: RunnerScenario): Promise<RunnerHandle> {
  const sourcePath = scenario.runnerSource ?? path.resolve(process.cwd(), 'tests/e2e/gl.mjs');
  const source = await readFile(sourcePath, 'utf8');
  const token = '180_000';
  const occurrences = source.split(token).length - 1;
  if (occurrences !== 1) {
    throw new Error(`expected exactly one ${token} literal in ${sourcePath}, found ${occurrences}`);
  }
  if (!source.includes("from 'esbuild'")) throw new Error('runner no longer imports esbuild');
  if (!source.includes("from './harness.mjs'")) throw new Error('runner no longer imports ./harness.mjs');
  const transformed = source
    .split(token).join(String(scenario.timeoutMs))
    .split("from 'esbuild'").join("from './stub-esbuild.mjs'")
    .split("from './harness.mjs'").join("from './stub-harness.mjs'");
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gl-runner-'));
  await writeFile(path.join(dir, 'gl-under-test.mjs'), transformed);
  await writeFile(path.join(dir, 'stub-esbuild.mjs'), STUB_ESBUILD_SOURCE);
  await writeFile(path.join(dir, 'stub-harness.mjs'), STUB_HARNESS_SOURCE);
  const child = spawn(process.execPath, ['gl-under-test.mjs'], {
    cwd: dir,
    env: { ...process.env, ...scenario.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new RunnerHandle(dir, child);
}
