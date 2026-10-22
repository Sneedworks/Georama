# 0.10 decision record: open items, evidence and cost of each option

Written 19:50:41 -03, 2026-10-20. 0.10 is not complete. This record names each open item, its evidence and the cost of each option. It changes no source and approves nothing.

## Facts on the record

- **Seal `7067e49`** (full SHA `7067e491a6621d725688c628f6102951a927f108`): eleven commits over `0b8b64e`, all `ichi@localhost`. The only change since the batch-2 seal `c15aa88` is one tie-break test in `tests/unit/core-sdf-jfa.test.ts` (21 lines added, none removed). Source unchanged (sha16 `a1a3b4d1a5494c15`).
- **Reviews on `7067e49`** (batch 3, `deleg_6c8bbe0e`), read from disk: SPEC passed, 13 checks, no gaps. QUALITY passed, 10 checks, no gaps. Evidence grep clean.
- **Parent gates on `7067e49`:** core-sdf-jfa 39 of 39 in both pools; typecheck exit 0; `npm test` 2270 passed, 7 skipped; core-boundary 235 passed; build exit 0.
- **Mutation table on `7067e49`**, all 233 rows, observed: 208 killed by assertion failures; 23 survived, exactly the 23 equivalent mutants from the differential run; 2 timeouts, which are non-terminating loops (rerun at 120 s, still timed out). All 13 real gaps killed. The ten multi-line rows for lines 122 to 126 are all killed, `ML122-C2b` included.
- **Dry merge `49d2754`** (`7067e49` merged onto integration tip `0b8b64e`, throwaway worktree): tree equal to the seal; the eight card paths; typecheck, `npm test` (2270 passed, 7 skipped), threads run, boundary and build green. Not integrated.
- **Approximation (C1, card: evidence only):** on the GPU suite's nine synthetic grids, 1 of 3,224 seeded texels differs from the brute-force nearest coast texel (two-islands grid). The outline agrees with the coast definition on every texel.
- **Map-6 coastline (C2, scratch only):** the four byte-distinct copies give identical land, outline and seed digests. Two pictures are in `~/.hermes/cache/scratch/evidence/C2-map6/` for judgment. Nothing map-derived is committed.
- **Integration tip** `integ/phase0-b` is `0b8b64e`, clean.

## Decision 1: third source correction (card section 6c)

The card allows two source corrections per feature and requires explicit approval for a third. Correction 3 is `7067e49`, a test-only addition. The cap was raised to three on a reading of "continue and do all"; that reading is what this decision confirms or overturns.

- **1a. Approve (keep `7067e49`).** The seal stays as reviewed and dry-merged above. It closes the tie-break requirement in the card (section 3, line 49). Cost: no delegate calls (9 of 10 used). Leaves open: decision 2, then integration.
- **1b. Decline (drop `7067e49`).** The seal reverts to `c15aa88`, whose batch-2 reviews passed. The tie-break requirement stays unverified: on that seal `ML122-C2b` survives (22 killed, 24 survived in the 48-row run). Closing 0.10 would then need a written acceptance of that residual gap, and the dry merge and gates would be repeated on `c15aa88`. Cost: no delegate calls. Leaves open: the tie-break gap.
- **1c. Hold.** Nothing changes. Cost: none. Leaves open: 0.10, and the fuse window, which ends about 20:39 BRT.

The evidence favours 1a. The choice is yours.

## Decision 2: GPU stage B0 to B4 (runbook section 5)

Needs a plain yes or no. Nothing has run on the GPU.

- **2a. Yes.** B0 first: hidden `e2e:gl` on the pre-fix seal `1e78ae1`, which must exit 1 with FAIL lines for the six coast-containing sdf cases and PASS for the coast-free ones. Then B1 to B4 on the dry tree `49d2754`: hidden `e2e:gl`, `e2e`, `cleanup`, and one timing run. About 25 minutes; nothing else runs during it. Cost: no delegate calls; a window that covers about 25 minutes plus setup. Leaves open: integration, then the same gates on the integration tip.
- **2b. No.** The GPU stage never runs, and integration does not follow (runbook section 6 requires the GPU stage). Leaves open: GPU exactness of the distance-field shader is not observed.
- **2c. Later.** The same run at a later window. Before it, the dry merge is re-checked against the integration tip. Cost: a new window.

## Decision 3: C2 judgment (card section 8)

