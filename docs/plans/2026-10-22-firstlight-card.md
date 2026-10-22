# 0.12 first light v0: card (01:27:53 -03 2026-10-22)

Status: card for execution. Base: integration tip `ac6abfa`. Branch: `task/0.12-firstlight`. Worktree: `t0.12-firstlight`.
Decision record: `docs/plans/2026-10-22-0.12-first-light-scope.md` (option 1). Standing GPU yes: `docs/plans/2026-10-22-standing-gpu-approval.md`.

## Objective
Show the GPU compositor drawing real map layers (land and water from the heightmap, ground colour, water tint, coastline) for one fixed 1:1 window of one map. The GPU readback must match a CPU reference of the same layers exactly. The readback is written as a PNG for side-by-side judgement by the owner. The owner judges the picture. Reviewers check measurable properties and never certify that a picture "matches".

## Deviations and decisions (recorded here, not silent)
- Crop, not full map: a 1024 x 1024 window at 1:1. Full-map and zoomed views need tiling and a coastline distance field; they are later cards.
- Coastline v0 is painted into the layers on the CPU: land texels within Chebyshev distance 2 of water darken; water texels within distance 2 of land lighten. The compositor shader is unchanged. The jump-flood coast from card 0.10 is the target for views that are not 1:1 (later card).
- Water is a procedural flat base colour blended with the map's water-tint raster. Wonderdraft's water texture and hue settings are not used. Judged as a deviation by the picture judgement.
- Not in v0: symbols, labels, paths, grid, built-in textures. These are named in the side-by-side as absent, not missing by mistake.

## Scope: exactly these six files
1. `src/core/firstlight/layers.ts` (new)
2. `tests/unit/firstlight-layers.test.ts` (new)
3. `tests/gpu/firstlight.ts` (new)
4. `tests/e2e/firstlight-png.mjs` (new)
5. `tests/e2e/gl.mjs` (modify: env-gated section only; default behaviour unchanged)
6. `tests/corpus/firstlight-extract.test.ts` (new)

No other file. No shader change. Do not modify `src/renderer/render/compose/*` (import only), `src/renderer/render/compose/classify.ts` (import only), `tests/e2e/compose.mjs`, `spike/`, or any config.

## Exclusions and rules
- No map file name, map folder, map size, coordinate, or pixel value appears in any committed file, comment, test fixture or commit message. Test fixtures use invented values. The extension literal `.wonderdraft_map` is allowed in readers.
- Do not run any GPU or Electron target: no `npm run e2e`, `npm run e2e:gl`, `npm run app`, `node tests/e2e/*.mjs`. Node gates only.
- Node: run every command as `PATH=/usr/bin:$PATH` (Node v22.23.3). Do not change `git config`. Commit as `git -c user.name=Ichi -c user.email=ichi@localhost commit`.
- Write only inside the worktree. No installs, no network, no global npm.
- One commit over `ac6abfa`.

## Contract 1: `src/core/firstlight/layers.ts` (portable core: no DOM, no renderer imports)
Types:
- `RgbaRaster = { width: number; height: number; data: Uint8Array }` (data length = width x height x 4, row-major, top-left origin).

Constants (exported):
- `FIRSTLIGHT_WATER_RGB = [40, 88, 136] as const`
- `COAST_RADIUS = 2` (Chebyshev, in map texels)
- `COAST_LAND_FACTOR = 0.62`
- `COAST_FOAM_MIX = 0.35`
- `WINDOW_SIZE = 1024`, `WINDOW_STRIDE = 512`, `LAND_FRACTION_MIN = 0.30`, `LAND_FRACTION_MAX = 0.70`

Classification rule (must equal the GPU compositor): a texel is land when its alpha byte is >= threshold. Alpha = `data[i * 4 + 3]`. Threshold must be an integer 0..255, else throw `RangeError`.

Coast rule: a texel is coast when at least one in-map texel within Chebyshev distance `COAST_RADIUS` has the opposite classification. Neighbours are taken from the FULL map, not clipped to the window. Out-of-map neighbours are ignored (no wrap, no NaN).

Functions:
1. `landMask(mask: RgbaRaster, threshold: number): Uint8Array` returns 1 for land, 0 for water.
2. `selectWindow(mask: RgbaRaster, threshold: number, size = WINDOW_SIZE, stride = WINDOW_STRIDE): { x0: number; y0: number; coastTexels: number; landFraction: number }`.
   - Candidate origins: x0 in {0, stride, 2*stride, ...} with x0 + size <= width; y0 likewise.
   - Eligible: landFraction in [LAND_FRACTION_MIN, LAND_FRACTION_MAX] over the window's texels.
   - Pick the eligible window with the most coast texels inside the window. Ties: smaller y0, then smaller x0.
   - No candidate fits, or none eligible: throw `RangeError`.
   - A summed-area table over land flags is allowed and recommended for speed (the map may be large).
