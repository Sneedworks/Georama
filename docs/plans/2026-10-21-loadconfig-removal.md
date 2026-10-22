# Card D9: remove the dead `loadConfig` (rev 1, 2026-10-21)

Approval: D9 a in `docs/plans/2026-10-21-phase0-approvals.md`. Dispatch only after window W11 closes and the 0.10 stage closes (see `docs/STATE.md`). The base and the seal are filled in at dispatch (section 7).

## 0. Objective, scope, exclusions

**Objective.** Delete `loadConfig` and the code only it used, and delete the tests and the spy that exercise it. Nothing else changes. The running app is unaffected: no production file calls `loadConfig` (section 1).

**Base.** @@BASE@@ (the `integ/phase0-b` tip at dispatch).

**Files: exactly these four. Edit no other file.**
1. `electron/assets/config.ts`
2. `tests/unit/assets-config.test.ts`
3. `tests/unit/assets-config-strength.test.ts`
4. `tests/unit/map-asset-check.test.ts`

**Excluded, with reasons.**
- `configFilePath` (exported from `config.ts`): tested in `assets-config.test.ts`. After this removal nothing in production calls it either. Deleting it is a separate decision.
- `tests/unit/selected-config-file.test.ts`: its banned-name list keeps the strings `loadConfig` and `configFilePath`, so that `electron/data/config-file.ts` cannot use them. That check stays valid. No edit.
- `electron/assets/open.ts`: has its own file-local `ioError`. Unrelated.
- `spike/`: never touched.

## 1. Facts (verified by the parent at `0b8b64e`, 2026-10-21 00:17 BRT)

- `git grep -n loadConfig` returns 25 lines. The definition is at `electron/assets/config.ts:117`. The other lines are in four test files:
  - `assets-config.test.ts`: import at line 12; `describe('loadConfig', ...)` at lines 241 to 335, seven tests.
  - `assets-config-strength.test.ts`: import at line 14; `describe('loadConfig: file size, stat failures and read failures', ...)` at lines 139 to 188, five tests.
  - `map-asset-check.test.ts`: `vi.spyOn(configMod, 'loadConfig')` at line 237; `expect(loadSpy).not.toHaveBeenCalled()` at line 272.
  - `selected-config-file.test.ts`: the banned-name string at about line 426 (excluded above).
- No production caller: nothing under `electron/`, `src/` or `scripts/` references `loadConfig` except its definition.
- Identifiers used only by the removed code:
  - `ioError` (`config.ts` lines 113 to 115, file-local).
  - The `readFile` import (`config.ts` line 1). Its only other use is line 140, inside `loadConfig`.
  - `codeOf` (`assets-config-strength.test.ts` line 76). Its only uses are lines 154, 160 and 172, inside the removed describe.
  - `stat`, `lstat` and `readdir` stay: `resolveRoots` uses them.
- No tsconfig sets `noUnusedLocals`. Typecheck will not flag leftovers, so the producer removes them by hand (slice 2).

Line numbers are the base's. The producer locates each block by the text of its first line, and stops if the text does not match (stop rule 2).

## 2. Slices

**Slice 1 (RED).** Insert this block directly before `describe('loadConfig', ...)` in `tests/unit/assets-config.test.ts`. Leave the old block in place.

```ts
describe('dead loadConfig is removed (D9)', () => {
  it('the module no longer exports loadConfig', async () => {
    const mod = await import('../../electron/assets/config.ts');
    expect('loadConfig' in mod).toBe(false);
  });
});
```

Run it as the sole command of its call: `PATH=/usr/bin:$PATH node_modules/.bin/vitest run tests/unit/assets-config.test.ts`. Expected: exit non-zero, exactly one failing test (the D9 test), no setup error. Save the full log.

**Slice 2 (removal, GREEN).**
- `config.ts`: delete `ioError` (lines 113 to 115), the blank line after it, and `loadConfig` (lines 117 to 149). Remove `readFile` from the line-1 import. Keep `lstat`, `readdir` and `stat`. Keep `configFilePath` and everything else.
- `assets-config.test.ts`: remove the `loadConfig,` line from the import (line 12). Delete the old `describe('loadConfig', ...)` block (seven tests). Keep the D9 block from slice 1.
- `assets-config-strength.test.ts`: remove `loadConfig, ` from the line-14 import. Delete the `describe('loadConfig: file size, ...')` block (five tests). Delete `codeOf` (line 76 and its body) only if no other use remains after that deletion.
- `map-asset-check.test.ts`: delete the line `const loadSpy = vi.spyOn(configMod, 'loadConfig');` (line 237) and the line `expect(loadSpy).not.toHaveBeenCalled();` (line 272). Change nothing else in that test.
- In each of the four files, check every imported name with grep. Remove a name that nothing else in that file uses. List each removal in the report.