Your judgment of the two pictures in `~/.hermes/cache/scratch/evidence/C2-map6/`: `coast-crop-overlay.png` (native crop) and `coast-overlay.png` (full, downscaled in view). This is not a gate, and nothing is certified as matching anything. Cost: none. Leaves open: nothing in the gates.

## Window and budget

- Fuse: the window opened 19:09 BRT and ends about 20:39 BRT (ultra-mode pre-flight 3).
- Delegate calls: 9 of 10 used.
- Source corrections: 3 used. The card's cap is 2. The cap of 3 is my reading and needs confirmation under decision 1.

## Not observed

- The GPU gates (B0 to B4).
- Any live Electron run.
- Integration of 0.10 into `integ/phase0-b`.


## Answer received (21:07:55 -03, 2026-10-20)

The owner answered both questions with "whatever you find best". Recorded as follows.

- **GPU stage B0 to B4: not run.** "Whatever you find best" is not the explicit yes that the runbook (section 5) and the standing rule require. The stage stays held. A plain "GPU yes" starts B0 on a fresh window. No window has been approved since the 0.10 fuse closed at 20:39.
- **Correction 3 (7067e49): kept, provisionally.** This is my call under his delegation. The commit is test-only, reviewed (batch 3, no gaps), dry-merged (49d2754), and it is the only route to the tie-break requirement that the card names (section 3, line 49). Integration still needs his explicit approval. Nothing is integrated.
- **Integration into integ/phase0-b: held.** It follows the GPU stage and an explicit approval of correction 3.
- **Still open:** the read-only map volume (unmount awaits his word) and the C2 judgment (pictures in scratch).
- **Corrections to earlier records.** The dry-merge gate figures recorded for 0fbf788 were never observed; that merge is superseded by 49d2754. The "batch 3 pending" note is superseded by the reports read from disk.


## Addendum 00:24:15 -03 2026-10-21: answers recorded (`docs/plans/2026-10-21-phase0-approvals.md`)

- **Correction 3 (`7067e49`, test only): approved for integration (D4 a).** Basis: the recommended option; it closes the tie-break gap.
- **GPU B0 to B4: yes (D5 a), in window W10G.** W10G opens after the 0.11 Node-side work and its reviews finish, with nothing else running, and records its own clock read.
- **The dry tree for B1 to B4 is re-cut.** The GPU stage must test the tree it integrates into. After 0.11 is integrated, cut a new throwaway dry tree from that tip (`dry-10d`), run typecheck, `npm test` and build there, and only then run B1 to B4 on it. `dry-10c` (`49d2754`, based on `0b8b64e`) is not used for the GPU stage. B0 stays on the pre-fix seal `1e78ae1`.
- **C2 coastline pictures: accepted as evidence (D6 a); C2 closed.** Nothing map-derived is committed.
- Integration into `integ/phase0-b` follows the GPU stage (D4 a). Closure of 0.10 follows integration.


## Addendum 01:53:16 -03 2026-10-21: W10G stopped at B0 by the runbook stop rule

- **Preconditions (green).** Section 3 on dry-10b (070a8a6, integration tip 2165a18 plus seal 7067e49): typecheck 0; npm test 2355 passed, 7 skipped; unit file under threads 39 of 39; build 0. Section 4 was measured on 7067e49 (M10 table: 208 killed, 23 equivalent, 2 timeouts; seal unchanged). Section 4a: R4a-3 fails on the INPUT and LIMIT tests as required; R4a-1, R4a-2 and R4a-4 pass against the parent, which confirms K1 and K3 as recorded in the 0.10 review.
- **B0 at 1e78ae1 (rv-10-red), npm run e2e:gl.** Exit 1. 31 result lines: 23 PASS, 8 FAIL.
- **FAIL lines.** The six coast-containing cases the runbook expects (7x1 row, 1x6 column, 4x3 hand example, 9x7 two islands, 8x8 checkerboard, 64x48 seeded). Plus two cases the runbook expects to pass: 4x4 all land and 5x3 all water. All eight carry the same message: 'jfa-pass: fragment shader failed'. The expected PASS for 1x1 water, refusals and limits, and the ten existing cases held.
- **Stop.** The runbook's stop rule applies: a failure pattern other than the expected six means the RED does not match the analysis. Stopped at B0. B1, B2, B3 and B4 were not run. No retry.
- **Diagnosis so far (read-only, no GPU).** src/renderer/render/gl/shader.ts line 42 throws GlError('SHADER') with the GL info log as its detail. The harness prints only the message, so the GLSL error text is not in the saved log (B0-red-1e78ae1.log). The failure is not limited to coast grids: every grid larger than 1x1 fails at the same pass. The runbook's RED expectation assumed coast-only failures at 1e78ae1; that assumption was wrong.
- **Not observed.** Whether the current seal passes the eight grids (B1 not run); the GLSL error text; whether the defect is the pre-fix shader or the harness.
- **Blocked.** Section 6 (integrating 0.10) needs sections 3 to 5 green. D9, 0.12 and p0 to p3 depend on the 0.10 close.
- **Options for the owner.** (a) Retrieve the GLSL info log from the error detail with a small GPU run, which needs a yes. (b) Run B1 on dry-10b to see whether the current seal passes the eight grids, in a new window with a yes. (c) Hold 0.10 here. Recommendation: (a) first, since (b) is meaningless until the RED reference is understood.


