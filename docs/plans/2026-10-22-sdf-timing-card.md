# 0.10 SDF timing evidence: card (written 00:46:48 -03 2026-10-22)

Status: card committed before any change or GPU run. Evidence only. Timing never passes or fails anything (approval "B3 a", 2026-10-21).

## 1. Purpose
Produce the SDF timing evidence that master plan card 0.10 asks for: the time of the jump-flood SDF pass at the two plan sizes named on that line.

## 2. Why a card
The e2e harness caps each CDP call at 10 s (`tests/e2e/harness.mjs`, `send`). The GPU suite runs in one `Runtime.evaluate` (`tests/e2e/gl.mjs`), and the timing case (one warm-up and five timed passes per size) exceeded that cap in the 2026-10-21 runs (`Runtime.evaluate timed out`, no DETAIL lines). Splitting the case would change what it measures, so the change below only lengthens the wait for the one evaluate that carries the timing case.

## 3. Scope: exactly these files
- `tests/e2e/harness.mjs`: `send` and `evaluate` take an optional timeout. Default 10_000 ms, unchanged for every other caller.
- `tests/e2e/gl.mjs`: the single `runAll` evaluate uses `SDF_TIMING_TIMEOUT_MS = 300_000` only when `GEORAMA_SDF_TIMING_SIZES` is set. Otherwise it keeps 10_000 ms.
- `tests/gpu/cases-sdf.ts`: the timing DETAIL prints `max` (the largest of five samples) instead of `p95`. With five samples, p95 is the maximum, so the old label overstated the statistic. The measurement code is unchanged.

Out of scope: shaders, renderer and core source, every other test, `electron/`, `spike/`, and any new test file.

## 4. Measurement protocol (unchanged)
- Per size: one warm-up `jumpFloodGpu`, then five timed passes. Report the median and the max.
- Wall-clock with a dependent readback. The GPU timer-query path returned 0 earlier, so no GPU-timer numbers are claimed.
- The two sizes come from the 0.10 plan line as it stood before the 2026-10-21 history redaction. The current repo copy is redacted by design. The sizes go into the child process environment (`GEORAMA_SDF_TIMING_SIZES`) in one `subprocess.run(..., env=...)` call. They never appear in a command string, a file, a commit, or a committed record. Saved logs are masked.
- Numbers stay in scratch. The committed record gives only the exit codes, the pass counts, and the statement that both sizes were measured.

## 5. Gates (Node 22.23.3, via `PATH=/usr/bin:$PATH`)
Run on the dry tree, then again on the integration tip after the merge:
- `npm run typecheck` (three projects) exits 0.
- `npm test` passes. Quote its count from the run.
- Portable-core boundary suite passes.
- `npm run build` exits 0.
- Offline shader check: `python3 ~/.hermes/skills/software-development/glsl-shader-validation/scripts/check_glsl_sources.py src` exits 0 with 5 sources. A canary that must fail was run first (exit 1).
- No unit test file changes, so no threads gate applies.

## 6. GPU window (one window, 40 minutes, opened after all Node work)
Runs in order:
1. Dry tree: `GEORAMA_SDF_TIMING_SIZES=<two sizes> npm run e2e:gl`. Expected: exit 0; the 31 PASS names of the 2026-10-21 baseline run (listed below) plus `PASS sdf: timing`; `GPU CASES 32 passed, 0 failed`; one `DETAIL` line for the timing case.
2. Dry tree: `npm run e2e`. Expected: exit 0, 9 PASS.
3. Dry tree: `node tests/e2e/cleanup.mjs`. Expected: `CLEANUP: 3/3 signals passed`.
4. Merge the dry tree's commit into `integ/phase0-b` with `--no-ff` as Ichi. The merge tree must equal the dry tree's tree.
5. Integration tip: the same three runs with the same expected results.

Visible-window check (process check, `pgrep -x electron` and `ps -eo comm= | grep -E 'electron|georama'`) before and after each run.

Baseline PASS names (2026-10-21 run, scratch log):
- `context: attributes`
- `context: loss and restore`
- `checkGl`
- `caps: real GPU`
- `caps: required formats`
- `shader: compile, link, uniforms`
- `texture: create and upload`
- `budget`
- `fbo: completeness and errors`
- `readback: end-to-end render`
- `layers: chunked upload exact`
- `layers: random texels exact on a larger layer`
- `layers: budget and abort cleanup`
- `layers: invalid input rejects before any allocation`
- `layers: pre-aborted upload rejects before allocation`
- `compose: fit 4x3 into 8x6 exact`
- `compose: threshold boundary T-1 water, T land`
- `compose: 1:1 window with offset exact`
- `compose: zoomAt keeps exact correspondence`
- `compose: off-map pixels transparent`
- `compose: invalid input throws GlError`
- `sdf: 1x1 water`
- `sdf: 4x4 all land`
- `sdf: 5x3 all water`
- `sdf: 7x1 row`
- `sdf: 1x6 column`
- `sdf: 4x3 hand example`
- `sdf: 9x7 two islands`
- `sdf: 8x8 checkerboard`
- `sdf: 64x48 seeded`
- `sdf: refusals and limits`

