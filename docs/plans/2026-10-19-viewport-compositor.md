# 0.9 Viewport and compositor v0: implementation plan

Status: plan, 22:15 BRT. Base `integ/phase0-b` at `75b1a95` (0.8 integrated).
Window and fuse: `evidence/T09-viewport/budget.json` (scratch).
Pipeline (Ultra Mode v2): this plan → producer A (Node tasks T1 to T3) → producer B (GPU and hidden-harness tasks T4 to T7) → parent mutation measurement on the Node modules → SPEC and quality reviews on a frozen seal → dry then actual integration → closing gates on both trees → closure record.

Baseline on `75b1a95`: `npm test` 2139 passed, 7 skipped. Planner 19 of 19 on both pools. `e2e:gl` 14 of 14. `e2e` 9 of 9. Cleanup 3 of 3.

## Master-plan card (0.9)
Pan, zoom, fit and 1:1. Per-pixel land, water, ground and tint from the height threshold. Evidence: a screenshot of the real map 6, and frame-time p50 and p95 at fit and at 1:1 (target 16.7 ms p95, recorded as measured).

## Scope decisions (v0)
- **Threshold.** `T = Math.round(water_level × 255)`. Land iff mask alpha `A ≥ T`, with A an integer 0 to 255. `water_level` must be finite and within [0, 1], otherwise INPUT. Source: FORMAT v15 §4. Mask RGB is not read, because its roles are unconfirmed.
- **Colour, v0 rule.** Land takes the `ground` RGB. Water takes the `water_tint` RGB. Alpha is 255. Off-map pixels are RGBA (0, 0, 0, 0). This is a documented rule, not a Wonderdraft match. The look is judged at 0.12.
- **Sampling.** `texelFetch` at integer map coordinates, nearest. Map texel is `floor((x + 0.5 − tx) / scale)`, and the same for y. No filtering, so the GPU result is exact.
- **Layers.** Mask, ground and water_tint are uploaded with `uploadRasterLayer` from 0.8: RGBA8, no mipmaps.
- **Viewport bounds.** `MIN_SCALE = 1/256`, `MAX_SCALE = 64`. Any computed scale outside them is LIMIT.
- **Input wiring is out of scope.** `App.tsx` stays the welcome screen until the Phase <redacted> map view. The viewport is tested as functions only.

## Blocked and not claimed
- **Map-6 screenshot: BLOCKED.** No external volume is mounted (0 at 22:00 BRT). A private screenshot also needs the owner's approval before it is shared. v0 evidence uses an invented synthetic map, and nothing private is committed.
- **Frame time: recorded, not asserted.** p50 and p95 are reported as measured, never checked against 16.7 ms.
- **GPU-run mutation measurement of `compositor.ts` and `shaders.ts` is not part of this closure.** It needs the serialized GPU window, the same open item as the 0.8 uploader.

## Files
New:
1. `src/renderer/render/view/viewport.ts`: zero imports. Exports `ViewState {scale, tx, ty}`, `fitView`, `oneToOne`, `zoomAt`, `panBy`, `screenToMap`, `MIN_SCALE`, `MAX_SCALE`. Each function returns `{ok:true, …}` or `{ok:false, code:'INPUT'|'LIMIT', message}`, and never throws.
2. `tests/unit/render-view-viewport.test.ts`: imports only `viewport.ts` and vitest.
3. `src/renderer/render/compose/classify.ts`: zero imports. Exports `thresholdFromWaterLevel(w)` and `isLand(alpha, threshold)`, with verdicts as above.
4. `tests/unit/render-compose-classify.test.ts`: imports only `classify.ts` and vitest.
5. `src/renderer/render/compose/shaders.ts`: zero imports. GLSL ES 3.00 vertex and fragment strings.
6. `src/renderer/render/compose/compositor.ts`: `createCompositor(gl)` returns `{draw, dispose}`, built on `createProgram` from `gl/shader.ts`. Throws `GlError` on failure.
7. `tests/gpu/cases-compose.ts`: exact GPU cases (T5).
8. `tests/gpu/compose-probe.ts`: deterministic synthetic map and frame timing. Returns numbers only.
9. `tests/e2e/compose.mjs`: hidden harness. Writes JSON and PNG to the scratch directory, never to the repo.

