# 0.10 review card: SPEC and quality batch on the producer seal

Review batch for card 0.10 rev 2.1 (`docs/plans/2026-10-20-distance-field-coast.md`, as committed at dc88343). The parent fills two placeholders in the dispatch text and nothing else. Reviewers are read-only: they never edit, commit or create files in the seal worktree, and they never rewrite a report.

Placeholders, the only ones allowed (the producer reports both values):
- @@SEAL@@: the producer's final commit, full SHA.
- @@LOG_DIR@@: the producer's log directory.

Before dispatch, the parent checks that the dispatch text contains no `@@` left over.

## 1. Batch and budget

- One delegate call with two tasks: SPEC (worktree rv-10s, report at ~/.hermes/cache/scratch/evidence/R10-spec/report.json) and QUALITY (worktree rv-10q, report at ~/.hermes/cache/scratch/evidence/R10-quality/report.json).
- Budget: this batch was call 5 of 10 for card 0.10 (evidence/T10-sdf/budget.json); call 4 was the rev 2.2 correction. A correction cycle costs one producer call, then reruns both reviews on the new seal (two more calls). Source corrections cap: 2, one used.
- Node only. No GPU, no e2e, no `npm run app`, no install, no global npm, no git commit or config write.
- Only QUALITY runs `npm test` and `npm run build`. SPEC runs no full suite. Both may run `npm run typecheck` and the unit file. The parent runs no full suite while this batch runs.

## 2. Readiness (parent, before dispatch)

For rv-10s and rv-10q, in order:
1. `git -C ~/Documents/georama worktree add --detach ~/Documents/georama-wt/<name> @@SEAL@@`
2. `ln -s ~/Documents/georama/node_modules ~/Documents/georama-wt/<name>/node_modules` (the ignore rule has no trailing slash, so the link stays untracked).
3. `git -C <worktree> rev-parse --short HEAD` equals the seal's short SHA, and `git -C <worktree> status --porcelain` prints nothing.
4. `node_modules/.bin/vitest run tests/unit/core-boundary.test.ts`, run from the worktree, exits 0.

Dispatch only when all four hold for both worktrees.

## 3. SPEC review (task SPEC, worktree rv-10s)

Each check gives a verdict (pass or fail), the command with its exit code, and file:line evidence. What you do not run is "not observed".

