import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeAssetCheckFixture } from '../helpers/asset-check-synthetic.ts';

const execFileAsync = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) {
    await fn();
  }
});

async function runCli(args: string[], env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string; exit: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['scripts/check-map-assets.ts', ...args], {
      cwd: process.cwd(),
      env: { ...env, PATH: process.env.PATH },
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr, exit: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exit: typeof e.code === 'number' ? e.code : 1 };
  }
}

function cleanEnv(tmp: string): Record<string, string | undefined> {
  return { HOME: '/fictional-home-nonexistent', XDG_CONFIG_HOME: '/fictional-xdg-nonexistent', TMPDIR: tmp };
}

describe('check-map-assets CLI positive', () => {
  it('prints the checker report for fixed flag order', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const res = await runCli(['--config', fx.configFile, '--map', fx.mapFile], cleanEnv(tmp));
    expect(res.exit).toBe(0);
    expect(res.stderr).toBe('');
    const report = JSON.parse(res.stdout.trim().split('\n')[0] as string);
    expect(report.version).toBe(1);
    expect(report.ok).toBe(true);
    expect(report.valid).toBe(6);
  });

  it('prints the same report for reverse flag order', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const res = await runCli(['--map', fx.mapFile, '--config', fx.configFile], cleanEnv(tmp));
    expect(res.exit).toBe(0);
    expect(res.stderr).toBe('');
    const report = JSON.parse(res.stdout.trim().split('\n')[0] as string);
    expect(report.ok).toBe(true);
    expect(report.valid).toBe(6);
  });

  it('exits 1 with full report when one asset is unresolved', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture({ omitUserPng: true });
    cleanups.push(fx.cleanup);
    const res = await runCli(['--config', fx.configFile, '--map', fx.mapFile], cleanEnv(tmp));
    expect(res.exit).toBe(1);
    expect(res.stderr).toBe('');
    const lines = res.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0] as string);
    expect(report.ok).toBe(false);
    expect(report.valid).toBe(5);
    expect(report.unresolved).toBe(1);
    expect(report.entries).toHaveLength(6);
  });

  it('fails closed on invalid config, malformed map and semantic error without leaking paths', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    await fs.writeFile(fx.configFile, '{oops');
    const badConfig = await runCli(['--config', fx.configFile, '--map', fx.mapFile], cleanEnv(tmp));
    expect(badConfig.exit).toBe(2);
    expect(badConfig.stdout).toBe('');
    expect(badConfig.stderr.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(badConfig.stderr.trim())).toEqual({ ok: false, error: 'CHECK_FAILED' });

    const fx2 = await makeAssetCheckFixture();
    cleanups.push(fx2.cleanup);
    await fs.writeFile(fx2.mapFile, 'not-a-map');
    const badMap = await runCli(['--config', fx2.configFile, '--map', fx2.mapFile], cleanEnv(tmp));
    expect(badMap.exit).toBe(2);
    expect(badMap.stdout).toBe('');
    expect(JSON.parse(badMap.stderr.trim())).toEqual({ ok: false, error: 'CHECK_FAILED' });
    expect(badMap.stderr).not.toContain(fx2.mapFile);
    expect(badMap.stderr).not.toContain(fx2.configFile);

    const fx3 = await makeAssetCheckFixture({ waterLevel: 1.5 });
    cleanups.push(fx3.cleanup);
    const badSem = await runCli(['--config', fx3.configFile, '--map', fx3.mapFile], cleanEnv(tmp));
    expect(badSem.exit).toBe(2);
    expect(badSem.stdout).toBe('');
    expect(JSON.parse(badSem.stderr.trim())).toEqual({ ok: false, error: 'CHECK_FAILED' });
  });

  it('rejects usage errors with opaque USAGE and no checker output', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const cases: string[][] = [
      [],
      ['--config', fx.configFile],
      ['--config', fx.configFile, '--map'],
      ['--config', fx.configFile, '--map', fx.mapFile, 'extra'],
      ['--config', fx.configFile, '--config', fx.mapFile],
      ['--unknown', 'x', '--map', fx.mapFile],
      ['--help', '--config', fx.configFile, '--map'],
    ];
    for (const args of cases) {
      const res = await runCli(args, cleanEnv(tmp));
      expect(res.exit).toBe(2);
      expect(res.stdout).toBe('');
      expect(JSON.parse(res.stderr.trim())).toEqual({ ok: false, error: 'USAGE' });
    }
  });

  it('prints one usage line for standalone --help', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const res = await runCli(['--help'], cleanEnv(tmp));
    expect(res.exit).toBe(0);
    expect(res.stderr).toBe('');
    const lines = res.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('check-map-assets');
    expect(lines[0]).toContain('--config');
    expect(lines[0]).toContain('--map');
  });

  it('keeps raw spaced unicode paths and stays deterministic under hostile env', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const spacedConfig = path.join(fx.base, 'my config caf\u00e9 \u{1F600}.json');
    const spacedMap = path.join(fx.base, 'my map \u00fc \u{1F600}.wonderdraft_map');
    await fs.copyFile(fx.configFile, spacedConfig);
    await fs.copyFile(fx.mapFile, spacedMap);
    const hostile = { ...cleanEnv(tmp), GEORAMA_WONDERDRAFT_DIR: '/bait', XDG_CONFIG_HOME: '/bait-xdg', HOME: '/bait-home' };
    const first = await runCli(['--config', spacedConfig, '--map', spacedMap], hostile);
    const second = await runCli(['--map', spacedMap, '--config', spacedConfig], hostile);
    expect(first.exit).toBe(0);
    expect(second.exit).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).not.toContain(spacedConfig);
    expect(first.stdout).not.toContain(spacedMap);
    expect(first.stdout).not.toContain(fx.installRoot);
  });
});

