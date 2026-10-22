# 0.10 parent runbook: from the producer seal to integration

Parent steps only, in order. The reviews run first (review card docs/plans/2026-10-20-distance-field-coast-review.md, committed at 56fcc55). Every step has a gate. A failed gate stops the run and goes into the parent's report. No retry loops, and no edits to a sealed tree. The placeholder @@SEAL@@ is the producer's final commit (full SHA); the parent fills it in before use.

This card is not complete until every section below is green and recorded. Nothing runs on the GPU without the owner's yes (section 5).

## 0. Preconditions

- The correction report (sa-0-45f6905a, deleg_eb707557) names the seal @@SEAL@@ and the log directory. The pre-fix seal 1e78ae1 (producer A, deleg_24921226) is kept as the RED reference for B0. Its worktree ~/Documents/georama-wt/t0.10-sdf is at @@SEAL@@, with a clean status.
- The review batch has run on this seal with passed true for SPEC and QUALITY, or every Critical or Major gap went through a correction cycle (counter in evidence/T10-sdf/budget.json).
- No delegate child is running for this card (delegate_task action=list).

## 1. A7 privacy gate on the seal (Node only)

1. `python3 ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/controls.py` exits 0.
2. `git -C ~/Documents/georama-wt/t0.10-sdf diff --unified=0 0b8b64e..@@SEAL@@ > ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/seal.diff` (its own command).
3. `python3 ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/scan.py --diff < ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/seal.diff` exits 0.
4. `git -C ~/Documents/georama-wt/t0.10-sdf log --format=%B 0b8b64e..@@SEAL@@ > ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/seal-msgs.txt`, then `scan.py --text` on that file exits 0.
5. Identity count, printing no address: the number of commits whose author email is ichi@localhost equals the number of commits in 0b8b64e..@@SEAL@@. Count both in separate commands.

## 2. Dry merge (throwaway tree)

1. Record the integration tip: `git -C ~/Documents/georama-wt/integ rev-parse --short HEAD` (expected 0b8b64e). Use that SHA as DRY_BASE below.
2. `git -C ~/Documents/georama worktree add --detach ~/Documents/georama-wt/dry-10 DRY_BASE`
3. `ln -s ~/Documents/georama/node_modules ~/Documents/georama-wt/dry-10/node_modules`
4. `git -C ~/Documents/georama-wt/dry-10 -c user.name=Ichi -c user.email=ichi@localhost merge --no-ff -m "dry: 0.10 seal onto integ" @@SEAL@@` exits 0 with no conflicts.
5. `git -C ~/Documents/georama-wt/dry-10 diff --name-status DRY_BASE..HEAD` lists exactly: A src/core/sdf/jfa.ts, A tests/unit/core-sdf-jfa.test.ts, A src/renderer/render/sdf/jfa-gpu.ts, A tests/gpu/cases-sdf.ts, M tests/gpu/index.ts, M tests/e2e/gl.mjs, M tests/helpers/gl-runner-fixture.ts, M tests/unit/gl-runner-lifecycle.test.ts (the last two are the rev 2.2 mirror files; eight entries in total).

## 3. Node closing gates on the dry tree

Run in ~/Documents/georama-wt/dry-10, one command per call, recording each exit code:
- `npm run typecheck` exits 0.
- `npm test` exits 0. Passed equals 2231 plus the new unit tests. The boundary suite line passes.
- `node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts --pool=threads --no-file-parallelism` exits 0.
- `npm run build` exits 0.

## 4. Mutation measurement (Node only; before any GPU run)

- Operator rows and omission rows for src/core/sdf/jfa.ts, from the ultra-mode scripts gen-ops-mutants.py and gen-disjunct-mutants.py, run through mut-runner.py in disposable copies. Follow ultra-mode references/test-strength-measurement.md.
- SETUP and TIMEOUT are never kills. Kills split into test-failed and run-crashed. Equivalent survivors are shown by probe or reasoning.
- A real gap goes back to the producer as one correction (counter 2 of 2: the rev 2.2 correction already used 1 of 2, so this would be the last one). The seal changes, so return to section 0 and rerun the reviews and sections 1 to 4. No GPU run happens on a seal that is about to change.

## 4a. Supplemental TDD replays (parent, Node only, scratch only)

Purpose: find out whether each test group in the unit file failed before its own GREEN, using the producer's commits as they were. These are supplemental nonvacuity checks. They are not the historical exit codes; those are the logs in the producer's log directory.

