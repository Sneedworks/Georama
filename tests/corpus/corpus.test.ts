// The corpus gate: every unique map of the user's own collection must survive read -> validate -> write
// byte-identically. It runs the reviewed `scripts/wd-check.ts` on the folders named by GEORAMA_MAP_DIR (a
// PATH-style list separated by ':'; searched recursively) and is skipped, visibly, when none of them exists
// (a collection on an unmounted volume is normal). GEORAMA_MAP_EXPECT, when set, is the exact number of
// unique maps the run must cover, so a folder that silently holds fewer maps than you think fails the gate.
// Not part of `npm test` (the real collection takes minutes and about 1.4 GiB): run it with `npm run corpus`.
// Private data: the report is written under the git-ignored `reports/` folder and is never committed.
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMapRoots, runCorpusCheck } from '../helpers/corpus.ts';

const roots = parseMapRoots(process.env['GEORAMA_MAP_DIR']);
const present = roots.filter((root) => existsSync(root) && statSync(root).isDirectory());
const expected = process.env['GEORAMA_MAP_EXPECT'];

describe.skipIf(present.length === 0)('corpus gate (set GEORAMA_MAP_DIR to folders of .wonderdraft_map files, separated by ":")', () => {
  it('every unique map re-encodes byte-identically, validates clean, and keeps its points text', async () => {
    const report = await runCorpusCheck(present, { nice: true });
    const reports = fileURLToPath(new URL('../../reports/', import.meta.url));
    await mkdir(reports, { recursive: true });
    const { output, ...summary } = report;
    await writeFile(
      `${reports}corpus-report.json`,
      JSON.stringify({ at: new Date().toISOString(), foldersGiven: roots.length, foldersPresent: present.length, ...summary }, null, 2) + '\n',
    );
    await writeFile(`${reports}corpus-output.txt`, output);
    // Counts only on the console: names and content stay in the ignored report files.
    console.log(
      `corpus: folders=${present.length}/${roots.length} listed=${report.listed} maps=${report.maps} identical=${report.identical}` +
        ` issues=${report.issues} points=${report.pointsIdentical}/${report.pointsTexts} rssMb=${report.rssMb} exit=${report.exitCode}`,
    );
    expect(report.reason).toBeNull();
    expect(report.ok).toBe(true);
    if (expected !== undefined && expected !== '') expect(report.maps).toBe(Number(expected));
  }, 1_200_000);
});