describe('check-map-assets CLI fresh failure redo', () => {
  it('fresh CLI failure redo', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    await fs.writeFile(fx.configFile, '{oops');
    const res = await runCli(['--config', fx.configFile, '--map', fx.mapFile], cleanEnv(tmp));
    expect(res.exit).toBe(2);
    expect(res.stdout).toBe('');
    const lines = res.stderr.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({ ok: false, error: 'CHECK_FAILED' });
    expect(res.stderr).not.toContain(fx.configFile);
    expect(res.stderr).not.toContain(fx.mapFile);
    expect(res.stderr).not.toContain('Error');
    expect(res.stderr).not.toContain('at ');
  });
});

describe('check-map-assets CLI fresh usage redo', () => {
  it('fresh CLI usage redo', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'georama-cli-'));
    cleanups.push(async () => { await fs.rm(tmp, { recursive: true, force: true }); });
    const fx = await makeAssetCheckFixture();
    cleanups.push(fx.cleanup);
    const pck = path.join(fx.installRoot, 'Wonderdraft.pck');
    const preload = path.join(tmp, 'preload.mjs');
    await fs.writeFile(preload, [
      "import fsp from 'node:fs/promises';",
      "import fsSync from 'node:fs';",
      'const traceFile = process.env.GEORAMA_TRACE_FILE ?? "";',
      'const targets = (process.env.GEORAMA_TRACE_TARGETS ?? "").split("\\n").filter(Boolean);',
      'const origOpen = fsp.open.bind(fsp);',
      'fsp.open = async function (p, ...rest) {',
      '  try {',
      '    const s = String(p);',
      '    if (traceFile && targets.includes(s)) { fsSync.appendFileSync(traceFile, "OPEN\\n"); }',
      '  } catch {}',
      '  return origOpen(p, ...rest);',
      '};',
      '',
    ].join('\n'));
    const trace = path.join(tmp, 'trace.log');
    async function runWithPreload(args: string[]): Promise<{ stdout: string; stderr: string; exit: number }> {
      const targets = [fx.configFile, fx.mapFile, pck].join('\n');
      try {
        const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', preload, 'scripts/check-map-assets.ts', ...args], {
          cwd: process.cwd(),
          env: { ...cleanEnv(tmp), PATH: process.env.PATH, GEORAMA_TRACE_FILE: trace, GEORAMA_TRACE_TARGETS: targets },
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return { stdout, stderr, exit: 0 };
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string; code?: number };
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exit: typeof e.code === 'number' ? e.code : 1 };
      }
    }
    const good = await runWithPreload(['--config', fx.configFile, '--map', fx.mapFile]);
    expect(good.exit).toBe(0);
    const traced = await fs.readFile(trace, 'utf8');
    expect(traced).toContain('OPEN');
    await fs.rm(trace, { force: true });
    const dup = await runWithPreload(['--map', fx.mapFile, '--map', fx.configFile]);
    expect(dup.exit).toBe(2);
    expect(dup.stdout).toBe('');
    const lines = dup.stderr.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({ ok: false, error: 'USAGE' });
    let traceExists = true;
    try {
      await fs.stat(trace);
    } catch {
      traceExists = false;
    }
    expect(traceExists).toBe(false);
  });
});
