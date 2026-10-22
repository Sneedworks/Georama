// Corpus gate runner: lists the maps under a folder, runs the reviewed `scripts/wd-check.ts` on them
// (one child process, so its memory never sits in the test worker) and judges the result strictly.
// It holds no map content: only paths, counts and timings pass through it.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_EXTENSION = '.wonderdraft_map';
const HAS_LINE_BREAK = /[\r\n]/;

/** Every `.wonderdraft_map` below `root` (any case of the extension), sorted; symbolic links are never followed. */
export async function findMapFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing, unreadable or not a folder: nothing to list
    }
    for (const entry of entries) {
      // A name with a line break would split one path into two in the one-path-per-line list.
      if (entry.isSymbolicLink() || HAS_LINE_BREAK.test(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(MAP_EXTENSION)) found.push(full);
    }
  }
  await walk(root);
  return found.sort();
}

/** `GEORAMA_MAP_DIR`-style value: folders separated by `:` (like PATH). Spaces stay part of a name; empty parts are dropped. */
export function parseMapRoots(value: string | undefined): string[] {
  return (value ?? '').split(':').filter((part) => part.length > 0);
}

/** The maps below several folders, each file once (folders may overlap or be missing), sorted. */
export async function findMapFilesIn(roots: readonly string[]): Promise<string[]> {
  const all = new Set<string>();
  for (const root of roots) for (const file of await findMapFiles(root)) all.add(file);
  return [...all].sort();
}

export interface CorpusFileLine {
  name: string;
  bytes: number;
  readMs: number;
  validateMs: number;
  issues: number;
  writeMs: number;
  verdict: string;
}

export interface CorpusTotals {
  maps: number;
  identical: number;
  issues: number;
  pointsTexts: number;
  pointsIdentical: number;
}

export interface ParsedCorpusOutput extends CorpusTotals {
  rssMb: number | null;
  files: CorpusFileLine[];
  r4: string[];
  issueLines: string[];
}

// name bytes read_ms validate_ms issues write_ms VERDICT symbols=.. labels=.. paths=.. territories=..
// The name may hold spaces, so the line is matched from its fixed tail.
const FILE_LINE =
  /^(.+) (\d+) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+) (\d+(?:\.\d+)?) (IDENTICAL|DIFF@\d+) symbols=\d+ labels=\d+ paths=\d+ territories=\d+$/;

export function parseCorpusOutput(text: string): ParsedCorpusOutput {
  const out: ParsedCorpusOutput = { maps: 0, identical: 0, issues: 0, pointsTexts: 0, pointsIdentical: 0, rssMb: null, files: [], r4: [], issueLines: [] };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    let m: RegExpExecArray | null;
    if ((m = /^WDCHECK maps=(\d+) identical=(\d+) issues=(\d+)$/.exec(line))) {
      out.maps = Number(m[1]);
      out.identical = Number(m[2]);
      out.issues = Number(m[3]);
    } else if ((m = /^POINTS texts=(\d+) identical=(\d+)$/.exec(line))) {
      out.pointsTexts = Number(m[1]);
      out.pointsIdentical = Number(m[2]);
    } else if ((m = /^RSS peak=(\d+) MB$/.exec(line))) {
      out.rssMb = Number(m[1]);
    } else if (line.startsWith('R4 ')) {
      out.r4.push(line);
    } else if (line.startsWith('ISSUE ')) {
      out.issueLines.push(line.slice(6));
    } else if ((m = FILE_LINE.exec(line))) {
      out.files.push({
        name: m[1] as string,
        bytes: Number(m[2]),
        readMs: Number(m[3]),
        validateMs: Number(m[4]),
        issues: Number(m[5]),
        writeMs: Number(m[6]),
        verdict: m[7] as string,
      });
    }
  }
  return out;
}

/** The gate passes only when the process finished with status 0, every map is identical, nothing was flagged and every points text round-trips. */
export function judgeCorpus(totals: CorpusTotals, exitCode: number | null): { ok: boolean; reason: string | null } {
  if (exitCode === null) return { ok: false, reason: 'the gate did not finish (killed, timed out or could not start)' };
  if (exitCode !== 0) return { ok: false, reason: `the gate exited with status ${exitCode}` };
  if (totals.maps === 0) return { ok: false, reason: 'the gate reported no maps' };
  if (totals.identical !== totals.maps) {
    return { ok: false, reason: `${totals.maps - totals.identical} of ${totals.maps} maps are not identical after a round trip` };
  }
  if (totals.issues !== 0) return { ok: false, reason: `the validator reported ${totals.issues} issue(s)` };
  if (totals.pointsIdentical !== totals.pointsTexts) {
    return { ok: false, reason: `${totals.pointsTexts - totals.pointsIdentical} of ${totals.pointsTexts} points texts do not round-trip` };
  }
  return { ok: true, reason: null };
}

export interface CorpusReport extends ParsedCorpusOutput {
  ok: boolean;
  reason: string | null;
  exitCode: number | null;
  /** Files found before the gate removed repeats (same name and size). */
  listed: number;
  /** The gate's own output, for the local report file only. */
  output: string;
}

export interface RunOptions {
  /** The repository root that holds `scripts/wd-check.ts`; defaults to this checkout. */
  repoRoot?: string;
  timeoutMs?: number;
  /** Run at low priority (`nice -n 10`): the real corpus takes minutes and about 1.4 GiB. */
  nice?: boolean;
}

interface Finished {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], cwd: string, timeout: number): Promise<Finished> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ code: 0, stdout, stderr });
        return;
      }
      const code = (error as { code?: unknown }).code;
      resolve({ code: typeof code === 'number' ? code : null, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

export async function runCorpusCheck(roots: string | readonly string[], opts: RunOptions = {}): Promise<CorpusReport> {
  const maps = await findMapFilesIn(typeof roots === 'string' ? [roots] : roots);
  if (maps.length === 0) {
    return {
      ok: false, reason: 'no .wonderdraft_map files found under the given folder(s)', exitCode: null, listed: 0, output: '',
      maps: 0, identical: 0, issues: 0, pointsTexts: 0, pointsIdentical: 0, rssMb: null, files: [], r4: [], issueLines: [],
    };
  }
  const scratch = await mkdtemp(join(process.env['TMPDIR'] ?? tmpdir(), 'georama-corpus-'));
  try {
    const list = join(scratch, 'maps.txt');
    await writeFile(list, maps.join('\n') + '\n');
    const repoRoot = opts.repoRoot ?? fileURLToPath(new URL('../..', import.meta.url));
    const script = ['scripts/wd-check.ts', list];
    const [command, args] = opts.nice ? ['nice', ['-n', '10', process.execPath, ...script]] : [process.execPath, script];
    const finished = await run(command as string, args as string[], repoRoot, opts.timeoutMs ?? 1_200_000);
    const parsed = parseCorpusOutput(finished.stdout);
    const judged = judgeCorpus(parsed, finished.code);
    const output = finished.stdout + (finished.stderr ? '\n--- stderr ---\n' + finished.stderr : '');
    return { ...parsed, ...judged, exitCode: finished.code, listed: maps.length, output };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
