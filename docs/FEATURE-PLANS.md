# Feature plans

Status as of 2026-10-26. Each item says what to build, which files it touches, which tests to write first, and when it is done. The gates are the ones in [CONTRACT.md section 6](CONTRACT.md#6-gates).

Markers:

- **Owner decision:** waits for the owner.
- **Window:** needs a hidden GPU or Electron run, which the owner approves.
- **Good first task:** small, self-contained, and suitable for a first pull request.

To take an item, follow [CONTRACT.md section 5](CONTRACT.md#5-how-a-change-moves-to-a-merge). Open an issue first if the item is large or touches the Electron boundary.

## A. Maintenance and correctness

### A1. Electron 44.9.3 patch (pull request #25)

- **Status:** ready for review. The change touches two files, `package.json` and `package-lock.json`. The lock entry's integrity value matches the npm registry value for 44.9.3.
- **Why:** 44.7.0 is no longer the latest patch of its line, and only the latest patch receives fixes. Advisory GHSA-jr5w-w6x2-84p9 (CVE-2026-115570, high, CVSS 7.4) affects 44.7.0 and is fixed in 44.9.1. The advisory database lists no advisory for 44.9.3. The advisory concerns apps that make TLS connections over a network an attacker can intercept. The app makes no network connections by design ([SECURITY.md](SECURITY.md)), so the exposure is low, and the update is still due.
- **Steps:** check the lock entry against the registry; run the Node gates on the merged result; run the hidden smoke and boundary checks.
- **Done when:** the Node gates pass on the merged result, and the hidden smoke and boundary checks pass on 44.9.3. **Window.**

### A2. Electron 45 migration

- **Status:** planned. **Owner decision** on timing. Electron 45.0.0 is the latest stable release (published 2026-10-21). It is a new major line, so it needs its own branch and its own checks.
- **Breaking changes that matter here**, from the 45.0.0 release notes: sandboxed preload scripts lose the `events`, `timers` and `url` modules and the `Buffer`, `setImmediate` and `clearImmediate` globals; `contentTracing.enableHeapProfiling()` is removed; `app.setLoginItemSettings()` no longer accepts `openAsHidden`; the synchronous `safeStorage` methods are deprecated. A search of the current `electron/` and `src/` code found none of these APIs. A search is not a test. The runs below are.
- **Steps:** read the full 45.0.0 breaking-change list; upgrade on a branch; search the preload and the renderer for Node globals and modules the sandbox no longer provides; run the Node gates, the hidden smoke, the boundary check and the GPU check. **Window.**
- **Done when:** every gate passes on 45.x, and each run names its Electron version.

### A3. `fitView` and `oneToOne` return non-finite translations (good first task)

- **Status:** open.
- **Evidence:** on the current code, with the view width and height both at the largest finite double, `fitView(1.7191700431418136e308, 1, Number.MAX_VALUE, Number.MAX_VALUE)` returns `ok: true` with `tx: -Infinity`. In a probe of 300,000 map sizes chosen so that `mapW × scale` rounds past the largest double, 27,280 calls returned `ok: true` with a non-finite translation. The same probe found no non-finite result from `oneToOne`. Pull request #17 added finite checks to `screenToMap`, `zoomAt` and `panBy`, but not to `fitView` or `oneToOne`.
- **Files:** `src/renderer/render/view/viewport.ts`, `tests/unit/render-view-viewport.test.ts`.
- **Steps, test first:**
  1. Add a test that calls `fitView` with the inputs above and asserts that the result is not `ok: true` with a non-finite translation. Run it on `main`; it must fail.
  2. In `fitView`, compute `tx` and `ty`, and return `{ ok: false, code: 'LIMIT', message }` when either is not finite. Follow the pattern of pull request #17.
  3. For `oneToOne`, add a regression test on extreme inputs. Add a guard only if a failing input exists.
- **Done when:** the new test fails before the change and passes after it, the existing viewport tests still pass, and the Node gates pass.

### A4. Hardening the Electron asset reads (issue #5)

- **Status:** open, partly fixed. Pull request #8 added an aggregate read budget (64 MiB, 16 concurrent reads) and descriptor-bound reads. The owner's comments on issue #5 list what remains.
- **Remaining work that can be tested on Linux:** a read budget measured by the method in the issue (its criterion 5), with the method and the numbers in the pull request; tests that reproduce the filesystem race described in the issue's finding B.
- **Needs other platforms:** the boundary suite on macOS and Windows (criterion 6). Windows work is an **owner decision** (item A5).

### A5. Windows support

- **Status:** held. **Owner decision.** Pull requests #22, #23 and #24 add a Windows launcher, Windows file paths and a native asset reader. Drafts #26 to #28 stack on them. None is merged until the owner decides whether Windows is a supported direction.
- **Why the hold matters for security:** the Windows CI workflows would run pull-request code on a Windows runner. One of them sends its jobs to a self-hosted runner when a repository variable is set, and that is unsafe for code from forks. Any CI needs a decision first.

### A6. Offline shader check (good first task)

- **Status:** open. Shader text lives in TypeScript sources under `src/renderer/render/`, and nothing compiles it before a GPU run.
- **Plan:** add a script that extracts each GLSL source string under `src/renderer/` and compiles it with `glslangValidator`. It fails on any compile error. Add a canary, a shader with a deliberate error, and check that the script fails on it. The script exits non-zero with a clear message if `glslangValidator` is missing; document how to install it in [DEV.md](DEV.md). Add it as a `package.json` script (`check:glsl`). Do not add it to `npm test`, because it needs an external binary.
- **Done when:** the script passes on `main`, fails on the canary, and is documented.

### A7. Test for filter-type-0 PNG rows (follow-up to pull request #29)

- **Status:** open. Pull request #29 skips reconstruction for scanlines with filter type 0. The change is equivalent to the old code, which writes each byte back unchanged, but the pull request adds no test.
- **Plan:** add a test to `tests/unit/assets-png-pixels.test.ts` that decodes a PNG whose every scanline uses filter 0, and checks the output bytes exactly.
- **Done when:** the test passes on `main` with and without pull request #29.

## B. Phase 1: parity renderer

Goal: the renderer draws maps the way the owner's Wonderdraft exports look. The owner judges the look against reference exports. The maths and the byte-exact checks are tests. Reference exports are not in the repository.

### B1. Grade maths in the portable core

- **Status:** planned.
- **Goal:** a pure function that adjusts RGBA8 pixels with explicit parameters: a hue shift in degrees, saturation, value, and a vignette strength. It is deterministic, reports typed errors, and has a pixel cap.
- **Files:** `src/core/color/grade.ts` (new), `tests/unit/core-color-grade.test.ts` (new).
- **Steps, test first:** identity parameters return the input bytes; hue wraps at 360; saturation and value accept 0 to 4 and reject values outside that range; the vignette is zero inside its inner radius and full outside its outer radius; invalid parameters raise `param`; a non-array input raises `length`; a pixel count above the cap raises `limit` before any allocation.
- **Done when:** the tests pass, the portable-core rules hold, and the Node gates pass.

### B2. Byte-exact grade shader. **Window.**

- **Goal:** the grade of B1 on the GPU, with the output compared byte for byte with the CPU function.
- **Files:** `src/renderer/render/grade/shaders.ts`, `src/renderer/render/grade/program.ts`, `tests/gpu/grade-vectors.ts`, `tests/gpu/cases-grade.ts`, `tests/gpu/index.ts`, `tests/e2e/gl.mjs` (the expected case list), `tests/helpers/gl-runner-fixture.ts` and `tests/unit/gl-runner-lifecycle.test.ts` (the case count).
- **Rule for the fixed vectors:** a GPU float can round differently from the CPU at a rounding edge. Keep every checked value at least 0.01 away from a rounding edge, by rejection sampling from a fixed seed, so that exact bytes can be required.
- **Steps:** the shader passes the offline check (A6) once it exists; the GPU case compares bytes; a mutant that removes the `+ 0.5` in the second rounding stage must make the case fail.
- **Done when:** the GPU case passes and is named in the run output.

### B3. Water and ground textures

- Procedural textures only. No Wonderdraft texture is bundled or copied. The texture function is deterministic from a seed and lives in `src/core/`; the sampling lives in the renderer. Tests cover determinism, tiling at the edges, and bounds. The owner judges the look.

### B4. Coast effects, textured paths, territory borders, curved labels, grid, scale and boxes

- One pull request per effect. Each starts with its pure geometry or colour maths in `src/core/`, under tests written first. Then comes one GPU or compositor case, and then the owner's visual approval.

### B5. Full-resolution export. **Window.**

- Read back the render target at full size, encode it as PNG, and refuse sizes above a documented cap. Tests cover the cap and the encoder. The readback case is a window run.

## C. Phase 2: editor core

Goal: make maps, not only view them. Every edit goes through a command bus.

### C1. Command bus with undo and redo

- **Design:** each edit is a command with `apply` and `invert`. A command stores a tile diff, not a copy of the map. A command never mutates its inputs.
- **Files:** `src/core/edit/` (new): `command.ts`, `tile-diff.ts`, `history.ts`; tests in `tests/unit/edit-history.test.ts` (new).
- **Steps, test first:** a seeded random sequence of commands, undone in full, returns the initial state; redone in full, returns the final state; undo after redo restores the same state; no command changes its input.
- **Done when:** the property tests pass with at least three fixed seeds, and the portable-core rules hold.

### C2. Tools, one pull request each: landmass, ground, path, symbol, region, label

- Each tool is a pure command in `src/core/edit/` with tests, then a renderer tool that issues the command. A tool that changes what is saved needs a round-trip test (C4).

### C3. Layers

- A layer model with order, visibility and lock. Tests cover the ordering, and that hidden layers are excluded from export.

### C4. Save and export

- A documented native save format, and export back to `.wonderdraft_map` (format version 15) with a round-trip test on synthetic maps. The owner runs the round trip on the owner's own maps, through the corpus gate. Contributors do not have those maps.

## D. Phase 3: improvements

Approved order: D1, D2, D3, D4, D5, D6, D7. D8 is standing. Each item starts with a short design note in its first pull request.

### D1. World mode

- Wrap painting across the left and right edges; brush and symbol scale that depend on latitude; projection exports (orthographic, cubemap, heightmap).
- First pull request: wrap painting in the core, with tests at the seam.

### D2. Symbol power tools

- Select, group and lock; density and biome scatter; per-instance variation; a pack manager with metadata and search.
- First pull request: selection and grouping in the core.

### D3. Label system

- Automatic placement with collision avoidance; labels along a path; presets; bulk edit and search.
- First pull request: collision tests on synthetic boxes.

### D4. Terrain intelligence

- Rivers from flow over the height field; lakes; hillshade and contours; biome painting from height and latitude.
- First pull request: flow accumulation on a synthetic height field, with a known answer.

### D5. Link to external notes

- Labels and regions link to notes through a documented JSON exchange file. The repository stores no notes and no world content. The link is a file format with tests, and a marker export for an external viewer.

### D6. Agent-drivable tools

- A command-line tool first: open a map, edit it, batch-render it. Then an MCP wrapper over the same operations.
- First pull request: open and render in the CLI, on synthetic maps.

### D7. Large maps

- Sparse tile storage for maps above 16,000 pixels on a side; tiled export; a memory-budget test.
- First pull request: the tile index, tested on synthetic sizes.

### D8. Regression tests from reported bugs (standing)

- Each reproducible Wonderdraft bug that the owner names becomes a failing test first, then the fix. A report needs the Wonderdraft version and the steps. It does not need any map content.

## E. Decisions the owner makes

- Windows as a supported direction (A5).
- The timing of the Electron 45 migration (A2).
- Private vulnerability reporting for the repository (contract section 8).
- Merging pull requests #25, #29, #30, #31 and #32, one at a time.