## 7. Stop rules
- Any FAIL, any harness timeout, or any visible window stops the GPU section at once. Record the state. No retry in a loop. No `GEORAMA_E2E` removal.
- A timeout here is a harness stop, not a timing result. A stop is never a gate.
- After a stop, no feature action until a fresh window is approved.

## 8. Budgets and approval
- Delegate calls: 0. Parent-only test-only change. Pace rules: no reviewer for test-only changes.
- Source corrections: 0. A fix that needs source change needs its own card.
- Approval basis: "YES do" (The owner, 2026-10-22) answering "0.10 SDF timing: needs its own card and a GPU yes." Reading recorded: the approved GPU slot is the card's runs in section 6, one window, dry and tip, as the GPU window procedure requires.


## Window W10T (clock read 00:48:09 -03 2026-10-22): SDF timing evidence, GPU slot

- Card: this file (master commit 2dea203). Evidence only; no run decides pass or fail.
- Fuse: 40 minutes from the clock read above (deadline 01:28:09 -03).
- Approval: "YES do" from the owner (2026-10-22), answering "0.10 SDF timing: needs its own card and a GPU yes."
- Reading (flagged): the approved slot is the card's runs in section 6, one window, dry tree then integration tip. The question named the timing stage; the card names the closing runs and the tip rerun as part of that stage.
- Tree: dry tree `dry-10t` = integration tip `76ab628` + task commit `47be40c` (branch `task/0.10-timing`). Node 22.23.3 gates green on the dry tree: typecheck 0; `npm test` 2344 passed, 7 skipped; portable-core boundary 235 passed; build 0; offline shader check 5 sources, 0 failing.
- Processes before the window: no electron and no georama process.
- Expected for each run: section 6 of the card. The timing run: exit 0; 32 passed, 0 failed (31 baseline PASS names plus `sdf: timing`); one DETAIL line; no FAIL; no harness timeout. Smoke: exit 0, 9 PASS. Cleanup: `CLEANUP: 3/3`.
- Sizes: passed in the child environment only; not written here or in any file. Saved logs are masked.
- Stop rules: card section 7.


## Window W10T closed (clock read 00:50:25 -03 2026-10-22): results, evidence only

- Dry tree `dry-10t` (integration tip `76ab628` + task commit `47be40c`): `npm run e2e:gl` with the timing sizes in the child environment: exit 0; 32 PASS, 0 FAIL; the 31 baseline names plus `sdf: timing`; `GPU CASES 32 passed, 0 failed`; one DETAIL line. `npm run e2e`: exit 0, 9/9. `node tests/e2e/cleanup.mjs`: exit 0, `CLEANUP: 3/3 signals passed`.
- Merge: `task/0.10-timing` (`47be40c`) into `integ/phase0-b` with `--no-ff` as Ichi. Integration tip `ac6abfa`, parents `76ab628` and `47be40c`. Merge tree equals the dry tree's tree.
- Tip gates on `ac6abfa` (Node 22.23.3): typecheck 0; `npm test` 2344 passed, 7 skipped; portable-core boundary 235 passed; build 0; offline shader check 5 sources, 0 failing.
- Tip runs: `npm run e2e:gl` with the timing sizes: exit 0; 32 PASS, 0 FAIL; `GPU CASES 32 passed, 0 failed`; the timing case passed. `npm run e2e`: exit 0, 9/9. Cleanup: exit 0, 3/3.
- Timing evidence: both trees measured the two plan sizes (run1 1 DETAIL line(s), run4 1 DETAIL line(s)). The medians and maxima are in scratch, not in this record. Both trees agree in order of magnitude; the two sizes differ, as expected.
- Timing never passed or failed a gate. No harness timeout occurred. The 300 s bound for the timing evaluate was not reached.
- Visible-window check: after each run, no electron or georama process. The Hyprland client list was not read, so that part is NOT OBSERVED.
- Not observed: the Hyprland client list (see above); the run-to-run spread from a single sample set on each tree.
- Stop: no further GPU action in this window. Window deadline was 01:28 BRT.
- Master plan line 78 (0.10) still shows the redacted sizes. That is by design. Its timing evidence now lives in this card and in scratch.
