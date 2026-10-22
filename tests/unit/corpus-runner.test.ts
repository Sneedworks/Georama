import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeGcpf } from '../../src/core/formats/gcpf.ts';
import { encodeStoreVar } from '../../src/core/formats/godot-var.ts';
import { findMapFiles, findMapFilesIn, judgeCorpus, parseCorpusOutput, parseMapRoots, runCorpusCheck } from '../helpers/corpus.ts';
import { makeSyntheticRoot } from '../helpers/wd-synthetic.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(process.env['TMPDIR'] ?? tmpdir(), 'georama-corpus-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function validMap(): Uint8Array {
  return encodeGcpf(encodeStoreVar(makeSyntheticRoot()));
}

describe('findMapFiles', () => {
  it('finds maps recursively, any case of the extension, sorted, and nothing else', async () => {
    await mkdir(join(dir, 'b', 'deep'), { recursive: true });
    await writeFile(join(dir, 'z.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'a.WONDERDRAFT_MAP'), 'x');
    await writeFile(join(dir, 'b', 'deep', 'm.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'b', 'notes.txt'), 'x');
    await writeFile(join(dir, 'b', 'map.wonderdraft_map.bak'), 'x');
    const found = await findMapFiles(dir);
    expect(found).toEqual([join(dir, 'a.WONDERDRAFT_MAP'), join(dir, 'b', 'deep', 'm.wonderdraft_map'), join(dir, 'z.wonderdraft_map')]);
  });

  it('does not follow symbolic links, to files or to folders', async () => {
    await mkdir(join(dir, 'real'));
    await writeFile(join(dir, 'real', 'm.wonderdraft_map'), 'x');
    await symlink(join(dir, 'real'), join(dir, 'linked-folder'));
    await symlink(join(dir, 'real', 'm.wonderdraft_map'), join(dir, 'linked-file.wonderdraft_map'));
    expect(await findMapFiles(dir)).toEqual([join(dir, 'real', 'm.wonderdraft_map')]);
  });

  it('skips names that could break a one-path-per-line list', async () => {
    await writeFile(join(dir, 'ok.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'bad\nname.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'bad\rname.wonderdraft_map'), 'x');
    expect(await findMapFiles(dir)).toEqual([join(dir, 'ok.wonderdraft_map')]);
  });

  it('lists only regular files: a pipe named like a map would hang the gate, so it is left out', async () => {
    await writeFile(join(dir, 'real.wonderdraft_map'), 'x');
    execFileSync('mkfifo', [join(dir, 'pipe.wonderdraft_map')]);
    expect(await findMapFiles(dir)).toEqual([join(dir, 'real.wonderdraft_map')]);
  }, 5000);

  it('returns the list in plain path order, also where a folder and a file share a prefix', async () => {
    // The walk visits the folder `b` before the file `b.wonderdraft_map` (a shorter name sorts first), but as path
    // strings `b.wonderdraft_map` < `b/x.wonderdraft_map` ('.' is below '/'): only the final sort puts them right.
    await mkdir(join(dir, 'b'));
    await writeFile(join(dir, 'b', 'x.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'b.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'a.wonderdraft_map'), 'x');
    const found = await findMapFiles(dir);
    expect(found).toEqual([join(dir, 'a.wonderdraft_map'), join(dir, 'b.wonderdraft_map'), join(dir, 'b', 'x.wonderdraft_map')]);
    expect(found).toEqual([...found].sort());
  });

  it('returns an empty list for an empty folder, a missing folder and a file', async () => {
    expect(await findMapFiles(dir)).toEqual([]);
    expect(await findMapFiles(join(dir, 'does-not-exist'))).toEqual([]);
    await writeFile(join(dir, 'plain.wonderdraft_map'), 'x');
    expect(await findMapFiles(join(dir, 'plain.wonderdraft_map'))).toEqual([]);
  });
});

describe('parseMapRoots', () => {
  it('splits a PATH-style list, keeps spaces inside names and drops empty parts', () => {
    expect(parseMapRoots(undefined)).toEqual([]);
    expect(parseMapRoots('')).toEqual([]);
    expect(parseMapRoots('/a/b')).toEqual(['/a/b']);
    expect(parseMapRoots('/a b/c:/d e')).toEqual(['/a b/c', '/d e']);
    expect(parseMapRoots(':/a::/b:')).toEqual(['/a', '/b']);
  });
});

describe('findMapFilesIn', () => {
  it('joins several folders, lists a file once even when folders overlap, and tolerates a missing folder', async () => {
    await mkdir(join(dir, 'one', 'inner'), { recursive: true });
    await mkdir(join(dir, 'two'));
    await writeFile(join(dir, 'one', 'a.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'one', 'inner', 'b.wonderdraft_map'), 'x');
    await writeFile(join(dir, 'two', 'c.wonderdraft_map'), 'x');
    const found = await findMapFilesIn([join(dir, 'two'), join(dir, 'one'), join(dir, 'one', 'inner'), join(dir, 'gone')]);
    expect(found).toEqual([join(dir, 'one', 'a.wonderdraft_map'), join(dir, 'one', 'inner', 'b.wonderdraft_map'), join(dir, 'two', 'c.wonderdraft_map')]);
  });
});

const CANNED = [
  'Invented Map 3.wonderdraft_map 4096000 12.5 1.5 0 20.1 IDENTICAL symbols=300 labels=20 paths=5 territories=7',
  'plain.wonderdraft_map 1200 3.2 0.5 2 2.3 DIFF@4096 symbols=2 labels=2 paths=1 territories=1',
  'WDCHECK maps=2 identical=1 issues=2',
  'ISSUE plain.wonderdraft_map /symbols[0]/radius symbol radius must be non-negative',
  'POINTS texts=10 identical=9',
  'R4 max-symbols Invented Map 3.wonderdraft_map: symbols=300 fromGd=1.8 toGd=2.7 read=12.5 write=20.1',
  'R4 max-bytes Invented Map 3.wonderdraft_map: bytes=4096000 fromGd=1.9 toGd=3.1 read=12.5 write=20.1',
  'RSS peak=321 MB',
].join('\n');

describe('parseCorpusOutput', () => {
  it('reads the per-file lines (names hold spaces), the totals, the R4 lines, the issue lines and the memory peak', () => {
    const p = parseCorpusOutput(CANNED);
    expect(p.maps).toBe(2);
    expect(p.identical).toBe(1);
    expect(p.issues).toBe(2);
    expect(p.pointsTexts).toBe(10);
    expect(p.pointsIdentical).toBe(9);
    expect(p.rssMb).toBe(321);
    expect(p.files).toEqual([
      { name: 'Invented Map 3.wonderdraft_map', bytes: 4096000, readMs: 12.5, validateMs: 1.5, issues: 0, writeMs: 20.1, verdict: 'IDENTICAL' },
      { name: 'plain.wonderdraft_map', bytes: 1200, readMs: 3.2, validateMs: 0.5, issues: 2, writeMs: 2.3, verdict: 'DIFF@4096' },
    ]);
    expect(p.r4).toHaveLength(2);
    expect(p.r4[0]).toContain('max-symbols');
    expect(p.issueLines).toEqual(['plain.wonderdraft_map /symbols[0]/radius symbol radius must be non-negative']);
  });

  it('gives zeros and an empty list for text that holds no totals', () => {
    const p = parseCorpusOutput('Error: something broke\n    at x (y.ts:1:1)\n');
    expect(p).toMatchObject({ maps: 0, identical: 0, issues: 0, pointsTexts: 0, pointsIdentical: 0, rssMb: null });
    expect(p.files).toEqual([]);
    expect(p.r4).toEqual([]);
  });
});

describe('judgeCorpus', () => {
  const good = { maps: 12, identical: 12, issues: 0, pointsTexts: 340, pointsIdentical: 340 };
  it('accepts only a run in which every map is identical, there are no issues and every points text round-trips', () => {
    expect(judgeCorpus(good, 0)).toEqual({ ok: true, reason: null });
  });
  it.each([
    ['a non-zero exit status', { ...good }, 1, /exit/],
    ['a killed process', { ...good }, null, /did not finish/],
    ['no maps', { ...good, maps: 0, identical: 0 }, 0, /no maps/],
    ['a map that is not identical', { ...good, identical: 11 }, 0, /not identical|differ/],
    ['validator issues', { ...good, issues: 1 }, 0, /issue/],
    ['a points text that does not round-trip', { ...good, pointsIdentical: 339 }, 0, /points/],
  ])('rejects %s', (_name, totals, exit, pattern) => {
    const j = judgeCorpus(totals, exit as number | null);
    expect(j.ok).toBe(false);
    expect(j.reason).toMatch(pattern);
  });
});

describe('runCorpusCheck through the real gate script on synthetic maps', () => {
  it('takes several folders and counts a map that appears in both once', async () => {
    await mkdir(join(dir, 'x'));
    await mkdir(join(dir, 'y'));
    await writeFile(join(dir, 'x', 'a.wonderdraft_map'), validMap());
    await writeFile(join(dir, 'y', 'a.wonderdraft_map'), validMap());
    await writeFile(join(dir, 'y', 'b.wonderdraft_map'), validMap());
    const report = await runCorpusCheck([join(dir, 'x'), join(dir, 'y')]);
    expect(report.reason).toBeNull();
    expect(report.listed).toBe(3);
    expect(report.maps).toBe(2);
    expect(report.identical).toBe(2);
  }, 60_000);

  it('passes valid maps and counts a repeated file (same name and size) once', async () => {
    await mkdir(join(dir, 'one'));
    await mkdir(join(dir, 'two'));
    await mkdir(join(dir, 'copy'));
    await writeFile(join(dir, 'one', 'a.wonderdraft_map'), validMap());
    await writeFile(join(dir, 'two', 'b.wonderdraft_map'), validMap());
    await writeFile(join(dir, 'copy', 'a.wonderdraft_map'), validMap());
    const report = await runCorpusCheck(dir);
    expect(report.reason).toBeNull();
    expect(report.ok).toBe(true);
    expect(report.maps).toBe(2);
    expect(report.identical).toBe(2);
    expect(report.issues).toBe(0);
    expect(report.pointsTexts).toBeGreaterThan(0);
    expect(report.pointsIdentical).toBe(report.pointsTexts);
    expect(report.files.map((f) => f.name).sort()).toEqual(['a.wonderdraft_map', 'b.wonderdraft_map']);
    expect(report.files.every((f) => f.verdict === 'IDENTICAL')).toBe(true);
  }, 60_000);

  it('fails for an empty folder without starting the gate', async () => {
    const report = await runCorpusCheck(dir);
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/no .*map/i);
    expect(report.exitCode).toBeNull();
  });

  it('fails, with the exit status, when one map is damaged', async () => {
    await writeFile(join(dir, 'good.wonderdraft_map'), validMap());
    await writeFile(join(dir, 'zbad.wonderdraft_map'), validMap().slice(0, -20));
    const report = await runCorpusCheck(dir);
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.reason).toMatch(/exit/);
  }, 60_000);

  it('fails with a clear reason when the gate cannot finish in time', async () => {
    await writeFile(join(dir, 'good.wonderdraft_map'), validMap());
    const report = await runCorpusCheck(dir, { timeoutMs: 1 });
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/did not finish|timed out|exit/);
  }, 60_000);
});