3. `buildFirstLightLayers(input: { mask: RgbaRaster; ground: RgbaRaster; tint: RgbaRaster; threshold: number; x0: number; y0: number; width: number; height: number }): { mask: RgbaRaster; ground: RgbaRaster; water: RgbaRaster; stats: { land: number; water: number; coastLand: number; coastWater: number } }`
   - mask, ground and tint must have identical width and height (the map size). Otherwise `RangeError`.
   - The window must be fully inside the map, with width >= 1 and height >= 1. Otherwise `RangeError`.
   - Output `mask`: bytes copied unchanged from the window.
   - Output `ground`: RGB from the ground raster; alpha = 255. On land coast texels: each RGB channel = `Math.round(c * COAST_LAND_FACTOR)`.
   - Output `water`: alpha = 255. For each texel, a = tint alpha / 255 and each channel = `Math.round(base_c * (1 - a) + tint_c * a)`, base = FIRSTLIGHT_WATER_RGB, tint = the tint raster's RGB. On water coast texels: each channel = `Math.round(c + (255 - c) * COAST_FOAM_MIX)`.
   - `stats` counts texels inside the window only.

## Contract 2: `tests/unit/firstlight-layers.test.ts` (vitest, `npm test` picks it up)
Synthetic data only. Expected values are hand-computed in the test. Do not call the implementation to compute an expected value.
Minimum cases (each one `it(...)`):
1. `landMask`: alpha 155 is water and alpha 156 is land at threshold 156.
2. `landMask` throws `RangeError` for thresholds 256, 1.5 and NaN.
3. Vertical coast, 5 x <redacted> map, threshold 128. Columns 0 and 1 are water (alpha 0). Columns 2 to 4 are land (alpha 255). Ground RGB (200, 200, 200). Tint alpha 0 everywhere.
   Expected: land column 2 and column 3 are coast, so ground = (124, 124, 124). Column 4 is not coast (distance 3 to column 1), so ground = (200, 200, 200). Water column 0 and column 1 are coast, so water = (115, 146, 178). Stats: coastLand = 2 columns x 5 rows = 10; coastWater = 2 columns x 5 rows = 10.
4. Tint blend, exact integers: tint alpha 0 gives base (40, 88, 136); tint alpha 255 gives the tint RGB; tint alpha 128 with tint RGB (200, 100, 50) gives (120, 94, 93). Use a window that is not a coast (uniform water map).
5. Border clamping: a window at x0 = 1 classifies its first column using the in-map neighbour at x = 0. Expected values hand-computed. A window at x0 = 0 has no out-of-map neighbour effects.
6. `selectWindow` on a 16 x 8 synthetic map, size 4, stride 4: the unique best eligible window is chosen. Hand-computed.
7. `selectWindow` tie: two identical best windows return the smaller y0, then x0.
8. `selectWindow` throws `RangeError` when no window is eligible.
9. Input errors throw `RangeError`: mismatched raster dimensions; window outside the map; zero-sized window.
10. Orientation: output row 0 equals map row y0 (top row of the window). Checked by values.

## Contract 3: `tests/gpu/firstlight.ts` (page-side; bundled by `tests/e2e/gl.mjs` only; no vitest)
- Export a global `GeoramaFirstLight` with `runFirstLight(input)`. Input: `{ width: number; height: number; threshold: number; mask: string; ground: string; water: string }`, each layer base64 RGBA8.
- Decode with `atob`. Check each decoded length equals width x height x 4. Otherwise throw.
- Step A (orientation probe, 2 x 2): mask alpha 255 everywhere, threshold 128. Ground: texel (0,0) = (255,0,0), others (0,255,0). Water: all (0,0,255). Expected readback row 0 col 0 = (255,0,0,255) and row 1 col 1 = (0,255,0,255). Otherwise the result has `orientation: 'FAIL'`.
- Step B (full window): create the context with `createGlContext(canvas)` on a fresh canvas. Upload the three layers with `uploadRasterLayer(gl, { width, height, format: 'RGBA8', data }, { label })`. Create the target with `createTexture2D(gl, { width, height, format: 'RGBA8', label })`. Create the compositor with `createCompositor(gl)`. Draw with `view = { scale: 1, tx: 0, ty: 0 }`, `mapW = width`, `mapH = height`. Read back with `createFramebuffer(gl, [target])` then `readTexels(gl, fb, 0, 0, 0, width, height)`. Check `gl.getError() === gl.NO_ERROR`. Dispose everything, including the context.
- Step C (CPU reference): for each texel, expected = (mask alpha >= threshold) ? ground RGB : water RGB, alpha 255. Count `exact` (all four channels equal) and `total`.
- Return `{ exact, total, land, water, orientation, readbackBase64, ms }`. `land` and `water` count texels by classification. Never return coordinates.

## Contract 4: `tests/e2e/firstlight-png.mjs` (new)
- `export function encodePngRgba8(width, height, rgba)`: a copy of the encoder in `tests/e2e/compose.mjs` (read it there: 8-bit RGBA, filter byte 0 per row, zlib deflate, CRC32, IHDR/IDAT/IEND). Same output bytes.