## Addendum 17:57:19 -03 2026-10-21: GPU blocker, cause and proposed correction

- B0 at 1e78ae1 failed on the compile of the JFA pass shader, in every grid where the pass runs. Cause, found offline with `glslangValidator` (no GPU run): `uniform usampler2D u_seeds` has no precision statement for usampler2D, which GLSL ES 3.00 requires.
- The pass shader is unchanged between 1e78ae1 and 7067e49, so the seal being integrated has the same defect. B1 would fail the same way (inferred from the offline compile; not run).
- Proposed correction: add `precision highp usampler2D;` after `precision highp int;`. Verified offline on a scratch copy: exit 0, no messages.
- Decision needed: a named yes raising the 0.10 source-correction cap to four (card maximum two; three used). Then one commit, SPEC and QUALITY reviews, and the GPU slot on a separate, named yes.
- Proposal, separate card: an offline shader-compile gate in the Node set.


## Addendum 19:42:06 -03 2026-10-21: fourth source correction committed (seal bf113c9); dry tree green; reviews and GPU slot wait for named yeses

- **Approval.** The owner replied "YES" to the proposal "yes, 0.10 cap four", which named the cap. The 0.10 source-correction cap is raised from three to four by that reply.
- **Mechanism.** One line, applied by the parent in the card-listed file `src/renderer/render/sdf/jfa-gpu.ts` on `task/0.10-sdf`, on top of `7067e49`. A producer would have used the last delegate call of the card's budget, and both reviewers need two more.
- **Seal bf113c9.** One commit over `7067e49`. Gates on the edited tree before the commit: typecheck 0; npm test 2270 passed, 7 skipped; the sdf unit file 39 of 39 under threads; build 0. glslangValidator exit 0.
- **Dry tree `8f35ac6`** (integration tip `2165a18` plus the seal). Gates green: typecheck 0; npm test 2355 passed, 7 skipped; sdf unit 39 of 39 under threads; boundary 235; build 0. glslangValidator exit 0. Against the previous dry tree, the only change is the one line.
- **Mutation (runbook section 4).** Not re-measured. The change is in a GPU shader string. `src/core/sdf/jfa.ts`, the module the 233-row table measured, is unchanged, and the generator masks string literals.
- **B0.** The runbook expected coast-only failures at `1e78ae1`. The run showed the pass-shader compile failure in eight cases instead. That is the same defect, now explained offline. It is recorded as an explained RED, not as the expected pattern.
- **Reviews.** Not run. Reviewer worktrees `rv-10s4` (SPEC) and `rv-10q4` (QUALITY) are at `bf113c9`, clean, with a passing readiness gate. Both reviews need two delegate calls, and the card has nine of ten used. Raising the budget to eleven needs a named yes.
- **GPU slot.** Not taken. It needs a plain yes that names it, after the reviews pass.
- **Not observed.** Any GPU run of the corrected shader; B1 to B4; the review verdicts.


## Addendum 20:00:08 -03 2026-10-21: budget 11 and read-only remount; B0 expectation re-derived; GPU waits for reviews

