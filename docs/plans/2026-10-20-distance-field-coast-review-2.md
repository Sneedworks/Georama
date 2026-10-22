# 0.10 review card rev 3: SPEC and quality batch on the correction-2 seal

Re-review after correction 2 of 2: six strength tests appended to tests/unit/core-sdf-jfa.test.ts, no source change. Runbook section 0: the seal changed, so both reviews run again in full on the new seal. The earlier batch deleg_cac4b48a passed on seal 3c1c44d; its verdicts do not cover the new seal.

**Open finding, recorded before dispatch. Read it first.** Mutant ML122-C2b survives the pre-correction tests. It removes the tie-break `cx < bestCx` inside the multi-line condition at src/core/sdf/jfa.ts lines 122 to 126, and the card requires that tie-break (ties by dsq, then cy, then cx). Scratch differential: it differs from the original on <redacted> of <redacted> sampled random grids, and on none of the <redacted> grids with at most <redacted> cells. None of the six new tests reaches that code, so this class is expected to survive them. This is an escalation to the owner, not a reviewer failure, and it is not a source correction.

Placeholders, the only ones allowed. The parent fills them in a scratch copy at dispatch:
- @@SEAL@@: the correction's commit, full SHA.
- @@LOG_DIR@@: the correction's log directory.
Before dispatch, check the filled copy with the regex @@[A-Z_]+@@; it must print nothing.

## 0. Preconditions (parent, before anything else)

1. The correction report from deleg_09e69045 is received, and its seal is @@SEAL@@.
2. The parent re-runs the gates itself on that commit, not trusting the report. Each is one direct command with its exit code saved in @@LOG_DIR@@: A2 core-sdf-jfa default pool; A3 core-sdf-jfa threads pool; A4 typecheck; A5 npm test; A5b core-boundary; A6 build.
3. Scope and identity: git diff --name-status 3c1c44d..@@SEAL@@ prints exactly one line, "M" then a tab then tests/unit/core-sdf-jfa.test.ts. sha256 of src/core/sdf/jfa.ts starts with a1a3b4d1a5494c15. git log --format=%ae 3c1c44d..@@SEAL@@ prints only ichi@localhost.

## 1. Batch and budget

- One delegate call, two tasks. SPEC: worktree rv-10s2, report ~/.hermes/cache/scratch/evidence/R10-spec2/report.json. QUALITY: worktree rv-10q2, report ~/.hermes/cache/scratch/evidence/R10-quality2/report.json.
- Budget: call 7 of 10 (evidence/T10-sdf/budget.json). Source corrections: 2 of 2 used, so none is allowed for this card. A failed review or a surviving real gap is an escalation to the owner, not a patch.
- Node only. No GPU, no e2e, no npm run app, no install, no git commit or config write by reviewers.
- SPEC runs its gates first, then writes the flag file ~/.hermes/cache/scratch/evidence/R10-spec2/gates-done.flag. QUALITY waits for that flag before its npm test. No full suite overlaps another test run.
- Each gate is one direct command in its own tool call: no pipe, no echo wrapper, no chained exit code. Every heavy item (gates, full suite, probes, privacy scans) leaves a log in its evidence directory. A missing log is INCONCLUSIVE, not PASS.

## 2. Readiness (parent)

For rv-10s2, then rv-10q2:
1. git -C ~/Documents/georama worktree add --detach ~/Documents/georama-wt/rv-10s2 @@SEAL@@ (and the same with rv-10q2).
2. ln -s ~/Documents/georama/node_modules ~/Documents/georama-wt/rv-10s2/node_modules (and rv-10q2).
3. git -C ~/Documents/georama-wt/rv-10s2 rev-parse --short HEAD equals the short seal; git -C ~/Documents/georama-wt/rv-10s2 status --porcelain prints nothing. Same for rv-10q2.
4. From each worktree, node_modules/.bin/vitest run tests/unit/core-boundary.test.ts exits 0 with 235 passed.

## 3. SPEC review (task SPEC, worktree rv-10s2)

Each check gives a verdict, the command with its exit code, and file:line evidence. What is not run is "not observed".

- S1 History. git rev-parse --short HEAD equals the seal's short SHA. git log --reverse --format='%h %s' 0b8b64e..HEAD lists ten commits, the newest being the strength-test commit. Record every subject; only the newest subject is checked, and it must start with "0.10:". Author of each commit: ichi@localhost only. Never print another address.
- S2 Scope. git diff --name-status 0b8b64e..HEAD lists exactly eight entries: A src/core/sdf/jfa.ts, A src/renderer/render/sdf/jfa-gpu.ts, M tests/e2e/gl.mjs, A tests/gpu/cases-sdf.ts, M tests/gpu/index.ts, M tests/helpers/gl-runner-fixture.ts, A tests/unit/core-sdf-jfa.test.ts, M tests/unit/gl-runner-lifecycle.test.ts. git diff --name-status 3c1c44d..HEAD lists exactly one line: M, tab, tests/unit/core-sdf-jfa.test.ts.
- S3 Test-file change. git diff 3c1c44d..HEAD -- tests/unit/core-sdf-jfa.test.ts adds lines only: no removed line (grep -c '^-[^-]' prints 0). Every added line sits in the new describe block "jfa strength: mutation gap classes" at the end of the file. The 32 existing tests are unchanged.
- S4 Source unchanged. git diff 3c1c44d..HEAD -- src tests/gpu tests/e2e tests/helpers tests/unit/gl-runner-lifecycle.test.ts prints nothing. git show HEAD:src/core/sdf/jfa.ts | sha256sum starts with a1a3b4d1a5494c15.
- S5 Hand derivation of new test 1. Derive by hand the 1-by-2 grid with land [1, 0] from card section 3: an outline texel has an in-grid 4-neighbour of another class; a seed is the nearest outline texel, ties broken by dsq, then cy, then cx. The expected outline [255, 255] and seeds [0, 0, 0, 1] must follow.
- S6 Claims of the six tests. For each it block: state the assertion and its exact expected values, and check each against card section 3 or the INPUT and LIMIT rules. A test that would also pass against a wrong implementation is a finding.
- S7 Strength proof, eight rows. Read the correction's mutation output (~/.hermes/cache/scratch/t0.10-correction2/red/mutants-1of1.json) and the eight-row gap table (evidence/M10-mutation/gap-table.json). Each row must be KILLED with kill_kind test-failed, and both controls PASS. Re-derive one row by hand, GAP-G (height 0): height < 1 becomes height < 0, and test 5 must fail on that mutant.
  These eight rows are not the whole real-gap set. The five disjunct mutants IF@17#1.0, IF@17#1.1, IFW@17#1, IF@23#1.1 and IF@26#1.2 are measured by the parent in section 6.
