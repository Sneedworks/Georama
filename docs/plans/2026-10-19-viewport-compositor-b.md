# 0.9 producer B card: compositor, shaders, GPU cases, probe, hidden harness

Worktree: <redacted>/Documents/georama-wt/t0.9-compose, branch task/0.9-compose, base b29084a (sealed Node modules; clean; node_modules is a symlink).
Plan: docs/plans/2026-10-19-viewport-compositor.md, tasks T4 to T7 (lines 43 to 62). Read those lines first.

## Read first (read only)
- The sealed Node modules: src/renderer/render/view/viewport.ts (fitView, oneToOne, zoomAt, panBy, screenToMap) and src/renderer/render/compose/classify.ts (thresholdFromWaterLevel, isLand). Both have zero imports. You may import them. Never edit them.
- GPU helpers already present, used read only: src/renderer/render/gl/shader.ts (createProgram), gl/errors.ts (GlError), src/renderer/render/layers/raster-upload.ts (uploadRasterLayer, RGBA8, no mipmaps).
- Harness pattern to mirror: tests/gpu/index.ts, one existing tests/gpu cases file, tests/e2e/gl.mjs (read in full before writing compose.mjs), tests/e2e/harness.mjs, tests/e2e/cleanup.mjs, package.json scripts.

## Allowed files (exactly these seven; any other path is a scope violation)
- New: src/renderer/render/compose/shaders.ts; src/renderer/render/compose/compositor.ts; tests/gpu/cases-compose.ts; tests/gpu/compose-probe.ts; tests/e2e/compose.mjs.
- Modified: tests/gpu/index.ts (one import line and one spread in ALL_CASES); package.json (one script: "e2e:compose": "npm run build && node tests/e2e/compose.mjs").

## Forbidden
src/renderer/App.tsx; src/renderer/render/gl/**; src/renderer/render/layers/**; electron/**; src/core/**; src/shared/**; spike/**; tsconfig files; vitest and vite configs; any other tests/unit file; viewport.ts and classify.ts; `npm run app`.

## Tasks (test first; GPU-based RED)
- T4. compositor.ts and shaders.ts. createCompositor(gl) returns {draw, dispose}, built on createProgram from gl/shader.ts, and throws GlError on failure. shaders.ts has zero imports and holds GLSL ES 3.00 vertex and fragment strings. The RED comes from T5 importing compositor.ts before it exists; then minimal source.
- Rendering rule (the CPU reference in the cases implements exactly this): land takes the ground RGB; water takes the water_tint RGB; alpha is 255; off-map pixels are RGBA (0, 0, 0, 0). Threshold T is thresholdFromWaterLevel(water_level).ok value; a pixel is land iff isLand(A, T).land is true, where A is the mask alpha. Mask RGB is never read. Sampling: texelFetch at integer map coordinates, nearest, no filtering. Map texel is floor((x + 0.5 - tx) / scale), and the same for y. Mask, ground and water_tint are uploaded with uploadRasterLayer.
- T5. tests/gpu/cases-compose.ts, exact GPU cases with byte equality and no tolerance: (a) fit of a 4 by <redacted> synthetic map into an 8 by 6 target: every pixel equals the CPU reference of the same rule; (b) threshold boundary: A = T-1 gives water tint, A = T gives ground; (c) 1:1 window of an 8 by <redacted> map into a 4 by 3 target at a known offset; (d) zoomAt by 2 at an integer anchor keeps the exact correspondence; (e) off-map pixels are (0, 0, 0, 0). Fixtures are invented and synthetic. No real map data.
- T6. tests/gpu/compose-probe.ts: deterministic 2048 by 1536 synthetic map (height gradient plus a circular island above threshold). 120 frames at fit and at 1:1 into a viewport-sized target. Each frame is closed by a one-pixel readback. Returns p50 and p95 in milliseconds and three exact samples for the harness to check. Returns numbers only.
- T7. tests/e2e/compose.mjs and the package script: bundle the probe the way gl.mjs does, launch the hidden app, run the probe, check the three samples exactly against the CPU reference, capture a screenshot with CDP Page.captureScreenshot, and write probe.json and shot.png to <redacted>/.hermes/cache/scratch/evidence/T09-compose/. Never write into the repo. A blank capture fails honestly. Frame times are recorded, not asserted against 16.7 ms.

## GPU gate (mandatory first)
Before any GPU or Electron command, and before any full-suite or build command, run this single command. Proceed only if it exits 0:

python3 -c "import json,sys; p=['<redacted>/.hermes/cache/scratch/evidence/R09-node-spec/report.json','<redacted>/.hermes/cache/scratch/evidence/R09-node-quality/report.json']; ok=all(json.load(open(x)).get('passed') is True for x in p); sys.exit(0 if ok else 1)"

If it exits 1, the Node reviews are still running or did not pass. Run `sleep 30` and repeat the gate, for at most 12 tries. If it still exits 1, commit any work in progress as `wip(0.9-compose): ...` and end with status GPU-HOLD. Typechecking your own files is allowed only after the gate has passed.

## Order after the gate passes
RED first: write tests/gpu/cases-compose.ts importing compositor.ts (which does not exist yet), add the one import line to tests/gpu/index.ts, then run `npm run e2e:gl` as the sole command of its tool call, and record its exit code and the first failure or module-resolution error. Then write minimal source. Then GREEN runs.

## Gates (each a single direct command; record exit codes and summaries)
`npm run typecheck` (exit 0); `npm test` (expect 2190 passed, 7 skipped); `npm run build` (exit 0); `npm run e2e:gl` (previously 14 of 14; report the new total); `npm run e2e` (previously 9 of 9); `node tests/e2e/cleanup.mjs` (previously 3 of 3); `npm run e2e:compose` (exit 0, with probe.json and shot.png written to the scratch directory). GPU and Electron commands run one at a time, never alongside another Node worker.

## Rules
- Commit identity: `git -c user.name=Ichi -c user.email=ichi@localhost commit`. Never run `git config`. At the end, `git config --local --get-regexp '^user\.'` must print nothing, and every commit author must be Ichi <ichi@localhost>.
- Stage explicit paths only. Never `git add -A`.
- Privacy: no absolute home paths, real names, real map names or real sizes in files or commit messages. Before your last commit, scan the added lines for /home/, emrys, run/media, wonderdraft and .pck, with a positive control first.
- Never run `npm run app`. Never run the spike directory.
- Time cap about 35 minutes. At the cap, commit work in progress and report what is missing. Do not claim completion without the full gate table.
- Anything you did not observe is reported as not observed.

## Output
Final answer is one JSON object, also written to <redacted>/.hermes/cache/scratch/evidence/T09-compose/DELIVERY.json, with keys: commit (HEAD full SHA), parent (b29084a full SHA), files ({added, modified}), gpu_gate ({exit, output}), tdd (array of {step, command, exit_code, first_failing_test}), gates (object: typecheck, npm_test, build, e2e_gl, e2e, cleanup, e2e_compose, each {exit_code, summary}), probe ({p50_ms, p95_ms, samples_ok, screenshot_path, blank_check}), deviations (string or none), unseen (array). Write a command log to NOTES.md in the same directory.