- S1 Seal and history. `git rev-parse --short HEAD` equals the seal. `git log --reverse --format='%h %s' 0b8b64e..HEAD` lists the cycle commits. Every subject starts with `0.10: ` or `wip(0.10): `; report each `wip` commit as a finding. Check the author of each commit as a yes or no: is the email `ichi@localhost`? Never print any other address.
- S2 Scope. `git diff --name-status 0b8b64e..HEAD` lists exactly: A src/core/sdf/jfa.ts, A tests/unit/core-sdf-jfa.test.ts, A src/renderer/render/sdf/jfa-gpu.ts, A tests/gpu/cases-sdf.ts, M tests/gpu/index.ts, M tests/e2e/gl.mjs, M tests/helpers/gl-runner-fixture.ts, M tests/unit/gl-runner-lifecycle.test.ts (the last two are rev 2.2 mirror files). Any other path is a scope failure.
- S3 Edits to existing files. The two rev-2.2 mirror files: `git diff 0b8b64e..HEAD -- tests/helpers/gl-runner-fixture.ts` adds exactly the ten sdf names; `git diff 0b8b64e..HEAD -- tests/unit/gl-runner-lifecycle.test.ts` changes only the title, the 10 to 20 counts, and the line-79 assertion. `git diff 0b8b64e..HEAD -- tests/e2e/gl.mjs` makes exactly three edits: the env read with the evaluate prefix, the names added to EXPECTED_CASES, and the DETAIL print (four diff hunks, because the env read and the evaluate prefix are separate hunks). `git diff 0b8b64e..HEAD -- tests/gpu/index.ts` changes only the import, the ALL_CASES spread, the run-function return type, and the copy of detail into the report. Any other hunk fails.
- S4 Reference contract. Read src/core/sdf/jfa.ts against card section 3, rule by rule: validation order and codes (INPUT, then LIMIT; first failure wins; never throws); outline from in-grid 4-neighbours; NONE never a candidate; K as the smallest k with 2^k >= max(W,H), no passes for 1x1; candidate set (own texel plus the eight offsets at distance s, inside the grid, not NONE); key (dsq, cy, cx); output layout (Uint16 of length 2WH, Uint8 of 0 or 255). Cite file:line for each.
- S5 Hand example. Derive the 4x3 example by hand from card section 3, not from the code. Compare your outline and seed table with the card's table and with the expected table in tests/unit/core-sdf-jfa.test.ts. All three must agree.
- S6 Bounds. Show that dsq is computed only for real seeds, never for NONE, and that coordinates at most 16383 keep dsq below 2^31. Cite the lines.
- S7 Unit tests. Every item of card section 10 (1 to 7) has at least one test. Each INPUT rule and each LIMIT rule has a test that asserts the exact code. Arrays are compared exactly (toEqual, or element by element), not by length or truthiness alone. The oracle in item 7 is a separate naive implementation, not a copy of the module's loops. Seeds are fixed.
- S8 TDD evidence. In @@LOG_DIR@@: the RED log of the first test run with the module absent (non-zero exit from the missing import, recorded as setup RED); a RED log for each behavioural cycle, failing for the expected reason; GREEN logs with exit 0. Cross-check the cycle order with S1. If the logs cannot show test-first order, that is a finding. Never accept a RED label without its log.
- S9 GPU files, read only. jfa-gpu.ts refuses before any GL call (validation first, then the LIMIT check against options.maxTextureSize or gl.MAX_TEXTURE_SIZE). Errors use GlError with UPLOAD for INPUT and LIMIT for LIMIT. createTexture2D, createFramebuffer, readTexels and createProgram are used with the signatures of card section 4. Every texture, framebuffer and program is disposed in a finally block. The draw is the vertex-ID triangle with viewport and drawArrays. Shaders use integer math and bounds-checked fetches. cases-sdf.ts has the ten synthetic names of card section 5 exactly (grep each one); the refusal case checks the three codes; the timing case runs only when `globalThis.__GEORAMA_SDF_SIZES__` is a non-empty string.
- S9b Outline shader (rev 2.2). In src/renderer/render/sdf/jfa-gpu.ts the outline fragment compares each in-grid neighbour with `q >= 0 && q != v`. Any comparison with `1 - v` is a Critical finding. Re-run the transcription probe at ~/.hermes/cache/scratch/evidence/T10-sdf/probe-outline-shader.mjs and report its last line; the corrected variant must show 0 mismatches.
- S10 Gates in rv-10s. `npm run typecheck` exit 0. `node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts` exit 0. `node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts --pool=threads --no-file-parallelism` exit 0. Report the passed counts.
- S11 Privacy, independent of the parent's A7. Run `python3 ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/controls.py`; it must exit 0. Then write `git -C ~/Documents/georama-wt/rv-10s diff --unified=0 0b8b64e..HEAD` to a file in your report directory. In a separate command, run `python3 ~/.hermes/cache/scratch/evidence/T10-sdf/privacy/scan.py --diff < <that file>`. Report the exit code and the count line. Never print matched text.

## 4. QUALITY and security review (task QUALITY, worktree rv-10q)