- S8 Coverage-addition evidence. The six tests are coverage additions: they pass on the unmutated source, GREEN, as the correction's log shows. No RED/GREEN cycle is claimed for them. Their discriminating power is the mutant kills in S7 and in section 6. Read both logs in the log directory; never accept a label without its log.
- S9 Existing tests. Covered by S3.
- S10 Gates in rv-10s2, each one direct command: npm run typecheck (exit 0); node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts (exit 0, 38 passed); node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts --pool=threads --no-file-parallelism (exit 0, 38 passed). Write gates-done.flag after these three.
- S11 Privacy, independent of the parent. python3 ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/controls.py (exit 0). Then git -C ~/Documents/georama-wt/rv-10s2 diff --unified=0 3c1c44d..HEAD written to a file in the report directory, and python3 ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/scan.py --diff < that file, as a separate command. Report the exit code and the count line. Never print matched text.

## 4. QUALITY review (task QUALITY, worktree rv-10q2)

- Q1 Full suite. npm test, exit 0, run once after gates-done.flag exists. Expect 2269 passed (2263 plus six), 7 skipped, 0 failed. Report the summary lines.
- Q2 Build. npm run build, exit 0.
- Q3 Static scan of added lines. Write git diff --unified=0 3c1c44d..HEAD to a file, then scan that file for secrets, shell and eval, network, DOM or Electron imports, @ts-ignore, "as any", and "as unknown as". The only expected hits are the test-only casts for null and undefined inputs in the new describe block. Each hit gets file:line and a verdict.
- Q4 and Q5 by identity. src/ is unchanged (S4), so the core and GPU code equal rev 2.2. Mark Q4 and Q5 as checked by identity, not re-read.
- Q6 Never throws. Re-run ~/.hermes/cache/scratch/rv-10-quality/q6-never-throws.mjs; report its last line; exit 0.
- Q7 Determinism. Re-run ~/.hermes/cache/scratch/rv-10-quality/q7-determinism.mjs; report its last line; exit 0.
- Q8 Hygiene. git -C ~/Documents/georama-wt/rv-10q2 status --porcelain prints nothing; git ls-files --others --exclude-standard prints nothing.

## 5. Report format and verdict

The JSON shape of rev 2, with seal set to the full SHA. Severities: Critical, Major, Minor, Suggestion. passed is true only when every check passes and no Critical or Major gap exists. A Critical or Major gap blocks the seal and goes to the owner as an escalation.

## 6. Parent steps (after the batch; not part of it)

a. Evidence grep. grep -rn 'match=false\|NOT OBSERVED\|INCONCLUSIVE' over both report directories must print nothing, or every hit is explained or re-run by the parent.
b. Mutation re-measure on a fresh scratch copy of the seal (git archive of @@SEAL@@ extracted into a new scratch directory, node_modules linked). Table: the 36 survivors, the 2 timeouts, and the 10 omission rows for lines 122 to 126, 48 mutants, run with mut-runner --timeout 30. Earlier kills are assumed to hold: S3 shows the old tests are unchanged and the file only grows.
   Expected before the run (not observed yet): the 13 real-gap mutants KILLED; the 23 equivalent survivors still SURVIVE; the 2 timeouts still TIMEOUT, which is never a kill; ML122-C2b still SURVIVES. Any other result is reported as new, not as expected.
c. Escalation rule. A surviving real gap (ML122-C2b today) blocks closure of mutation strength and goes to the owner. No third source correction without his explicit approval.
d. Dry merge, in a throwaway tree only, after the batch passes: from integration tip 0b8b64e, merge --no-ff of the seal as Ichi; name-status equals the eight paths; dry Node gates as in S10 plus npm test and build.
e. GPU stage (runbook section 5): only on the owner's plain yes. Integration (runbook section 6) follows the GPU stage.

## 7. Evidence paths

- ~/.hermes/cache/scratch/evidence/R10-spec2/report.json
- ~/.hermes/cache/scratch/evidence/R10-quality2/report.json
- ~/.hermes/cache/scratch/evidence/T10-sdf/budget.json
- ~/.hermes/cache/scratch/evidence/M10-mutation/ (omission-122.json, ml122-pre/, c2b-search.mjs, c2b-small.mjs)