## Contract 5: `tests/e2e/gl.mjs` (modify, env-gated)
- Default behaviour (no env) is unchanged: same cases, same expected list, same output lines.
- When `GEORAMA_FIRSTLIGHT_DIR` is set, after the default suite passes in the same Electron instance:
  - Read `mask.rgba`, `ground.rgba`, `water.rgba` and `meta.json` (keys: `width`, `height`, `threshold`) from that directory.
  - Bundle `tests/gpu/firstlight.ts` with esbuild: iife, globalName `GeoramaFirstLight`, platform browser, target es2022.
  - Evaluate with a 120 s timeout: `globalThis.__GEORAMA_FIRSTLIGHT_INPUT__ = ...; <bundle>; GeoramaFirstLight.runFirstLight(globalThis.__GEORAMA_FIRSTLIGHT_INPUT__)`.
  - Print exactly one line: `FIRSTLIGHT exact=<exact>/<total> land=<land> water=<water> orientation=<PASS|FAIL>`. Counts only.
  - Exit 0 only when `exact === total` and `orientation === 'PASS'`. Otherwise `FAIL firstlight: ...` with no coordinates.
  - When `GEORAMA_FIRSTLIGHT_OUT` is also set: create the directory. Write `firstlight-render.png` (encoder from Contract 4) and `firstlight-report.json` (exact, total, land, water, orientation, ms). No paths, no coordinates.

## Contract 6: `tests/corpus/firstlight-extract.test.ts` (vitest corpus config: `npx vitest run --config vitest.corpus.config.ts <file>`)
- Skipped unless both `GEORAMA_FIRSTLIGHT_MAP` (path to one `.wonderdraft_map` file) and `GEORAMA_FIRSTLIGHT_DIR` are set. Under `npm test` it is skipped.
- Guard: throw if the resolved output directory is inside the repository root.
- Read bytes, `readWdMap`, then `validateWdMap` must return no issues. Check that `mask.format`, `ground.format` and `waterTint.format` are `'RGBA8'`.
- Threshold: `thresholdFromWaterLevel(map.waterLevel)` imported from `src/renderer/render/compose/classify.ts`. Throw if not ok.
- Window: `GEORAMA_FIRSTLIGHT_WINDOW=x,y` if set (validated: integers, fully inside the map), else `selectWindow(mask, threshold)`.
- Call `buildFirstLightLayers`. Write `mask.rgba`, `ground.rgba`, `water.rgba` (raw bytes) and `meta.json` `{ width, height, threshold, x0, y0, mapWidth, mapHeight }`.
- Print one line: `FIRSTLIGHT extract land=<n> water=<n> coastLand=<n> coastWater=<n>`. Counts only.

## Acceptance (producer; Node only). Each gate is one direct command. Quote the exit code and the summary line verbatim. Anything you did not see is NOT OBSERVED.
A1. `npx vitest run tests/unit/firstlight-layers.test.ts`: exit 0, passed count = N (report N, the number of `it` cases).
A2. The same file with `--pool=threads`: exit 0.
A3. `npm run typecheck`: exit 0.
A4. `npx vitest run tests/unit/core-boundary.test.ts`: exit 0.
A5. `npm test`: exit 0. Passed count = 2344 + N. Skipped count = 7 (report both).
A6. `npm run build`: exit 0.
A7. RED: before the function bodies exist, the unit file must fail on assertions (not only on imports). Record the RED command, its exit code and the first failing assertion. The RED invocation is the only shell command in its call.
A8. Scope: `git diff --name-only ac6abfa..HEAD` prints exactly the six card files. `git status --porcelain` prints nothing after the commit.
A9. Commit: one commit over `ac6abfa`, author Ichi, subject `feat(0.12): first-light layers, GPU runner and extraction`.
A10. Privacy self-check on your own diff: no map name, folder, size or coordinate constant. Report the grep you ran and its output.

Escalation: two failed attempts at the same gate, or any conflict with this card, means stop and report with evidence. Do not edit files outside the six.

## Parent-owned gates (not the producer)
- Offline shader check on `src/` (no shader change expected).
- Extraction run with the candidate map (Node only, before any GPU run). Counts only.
- GPU window (40 min, opened at the first GPU run): dry tree, then integration tip. Each: first-light `npm run e2e:gl`, `npm run e2e`, `node tests/e2e/cleanup.mjs`. Stop on any FAIL, timeout or visible window.
- Pairing measurement (aggregates only, scratch).
- Mutation sweep on `src/core/firstlight/layers.ts` (parent-run). Survivors are recorded and classified.

## Reviews
- SPEC review and QUALITY review, pinned to the seal SHA. Reviewers read the six files and this card only. No map data, no GPU, no Electron.

## Budget and fuse
- Delegate calls: producer 1, SPEC 1, QUALITY 1. Correction cap 2 (default). Any correction triggers new SPEC and QUALITY reviews.
- Build-phase fuse: 90 minutes from the clock read in this card's commit. A fuse past its deadline holds the feature unmerged.
- GPU window: 40 minutes, opened at the first GPU run, one per card (standing yes).