- Q1 Full suite. `npm test` exit 0, run once. Report passed and skipped. Passed must equal 2231 plus the number of tests in tests/unit/core-sdf-jfa.test.ts, counted from the run output. Report the boundary suite result from tests/unit/core-boundary.test.ts.
- Q2 Build. `npm run build` exit 0.
- Q3 Static scan of added lines (write the diff to a file first, then scan the file). Look for secrets (key, token, password, secret), shell and eval (child_process, exec, eval, new Function), network (fetch, XMLHttpRequest, http://, https://), DOM or Electron imports under src/core, `@ts-ignore`, `as any`, `as unknown as`. Each hit gets file:line and a verdict. An unjustified hit under src/core or in the GPU files is Major.
- Q4 Resource discipline. In jfa-gpu.ts, each createTexture2D, createFramebuffer and createProgram has a matching dispose on every path, including a throw in the middle of the passes. Report the paths you traced.
- Q5 Layout. The readback in jfa-gpu.ts (the R and G channels of the uint readback, the R channel of the R8 outline) matches the reference layout: seeds[2i] and seeds[2i+1], outline 0 or 255. Trace the indices.
- Q6 Never throws. Write a scratch probe under ~/.hermes/cache/scratch/rv-10-quality/ that calls validateClassGrid and jumpFloodReference with: null, undefined, a number, a string, a plain array, NaN, Infinity, -1, 0, 1.5, 2**53, a Uint8Array of the wrong length, a Uint16Array of the right length, and a huge width with a short array. Each call must return a verdict without throwing. Report a table of inputs and verdicts.
- Q7 Determinism. The same input gives identical bytes on two calls. Show it on the hand example and on a seeded 40x30 grid.
- Q8 Hygiene. `git -C ~/Documents/georama-wt/rv-10q ls-files --others --exclude-standard` prints nothing. No logs, scratch files or node_modules are tracked. `git status --porcelain` is empty.

## 4b. Known gaps before review (parent, from producer A's own logs)

Checked on the producer's sealed commit 1e78ae1 and its log directory. They are inputs to S8 and S9b. They are not findings until the reviewers classify them.

- K1. Edge grids (commit 75284b3) and determinism (commit ec97bee) had no failing test before their GREEN. The logs cycle4-green.log and cycle5-green.log say the tests passed on the first run with no code change (16 and 18 tests). No RED log exists for either. Card section 10 requires a RED before each GREEN, so this is a TDD deviation. Replays R4a-1 and R4a-2 (runbook section 4a) show whether these tests can fail against the previous commit.
- K2. INPUT and LIMIT rules share one commit (157615c). Their RED is cycle3-red.log, which shows nine failing validation and passthrough tests against the stub. Card section 10 lists them as two cycles, so the LIMIT rules have no separate RED. Replay R4a-3 checks them against the previous commit.
- K3. The property tests (commit a08a161) were first run against a nearest-seed oracle. Card section 3 does not allow that oracle: jump flooding is approximate, and the card asks for the naive rules. cycle6-red.log records the disagreement. The oracle was then rewritten to the card's rules and passed. Replay R4a-4 shows whether the final oracle passes against the module before the commit. Check the oracle against section 3, not against the module (S7).
- K4. Mapping of producer cycles to card section 10: cycle 1 is item 1 (setup RED from A1, the missing module); cycle 2 is item 2; cycle 3 covers items 3 and 4; cycle 4 is item 5; cycle 5 is item 6; cycle 6 is item 7. The GPU files have their own RED (gpu-red.log, a typecheck failure from the missing module).
- K5. The correction (deleg_eb707557) committed 9ea5d0c (mirror, RED first) and 3c1c44d (outline comparison, where no Node RED is possible). Its report is pending. Its gates are the producer's claims until the parent reruns them on the seal.

### Replay results (observed on the parent's replay worktrees, 02:26 to 02:27 BRT, default pool)

- R4a-1 edge grids (child 75284b3 tests, parent 157615c module): exit 0; 16 of 16 passed. The edge-grid tests passed against the previous code, so they had no RED of their own. Confirms K1.
- R4a-2 determinism (child ec97bee tests, parent 75284b3 module): exit 0; 18 of 18 passed. Confirms K1.
- R4a-3 INPUT and LIMIT rules (child 157615c tests, parent b7f03a9 module): exit 1; 9 failed, 2 passed. The nine failures are the five INPUT rules, the two LIMIT rules and the two passthrough tests, all on assertions (expected true to be false), because the stub returns ok true. The validation rules had a behavioural RED, even though they share one commit (K2). The two hand-example tests pass on the stub, as expected.
- R4a-4 seeded properties (child a08a161 tests, parent ec97bee module): exit 0; 32 of 32 passed in the whole file. The property tests passed against the previous code, so the RED in cycle6-red.log came from the earlier nearest-seed oracle, not from the module. Confirms K3.

These replays are supplemental nonvacuity evidence. They do not replace the historical exit codes in the producer's log directory. Severity of K1 and K3 is for the reviewers to classify.

## 5. Report format and corrections

Each task writes JSON with: passed, scope_ok, seal, checks (list of id, verdict, evidence), gaps (list of severity and text), unseen (list of strings). Severities: Critical, Major, Minor, Suggestion. `passed` is true only when every check passes and there is no Critical or Major gap.

- A Critical or Major gap blocks. The parent sends it to the producer as one source correction (counter 1 of 2 was used by the rev 2.2 correction, so the next one is 2 of 2). The producer fixes it and reseals. Both reviews rerun on the new seal.
- Minor and Suggestion gaps are recorded and do not block.
- A reviewer asked to re-check after a correction writes a new report under a new name. Old reports are never rewritten.

## 6. Parent steps (not part of this batch)

- The A7 privacy scan of the seal: controls first, then the scan of the branch diff, as in S11.
- Dry merge onto integ, then the closing gates on the dry tree.
- Mutation measurement of jfa.ts with the ultra-mode runner (operator and omission rows; equivalents by probe). Reported separately from acceptance.
- The GPU window: a plain-text question to the owner before the first GPU run (not clarify, which holds queued notices). Then B1 to B4 and the timing evidence.
- The map-6 coastline (C2), Node only, after the reference is accepted.

## 7. Evidence paths

- ~/.hermes/cache/scratch/evidence/R10-spec/report.json
- ~/.hermes/cache/scratch/evidence/R10-quality/report.json
- ~/.hermes/cache/scratch/evidence/T10-sdf/budget.json (the parent's budget record)
