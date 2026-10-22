# 0.9 producer B2 card: hidden readback evidence (correction of B at a02ab51)

Worktree: <redacted>/Documents/georama-wt/t0.9-compose, branch task/0.9-compose, parent a02ab51 (clean).

## Why this card exists (verified by the parent at 23:00 to 23:05 BRT)
1. tests/e2e/compose.mjs opens a VISIBLE Electron window (launchShown deletes GEORAMA_E2E, so electron/main.ts sets show true). This breaks the hidden-harness rule. Runs at about 22:57 and 22:58 BRT showed a window on the desktop.
2. evidence/T09-compose/shot.png (24309 bytes) is the app's WELCOME screen ("Ge'orama, A view of the world"), not the composed output. The page never displays the probe's offscreen target, so a page capture cannot show the compositor. The check "<redacted> distinct byte values" passed on the welcome page. It is not evidence.
3. The card contradicts itself. T7 asks for a page screenshot. The scope keeps App.tsx as the welcome screen. T6 says the probe returns numbers only. B did not stop on the contradiction.

## Accepted, must not change
compositor.ts, shaders.ts, tests/gpu/cases-compose.ts, tests/gpu/index.ts, package.json. Parent replays at a02ab51: typecheck 0; npm test 2190 passed and 7 skipped; build 0; e2e:gl 20 of 20; e2e 9 of 9; cleanup 3 of 3. The supplemental RED (staging copy with the compositor absent) exits 1 with TS2307 on the missing module.

## Allowed files (exactly two)
- tests/gpu/compose-probe.ts (modified)
- tests/e2e/compose.mjs (modified)

Forbidden: every other path, including electron/**, src/renderer/App.tsx, src/renderer/render/compose/**, src/renderer/render/view/**, src/renderer/render/gl/**, src/renderer/render/layers/**, src/core/**, src/shared/**, spike/**, tests/unit/**, tsconfig files, vitest and vite configs. Forbidden: `npm run app`, and any window shown on screen.

## Required changes
- compose.mjs: launch the app with the hidden harness, GEORAMA_E2E set to 1, as tests/e2e/harness.mjs does. Reuse the harness launcher if it exports one; otherwise mirror its shutdown semantics. Remove launchShown and every visible-window path. Remove Page.captureScreenshot entirely.
- compose-probe.ts: keep the numbers, the frame count of 240, the three samples and the timing unchanged. Add one readback of the final fit frame: readPixels of the viewport-sized target in RGBA8, returned base64-encoded with its width and height. Do not change the probe's map or frame count.
- compose.mjs: (a) compute the CPU reference for every pixel of that frame with the same rule as the GPU cases: threshold, nearest sampling at floor((x + 0.5 - tx) / scale), ground or water-tint colour, off-map transparent. Use double precision. The probe's scales are dyadic, so the arithmetic is exact; if any mismatch appears, report it and do not weaken the check. (b) Require byte equality for every pixel, at least one land pixel and at least one water pixel. (c) Encode the frame to PNG with zlib, filter byte 0 per row, and CRC32 chunks, and write shot.png into GEORAMA_EVIDENCE_DIR. The default directory stays as it is now. (d) Write probe.json with the numbers, samplesOk, frameCount, frame width and height, exactMatchPixels, totalPixels, and the file names.
- Any failed check exits non-zero. A missing readback exits non-zero. A uniform frame exits non-zero.
- In the evidence directory, move shot-test.mjs, shot-test-shown.mjs and shot-test-shown.png into a subfolder named diagnostics-shown-window. They are not evidence and must not be cited as evidence.

## RED first (no window may open for any RED)
Never run tests/e2e/compose.mjs to obtain a RED. Each RED is a static check that reads the source and never launches the app. Run each as the sole command of its tool call, from the worktree, and record its exit code in NOTES.md:
1. Visible-window RED: node -e "const s=require('fs').readFileSync('tests/e2e/compose.mjs','utf8'); process.exit(/launchShown|captureScreenshot|delete env\.GEORAMA_E2E/.test(s)?1:0)". It must exit 1 on the current file and exit 0 after the change.
2. Readback RED: node -e "const s=require('fs').readFileSync('tests/gpu/compose-probe.ts','utf8'); process.exit(/rgbaBase64/.test(s)?0:1)". It must exit 1 on the current file and exit 0 after the change.
Then make the change. The GPU gates below are not used as a RED.

## Gates (each one direct command, exit code recorded, run from the worktree)
`npm run typecheck` (exit 0); `npm test` (2190 passed, 7 skipped); `npm run build` (exit 0); `npm run e2e:gl` (20 of 20); `npm run e2e` (9 of 9); `node tests/e2e/cleanup.mjs` (3 of 3); `npm run e2e:compose` (exit 0, hidden, probe.json and shot.png written). After the e2e:compose run, run `pgrep -af '[g]eorama-e2e'` as its own command and confirm no process remains, and confirm no temporary georama-e2e directory remains.

## Rules
- Commit identity: git -c user.name=Ichi -c user.email=ichi@localhost commit. Never run git config. Stage explicit paths only; never git add -A.
- Commit exactly the two files. Subject: "0.9-compose: hidden readback evidence (correction of a02ab51)". Author must be Ichi <ichi@localhost>.
- Privacy: no absolute home paths, real names or real map names in files or the commit message. Before the commit, scan the added lines for /home/, emrys, run/media, wonderdraft and .pck, with a positive control first.
- Time cap 25 minutes. At the cap, commit nothing unverified; report what is missing.
- Anything not observed is reported as not observed.

## Output
Final answer is one JSON object, also written to <redacted>/.hermes/cache/scratch/evidence/T09-compose/DELIVERY-B2.json: commit (full SHA), parent (a02ab51 full SHA), files (added and modified), red ({command, exit_code, first_failure}), gates (typecheck, npm_test, build, e2e_gl, e2e, cleanup, e2e_compose, each {exit_code, summary}), probe ({p50_ms, p95_ms, frameCount, exactMatchPixels, totalPixels, landPixels, waterPixels, shot_path, hidden: true}), visible_window (false), deviations (string or none), unseen (array).
