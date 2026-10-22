import { afterEach, describe, expect, it } from 'vitest';
import { launchGlRunner, type RunnerHandle } from '../helpers/gl-runner-fixture.ts';

const WATCHDOG_MS = 25000;
const BOUND_MS = 15000;

const live: RunnerHandle[] = [];
afterEach(() => {
  for (const handle of live.splice(0)) handle.kill();
});

async function launch(env: Record<string, string>, timeoutMs: number): Promise<RunnerHandle> {
  const handle = await launchGlRunner({ timeoutMs, env });
  live.push(handle);
  return handle;
}

function shutdownCalls(output: string): number {
  return output.match(/STUB shutdown call/g)?.length ?? 0;
}

describe('gl runner lifecycle', () => {
  it('successful control exits 0 with all twenty cases', async () => {
    const handle = await launch({}, 8000);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const out = handle.output();
    expect(exit.code).toBe(0);
    expect(out).toMatch(/GPU CASES 20 passed, 0 failed/);
    expect(out.match(/PASS /g)?.length).toBe(20);
  }, 30000);

  it('overall timeout before launch never launches and keeps exit 1', async () => {
    const start = Date.now();
    const handle = await launch({ STUB_BUILD_MS: '4000' }, 400);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const duration = Date.now() - start;
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(out).toMatch(/overall timeout/);
    expect(out).not.toMatch(/STUB launch start/);
    expect(duration).toBeLessThan(BOUND_MS);
  }, 30000);

  it('overall timeout during launch still cleans the late-owned child exactly once', async () => {
    const start = Date.now();
    const handle = await launch({ STUB_LAUNCH_MS: '3000' }, 400);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const duration = Date.now() - start;
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(out).toMatch(/overall timeout/);
    expect(shutdownCalls(out)).toBe(1);
    expect(out).not.toMatch(/GPU CASES/);
    expect(duration).toBeLessThan(BOUND_MS);
  }, 30000);

  it('overall timeout during evaluation exits 1 after bounded cleanup', async () => {
    const start = Date.now();
    const handle = await launch({ STUB_EVAL_MODE: 'hang', STUB_EVAL_LATE_MS: '4000' }, 400);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const duration = Date.now() - start;
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(out).toMatch(/overall timeout/);
    expect(shutdownCalls(out)).toBe(1);
    expect(out).not.toMatch(/GPU CASES/);
    expect(duration).toBeLessThan(12000);
  }, 30000);

  it('a late successful evaluation cannot overwrite the timeout failure', async () => {
    const handle = await launch(
      { STUB_EVAL_MODE: 'hang', STUB_EVAL_LATE_MS: '3000', STUB_EVAL_IGNORE_CLOSE: '1' },
      400,
    );
    const exit = await handle.waitExit(WATCHDOG_MS);
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(shutdownCalls(out)).toBe(1);
    expect(out).not.toMatch(/GPU CASES 20 passed, 0 failed/);
  }, 30000);

  it('bundle failure exits 1 without launching', async () => {
    const handle = await launch({ STUB_BUILD_MODE: 'throw' }, 8000);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(out).toMatch(/FAIL bundle/);
    expect(out).not.toMatch(/STUB launch start/);
  }, 30000);

  it('launch failure exits 1', async () => {
    const handle = await launch({ STUB_LAUNCH_MODE: 'throw' }, 8000);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(out).toMatch(/FAIL harness:.*stub launch failure/);
  }, 30000);

  it('cleanup failure forces exit 1', async () => {
    const handle = await launch({ STUB_SHUTDOWN_THROW: '1' }, 8000);
    const exit = await handle.waitExit(WATCHDOG_MS);
    const out = handle.output();
    expect(exit.code).toBe(1);
    expect(out).toMatch(/FAIL cleanup/);
  }, 30000);

  it('SIGTERM during evaluation exits 143 after cleanup', async () => {
    const handle = await launch({ STUB_EVAL_MODE: 'hang', STUB_EVAL_LATE_MS: '15000' }, 20000);
    await handle.waitForOutput(/STUB launch done/, 10000);
    handle.child.kill('SIGTERM');
    const exit = await handle.waitExit(WATCHDOG_MS);
    expect(exit.code).toBe(143);
    expect(shutdownCalls(handle.output())).toBe(1);
  }, 40000);

  it('SIGINT before launch never launches and exits 130', async () => {
    const handle = await launch({ STUB_BUILD_MS: '4000' }, 20000);
    await handle.waitForOutput(/STUB build start/, 10000);
    handle.child.kill('SIGINT');
    const exit = await handle.waitExit(WATCHDOG_MS);
    const out = handle.output();
    expect(exit.code).toBe(130);
    expect(out).not.toMatch(/STUB launch start/);
  }, 40000);
});