- **Budget raise.** The 0.10 delegate cap goes from 10 to 11, named in the question "budget 11". The owner answered "yes do the rest". Calls used: 11 of 11: nine before, plus the SPEC and QUALITY reviews of `bf113c9` (batch `deleg_63f6c907`, dispatched 20:00:08 -03 2026-10-21).
- **Volume.** `<redacted>` was unmounted and remounted with `udisksctl mount -b <redacted> -o ro`. `/proc/mounts` shows `ro`. `<redacted>` was not touched; D10 is still open.
- **B0 re-derived (offline, no GPU).** The pass shader runs whenever max(width, height) > 1: `src/core/sdf/jfa.ts` lines 87 to 93 and `src/renderer/render/sdf/jfa-gpu.ts` lines 137 to 141, both at `1e78ae1`. Of the sdf cases, eight have a side above 1: the six coast cases, plus `4x4 all land` and `5x3 all water`. The B0 log has eight FAIL lines, the same set, and each reads `jfa-pass: fragment shader failed`.
- **Correction to the runbook's B0 expectation.** The runbook expected only coast cases to fail. Coast-free grids larger than 1x1 also reach the pass. The expected FAIL set is the eight; the expected PASS set is `sdf: 1x1 water`, `sdf: refusals and limits`, and the ten existing cases. The RED is explained by the precision defect, not by a second cause.
- **Section 4.** The 233-row mutation table measured `src/core/sdf/jfa.ts` at `7067e49`. The fourth correction changes only `src/renderer/render/sdf/jfa-gpu.ts`, so the table still covers its source. Not re-measured.
- **GPU.** Not run. It opens only when both reviews pass, after a fresh `date` read, with a 40-minute fuse. B1 to B4 run on the dry tree, then the same on the integration tip after the merge.
- **Not observed.** Any GPU result for the corrected shader; the review verdicts; integration.


## Window W10G2 opened 20:04:56 -03 2026-10-21: GPU stage on the dry tree, then on the integration tip

- **Basis.** "GPU after reviews", asked in plain text, answered "yes do the rest" after both reviews of `bf113c9` passed (batch `deleg_63f6c907`).
- **Reviews.** SPEC PASS: 8 of 8 rows; the pinned SHA matches. QUALITY PASS, no findings. Its gate row is NOT OBSERVED by QUALITY: it had not seen the SPEC marker when it checked, so it ran no gates. That row is covered by the SPEC logs and the parent's pre-commit runs. Supplement: `review-10c4/quality/parent-supplement.md` (scratch).
- **Parent checks at `bf113c9`.** Every `usampler` and `isampler` declaration in `src/` is `uniform usampler2D u_seeds;` (line 66). The precision line sits at line 65, inside `JFA_PASS_FRAGMENT`. No `isampler` declarations. Float samplers are covered by the `precision highp float` lines in their shaders.
- **Runs.** B1 to B4 on `dry-10d` (`8f35ac6`). Then the merge (runbook section 6.1). Then the section 3 gates and B1 to B4 on the integration tip (section 6.2).
- **B0.** Not re-run. The W10G log (`B0-red-1e78ae1.log`) is the RED evidence, and its expectation is amended in the addendum dated 20:00.
- **Visible-window check.** clients 6; georama or electron windows 0.
- **Stop rules.** Any FAIL, any timeout, or any visible window stops the GPU section at once. Record and report. No retry, and no removal of `GEORAMA_E2E`.
- **Fuse.** 40 minutes from this record.


## Window W10G2 stopped at B3 20:08:17 -03 2026-10-21: GPU section halted by the stop rule; integration not run

- **Results.** B1 (`npm run e2e:gl` on `dry-10d`, `8f35ac6`): exit 0; 31 PASS lines; 0 FAIL. All ten sdf cases PASS, including `4x4 all land` and `5x3 all water`, which failed before the fix. B2: `npm run e2e` exit 0, 9 of 9 PASS. `node tests/e2e/cleanup.mjs` exit 0, `CLEANUP: 3/3 signals passed`.
- **Stop.** B3 (timing; the two sizes come from the master plan 0.10 line and were passed only in the environment, not written here): exit 1, one `FAIL harness: Error: Runtime.evaluate timed out`, no DETAIL lines. The stop rule applies to any FAIL, so the GPU section stopped there. B4 was not run; there was no retry; integration (section 6) and closure were not run.
- **Cause, read-only, no GPU.** The harness gives each CDP call a 10-second cap (`tests/e2e/harness.mjs` lines 78 to 81). The timing case runs one warm-up and five timed passes for each of the two sizes inside a single `Runtime.evaluate`, so it can exceed the cap on this GPU. This is a time limit, not an assertion failure. Not observed: how long the case takes without the cap.
- **Contradiction in the card.** Runbook section 5 says B3 is "timing evidence, never a gate", and the same section stops on any FAIL. Standing rule: stop on a contradiction in the card. The owner needs to say which one governs.
- **Scope.** `tests/e2e/harness.mjs` is not on the 0.10 card's file list. A fix there, or smaller timing sizes, changes scope and needs a named decision.
- **Not observed.** Timing numbers for either size; B4; integration on the tip; the source of two Chromium GL error lines (`glLineWidth`, `glReadPixelsRobustANGLE`). Those two lines also appear in the pre-fix B0 log. They are not FAIL lines.
- **Electron and windows.** No Electron process after any run. The Hyprland client check showed no georama or electron window before or after each run.