For each row: a detached scratch worktree at the parent commit, only the test file copied from the child commit, one run, then removal of the worktree.

    git -C ~/Documents/georama worktree add --detach ~/Documents/georama-wt/rv-10-replay-N <parent>
    ln -s ~/Documents/georama/node_modules ~/Documents/georama-wt/rv-10-replay-N/node_modules
    git -C ~/Documents/georama-wt/rv-10-replay-N show <child>:tests/unit/core-sdf-jfa.test.ts > ~/Documents/georama-wt/rv-10-replay-N/tests/unit/core-sdf-jfa.test.ts
    node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts     (run in the replay worktree; the sole command of its tool call)
    git -C ~/Documents/georama worktree remove --force ~/Documents/georama-wt/rv-10-replay-N

Rows:
- R4a-1 edge grids: child 75284b3, parent 157615c.
- R4a-2 determinism: child ec97bee, parent 75284b3.
- R4a-3 INPUT and LIMIT rules: child 157615c, parent b7f03a9.
- R4a-4 seeded properties with the naive oracle: child a08a161, parent ec97bee.

Record per row: the exit code, the failing test names (or none), and the passing count.
- R4a-3 must fail on the INPUT and LIMIT tests, because the parent module has no validation. If it does not, stop and report: the card's validation tests were not RED.
- R4a-1, R4a-2 and R4a-4 that pass mean the group did not fail against the previous code. That confirms review item K1 or K3. A failure means a real RED exists that the logs do not show: record the failing names.
- Use the default pool only. The threads check is A3's job.

## 5. GPU window (needs the owner's yes first)

- When sections 3 and 4 are green, ask in plain text, not clarify, because a blocking clarify holds queued notices. Question: "Ge'orama 0.10 GPU gates: hidden e2e:gl, e2e and cleanup on the dry tree, then the same on the integration tip, plus one timing run. About 25 minutes. Nothing else runs during it. Yes or no?"
- No yes means no GPU. Stop at section 5 and report.
- Before the window: no producer or reviewer child is running, and `pgrep -x electron` prints nothing.
- Runs, one command per call, each with its exit code:
  - B0 (RED, before any GREEN run): in a detached scratch worktree at the pre-fix seal 1e78ae1 (~/Documents/georama-wt/rv-10-red, created as in section 2 with the node_modules link), `npm run e2e:gl` must exit 1. Expected FAIL lines: the six sdf cases whose grids contain coast ('sdf: 7x1 row', 'sdf: 1x6 column', 'sdf: 4x3 hand example', 'sdf: 9x7 two islands', 'sdf: 8x8 checkerboard', 'sdf: 64x48 seeded'). Expected PASS: the three coast-free sdf cases ('sdf: 1x1 water', 'sdf: 4x4 all land', 'sdf: 5x3 all water'), 'sdf: refusals and limits', and the ten existing cases. Save the log. Any other pattern of failures means the RED does not match the analysis: stop and report.
  - B1: in dry-10, `npm run e2e:gl` exits 0. All ten synthetic names and all ten existing names print PASS, with no FAIL line.
  - B2: `npm run e2e` exits 0 with 9 of 9. `node tests/e2e/cleanup.mjs` exits 0 with 3 of 3.
  - B3: timing evidence, never a gate: `GEORAMA_SDF_TIMING_SIZES=<the two plan sizes from the master plan 0.10 line, typed into the environment for this command only> npm run e2e:gl` exits 0 and prints DETAIL lines. Never write the sizes to a file, a commit, or this runbook.
  - B4: after the runs, `pgrep -x electron` prints nothing, and cleanup reports 3 of 3.
- Stop rules: any FAIL, any timeout, or any visible window stops the GPU section at once. Record the state and report to the owner. Do not retry in a loop, and do not remove the GEORAMA_E2E flag to get a screenshot.

## 6. Integration (only after sections 3 to 5 are green)

1. Merge for real: `git -C ~/Documents/georama-wt/integ -c user.name=Ichi -c user.email=ichi@localhost merge --no-ff -m "merge(0.10): distance field and coast v0 (seal @@SEAL@@)" @@SEAL@@`, then check the tree equals the dry tree (`rev-parse HEAD^{tree}` on both sides).
2. The same window covers the actual tip. Repeat the section 3 gates and the section 5 runs B1 to B4 on ~/Documents/georama-wt/integ.
3. Verify: the integration HEAD is the new merge, `git status --porcelain` is empty, and the author is Ichi.

## 7. Closure

- Evidence not gated: C1, the approximation fraction on synthetic grids (Node, scratch). C2, the map-6 coastline from the real mask, using the reference, in scratch (Node only; section 8 of the card).
- Record in docs/STATE.md (a docs commit on master), the todo list, the budget file (calls used, GPU window used), and the seal and merge SHAs in ~/.hermes/cache/scratch/review-pins.txt.
- Only then may 0.10 be marked complete.
