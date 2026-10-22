# 0.9 review card for producer B2 (dispatch only after B2 delivers)

Parent: <redacted>/Documents/georama. Worktree: <redacted>/Documents/georama-wt/t0.9-compose (branch task/0.9-compose). Parent commit: a02ab51. Correction card: docs/plans/2026-10-19-viewport-compositor-b2.md (293ac9b).

## Preconditions, each checked by the parent as a direct command
1. <redacted>/.hermes/cache/scratch/evidence/T09-compose/DELIVERY-B2.json exists and names the commit (full SHA) and parent a02ab51.
2. The worktree is at that commit and clean. `git diff --name-status a02ab51 HEAD` lists exactly two modified files: tests/gpu/compose-probe.ts and tests/e2e/compose.mjs.
3. `git diff --quiet a02ab51 HEAD -- src/renderer/render/compose/compositor.ts src/renderer/render/compose/shaders.ts tests/gpu/cases-compose.ts tests/gpu/index.ts package.json` exits 0.
4. The parent replays the GPU gates at that commit, one at a time, with nothing else running: `npm run e2e:gl` (20 of 20), `npm run e2e` (9 of 9), `node tests/e2e/cleanup.mjs` (3 of 3), `npm run e2e:compose` (exit 0). Then `pgrep -af '[g]eorama-e2e'` prints nothing, and no georama-e2e temp directory remains.
5. The parent has viewed shot.png. It shows a composed 800x600 frame: a vertical land/water boundary at about x=400 with a fine diagonal texture. It is not the welcome page, not uniform, and has no UI text. No island shape is claimed. Its sha256 (844d77b5...) equals the producer's own shot.png.

Parent replays on 868294e, all green: e2e:gl 20/0; e2e 9/9; cleanup 3/3; e2e:compose exit 0 with COMPOSE OK, exact 480000/480000, samples PASS, LAUNCH hidden true. npm run typecheck exit 0; npm test 2190 passed, 7 skipped; npm run build exit 0. Expected PNG classification counts, not solid-colour counts: land 238800 and water 241200 from the per-pixel CPU reference, exact match 480000 of 480000, off-map 0. The frame is textured (<redacted> distinct RGBA colours; the water sample colour occurs 102 times and the land sample colour 48 times), so a single-colour count is not an expectation, and other colours are not findings. Amended 2026-10-19 after the SPEC review: the earlier sentence equated solid-colour counts with classification counts. That was a card error. The SPEC check png-literal-card-counts failed against it; the product did not change.

Reviewers never overlap a GPU step. Dispatch only after precondition 4.

## Reviewer worktrees
rv-09s and rv-09q are detached at b29084a. Re-detach both at the B2 commit. Verify each is clean, and that `node_modules/.bin/vitest run tests/unit/render-compose-classify.test.ts` exits 0 with 13 tests. This check is Node-only and runs after the GPU steps.

## SPEC reviewer (rv-09s)
- Scope: exactly the two files above; no other path changed.
- Visible-window rule: `grep -n -E 'launchShown|captureScreenshot|delete env\.GEORAMA_E2E|show: *true' tests/e2e/compose.mjs` prints nothing, and the harness sets GEORAMA_E2E to 1.
- Readback path: compose-probe.ts returns rgbaBase64 with width and height for the final fit frame. compose.mjs compares every pixel with the CPU reference, requires at least one land pixel and one water pixel, and writes shot.png.
- Static REDs: reproduce both as direct commands. On the B2 files, each must exit 0. The producer's notes.md records both. The visible-window check is the one that must exit 1 on the parent commit a02ab51.
- Gates you may run: `npm run typecheck`; `npm test` alone (2190 passed, 7 skipped); `npm run build`. Do not run GPU or e2e commands.
- Decode shot.png in Node, read-only, and report its land and water pixel counts.

## Quality and security reviewer (rv-09q)
- Read compose.mjs and compose-probe.ts in full.
- Check for shell, eval, child_process, fetch or any network use; file writes only under GEORAMA_EVIDENCE_DIR; temp cleanup on every path; every failure path exits non-zero.
- PNG encoder: CRC32 over chunk type and data, zlib, one filter byte per row, IHDR width, height, bit depth 8, colour type 6.
- CPU reference: double precision, the sampling formula, the threshold rule, and off-map transparency.
- Privacy scan on added lines, with a positive control first.
- Do not run GPU or e2e commands.

## Output contract
passed (boolean); seal (full SHA); scope_ok (boolean); checks (array of {id, verdict, evidence}); findings (array of {severity, text}); gates (object); unseen (array). Save report.json and notes.md in the reviewer's scratch evidence directory.

## Routing
A failed check blocks integration. The 0.9 source-correction budget is spent (2 of 2). Any further change needs escalation to the owner, not another producer.