## Window W10G3 opened 22:19:10 -03 2026-10-21: the approved GPU runs for 0.10, then closure

- **Approval.** The owner replied "B3 a, GPU yes" to two questions asked in plain text. (a) B3 timing is evidence only: a timeout is recorded and does not stop the stage. (b) A fresh 40-minute hidden window for the runs listed below.
- **Covered runs, in order.**
  1. B4 on the dry tree `dry-10d` (`8f35ac6`): `node tests/e2e/cleanup.mjs` reports 3 of 3; `pgrep -x electron` prints nothing.
  2. Merge of seal `bf113c9` into `integ/phase0-b` with `--no-ff` as Ichi. The merge tree must equal the dry tree's tree.
  3. Closing gates on the integration tip: typecheck, `npm test`, the sdf unit file under threads, the portable-core boundary, and build.
  4. On the tip: B1 (`npm run e2e:gl`), B2 (`npm run e2e` and cleanup 3 of 3), and B4 (electron check and cleanup 3 of 3).
  5. A timing run on the tip, with `GEORAMA_SDF_TIMING_SIZES` taken from the master plan 0.10 line and passed in the environment only. The log is masked. Recorded as evidence; a timeout does not stop the stage.
- **Stop rules.** A correctness FAIL, a timeout in a gate or in B1, B2 or B4, or a visible window stops the GPU section at once. Record and report. No retry, and no removal of `GEORAMA_E2E`.
- **Fuse.** 40 minutes from this record. W10G2 covered B1 and B2 on the dry tree (31 PASS, 0 FAIL; smoke 9 of 9; cleanup 3 of 3). Its timing run timed out at the harness's 10-second cap and is recorded there.
- **Not observed yet.** Every run listed above.


## Clock read 22:21:46 -03 2026-10-21: 0.10 closed at integration tip 4ab70b7; window W10G3 closed

- **Runs in W10G3 (approval "B3 a, GPU yes"):**
  - B4 on the dry tree `dry-10d` (`8f35ac6`): cleanup 3 of 3, exit 0. No Electron process.
  - Merge of seal `bf113c9` into `integ/phase0-b` as Ichi, `--no-ff`: tip `4ab70b7`, parents `2165a18` and `bf113c9`. Tree equals the dry tree's tree (`e92385ab26cc`). The diff against `2165a18` is the eight 0.10 entries only.
  - Tip gates on `4ab70b7` (Node v22.23.3): typecheck exit 0. `npm test` 2355 passed, 7 skipped. The sdf unit file under threads 39 of 39. Boundary 235 of 235. Build exit 0.
  - B1 on the tip (`npm run e2e:gl`): exit 0; 31 PASS; 0 FAIL; all ten sdf cases PASS.
  - B2 on the tip: `npm run e2e` exit 0, 9 PASS; cleanup 3 of 3.
  - B4 on the tip: cleanup 3 of 3, exit 0. No Electron process; no georama window before or after.
  - Timing evidence on the tip (sizes passed in the environment only; log masked): exit 1 with one `FAIL harness: Error: Runtime.evaluate timed out` and no DETAIL lines. Recorded as evidence under decision (a); it did not stop the stage. The same limit appeared in W10G2 on the dry tree.
- **Reviews and budget.** Reviews of seal `bf113c9` passed (`deleg_63f6c907`). The 0.10 delegate budget ended at 11 of 11.
- **Open after closure.** Master plan 0.10 names SDF timing on two sizes as evidence. It was not produced: the timing case cannot finish under the harness's 10-second per-call cap. A fix needs a card, because `tests/e2e/harness.mjs` is off the 0.10 card. Not observed: timing numbers for either size. The source of two Chromium GL error lines is not traced; they also appear in the pre-fix log and are not FAIL lines.
- **Not promoted.** Nothing reached master; `integ/phase0-b` holds the 0.10 merge.