Modified:
10. `tests/gpu/index.ts`: one import line and one spread in `ALL_CASES`.
11. `package.json`: one script, `"e2e:compose": "npm run build && node tests/e2e/compose.mjs"`.

Forbidden: `src/renderer/App.tsx`, `src/renderer/render/gl/**`, `src/renderer/render/layers/**`, `electron/**`, `src/core/**`, `src/shared/**`, `spike/**`, the tsconfig, vitest and vite configs, any other `tests/unit` file, and `npm run app`.

## Tasks
- **T1. `fitView` and `oneToOne` (RED, then GREEN).** Use power-of-two sizes so every expected value is exact. `fitView(1024, 512, 512, 512)` gives scale 0.5, tx 0, ty 128. `oneToOne(1024, 512, 512, 512)` gives scale 1, tx −256, ty 0. NaN, zero and negative inputs give INPUT. Out-of-bounds scale gives LIMIT.
- **T2. `zoomAt`, `panBy`, `screenToMap` (RED, then GREEN).** Use factors of 2 and integer anchors, so the map point under the cursor stays exact. Scale outside the bounds gives LIMIT. Non-finite inputs give INPUT.
- **T3. `classify` (RED, then GREEN).** `thresholdFromWaterLevel(0.5)` gives 128. `0` gives 0 and `1` gives 255. `1.5` and NaN give INPUT. `isLand(156, 156)` is land, `isLand(155, 156)` is water, and `isLand(256, 156)` gives INPUT.
- **T4. Compositor and shaders (RED, then GREEN).** The RED comes from T5 importing `compositor.ts` before it exists. Then minimal source.
- **T5. Exact GPU cases in `cases-compose.ts`.** (a) Fit of a 4 by 3 synthetic map into an 8 by 6 target: every pixel equals the CPU reference of the same rule. (b) Threshold boundary: A = T−1 gives water tint, A = T gives ground. (c) 1:1 window of an 8 by <redacted> map into a 4 by 3 target at a known offset. (d) `zoomAt` by 2 at an integer anchor keeps the exact correspondence. (e) Off-map pixels are (0, 0, 0, 0). Comparisons are byte equality, with no tolerance.
- **T6. `compose-probe.ts`.** A deterministic 2048 by 1536 synthetic map (height gradient plus a circular island above threshold). 120 frames at fit and at 1:1 into a viewport-sized target. Each frame is closed by a one-pixel readback. Returns p50 and p95 in milliseconds, and three exact samples for the harness to check.
- **T7. `tests/e2e/compose.mjs` and the package script.** Bundle the probe the way `gl.mjs` does, launch the hidden app, run the probe, and check the three samples against the CPU reference. Capture a screenshot with CDP `Page.captureScreenshot`, and write `probe.json` and `shot.png` under the scratch directory. A blank capture fails honestly. Nothing is faked.
- **T8. Closure (parent).** Mutation measurement of `viewport.ts` and `classify.ts` (ultra-mode step a2). SPEC and quality reviews on a frozen seal. Dry then actual integration. Closing gates on both trees. Closure record.

## Closing gates (each on dry and actual)
`npm run typecheck`; `npm test`; `node_modules/.bin/vitest run <each new Node test file> --pool=threads --no-file-parallelism`; `npm run build`; `npm run e2e:gl`; `npm run e2e`; `node tests/e2e/cleanup.mjs`; `npm run e2e:compose`. GPU and Electron runs are serial and never overlap a Node worker or a review.

## Budget
Window 22:15 to 23:45 BRT, a 90-minute fuse. Eight delegate calls: producer A (T1 to T3), producer B (T4 to T7), one review batch (SPEC and quality), two correction slots, one post-correction review, one spare. Maximum two source corrections.

## Pitfalls already paid for
- A verdict function never throws. Its guard is tested by a real failing assertion, not by a missing class.
- Fixtures are invented. Expected values come from the same rule, never from remembered real-data numbers.
- A GPU or Electron run never overlaps a Node worker or a review.
- A screenshot is evidence for the owner's judgement, not a certificate of "matches".