Test count: 12 removed, 1 added. The passed count falls by exactly 11.

## 3. Acceptance (lettered; each item is one command; report the exit code and the summary line)

- **A1 RED.** Slice 1. Exit non-zero, one failing test (the D9 test), no setup error.
- **A2 GREEN, default pool.** `PATH=/usr/bin:$PATH node_modules/.bin/vitest run tests/unit/assets-config.test.ts tests/unit/assets-config-strength.test.ts tests/unit/map-asset-check.test.ts tests/unit/selected-config-file.test.ts` exits 0.
- **A3 GREEN, threads pool.** The same four files with `--pool=threads --no-file-parallelism` exit 0.
- **A4 typecheck.** `PATH=/usr/bin:$PATH npm run typecheck` exits 0.
- **A5 full suite.** `PATH=/usr/bin:$PATH npm test` exits 0. Passed = base passed − 11; skipped unchanged. Measure the base first, with `npm test` before the first edit, and report both numbers.
- **A6 boundary.** `PATH=/usr/bin:$PATH node_modules/.bin/vitest run tests/unit/core-boundary.test.ts` exits 0.
- **A7 build.** `PATH=/usr/bin:$PATH npm run build` exits 0.
- **A8 references.** `git grep -n loadConfig -- electron src tests scripts` prints only the D9 test's lines and the banned-name line in `selected-config-file.test.ts`.
- **A9 commit.** One commit over the base, made with `git -c user.name=Ichi -c user.email=ichi@localhost commit`. `git diff --name-only <base> HEAD` prints exactly the four files. `git rev-list --count <base>..HEAD` prints 1. `git status --porcelain` prints nothing. Report the SHA and the tree hash.

Not part of this card: Electron and e2e runs. The removed code has no production caller, so this change does not reach a harness. Those runs are not observed.

## 4. Stop rules

1. A RED that is not a behavioural failure: stop, report, change nothing.
2. A stated block that does not match the base: stop, report.
3. A failing test outside the four files: stop, report. Do not edit other files.
4. Two failed attempts at any gate: stop and report the output.

## 5. Budget and window

- Producer: 1 delegate call. Reviews: 2 (SPEC, QUALITY), both pinned to the seal. Maximum 6, with one correction (a correction repeats the producer and both reviews).
- Window W9 opens after W11 closes and the 0.10 stage closes. The parent records its clock read (`date`) and a fuse of estimated minutes × 1.5, capped at 90, when it opens.

## 6. Review and integration

- Reviewer worktrees: `rv-9s1` (SPEC) and `rv-9q1` (QUALITY), created at the seal with the ignored `node_modules` symlink. Check `vitest --version` from each under `/usr/bin/node` (v22.23.3).
- Fill the placeholders BASE, SEAL, WT_SPEC and WT_QUALITY in section 7 in a scratch copy. The filled copy must contain no placeholder. Check it with the pattern for an upper-case name between two double at-signs; that check must print nothing.
- Integration happens after both reviews PASS and the gates pass on the final seal. Dry-merge onto the base in a throwaway worktree (A2 to A7 run there), then `merge --no-ff` into `integ/phase0-b`. Not master.

## 7. Reviewer checks (read-only; no edits; no full-suite runs)

**SPEC** (worktree @@WT_SPEC@@, seal @@SEAL@@, base @@BASE@@). Verdict PASS, or gaps as file:line.
1. `git diff --name-only @@BASE@@ @@SEAL@@` lists exactly the four files of section 0.
2. `config.ts` exports no `loadConfig`. `ioError` and the `readFile` import are gone. `configFilePath`, `parseConfig`, `resolveRoots`, `checkAbsolutePath`, `CONFIG_LIMITS`, `ConfigError` and `SCAN_ENTRY_BUDGET` are unchanged.
3. The only added test is the D9 test. The removed tests are the twelve named in section 1.
4. In `map-asset-check.test.ts`, only the two lines named in section 2 changed.
5. `codeOf` and each import were removed only where nothing else in its file uses them.

**QUALITY** (worktree @@WT_QUALITY@@, seal @@SEAL@@, base @@BASE@@). Verdict PASS, or REQUEST_CHANGES with each finding ranked Critical, Major, Minor or Suggestion.
1. The added lines contain no `as any`, `@ts-ignore`, `@ts-expect-error` or `Function(`.
2. No unused identifier is left in the four files.
3. No assertion is weakened beyond the removed `loadSpy` assertion.
4. The D9 test checks the export directly and fails on the base (the RED log shows it).
5. The diff contains no private data: no map names, sizes or counts.
6. One commit, author Ichi.
