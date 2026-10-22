# 0.10 Distance field and coast v0: jump-flood seed field and outline (rev 2.2)

Phase 0 card 0.10 in docs/plans/2026-10-15-georama-master-plan.md (line 78). Evidence named there: SDF time on the two plan sizes, and a coastline screenshot.

Rev 2 supersedes rev 1 (commit 5786e6a). Rev 2.1 applies the Minor items of the rev-2 audit (deleg_af4f7f34, passed: true): the branch name, the GpuCase detail type, the timing exclusion, the boundary suite name, and the removed plan size. No gate or contract changed. Rev 2.2 (2026-10-20) adds the two unit-test files that mirror the GPU case names (section 6) and pins the outline comparison (section 4), after producer A (deleg_24921226) reported a card omission at its A5 gate and the parent found a shader defect. Rev 1 failed the contradiction audit deleg_21e10600 (passed: false, scope_ok: false). The audit found: a wrong base (the GL tree is not on master); LIMIT and INPUT verdicts left unnamed; an unconditional sentinel candidate that overflows int32 on the GPU; acceptance items without commands or exit codes; no way to forward the timing sizes or print timing lines. Rev 2 fixes each of these. The hand example in section 3 was re-derived and matches the audit's derivation.

## 1. Base, worktree and identity

- Base: branch `integ/phase0-b` at commit `0b8b64e`. Check `git rev-parse --short HEAD` before dispatch. Any other tip contradicts this card: stop and report.
- The GL modules, `tests/gpu/`, `tests/e2e/gl.mjs` and the `e2e:gl` script exist only on that branch. Every path below is relative to the base.
- Worktree: `<redacted>/Documents/georama-wt/t0.10-sdf` on branch `task/0.10-sdf`, created from `0b8b64e`. Ignored symlink `node_modules` → `<redacted>/Documents/georama/node_modules`. No install, no global npm.
- Commit identity: `git -c user.name=Ichi -c user.email=ichi@localhost commit`. Never run `git config user.*`.
- This card lives on master as documentation. It is the only 0.10 change on master.

## 2. Objective

From a land/water class grid, compute on the GPU the jump-flood seed field and the coastline outline. The CPU reference in `src/core/sdf/jfa.ts` defines the exact contract. GPU output must equal the reference byte for byte on every synthetic grid. Timing and screenshots are evidence, never a pass criterion.

## 3. Reference (`src/core/sdf/jfa.ts`, new)

Exported names are fixed:

```ts
export const JFA_MAX_SIDE = 16384;
export const JFA_SENTINEL = 65535;
export type JfaCode = 'INPUT' | 'LIMIT';
export interface ClassGrid { readonly width: number; readonly height: number; readonly land: Uint8Array; }
export type GridCheck = { readonly ok: true } | { readonly ok: false; readonly code: JfaCode; readonly message: string };
export function validateClassGrid(grid: ClassGrid): GridCheck;
export type JfaVerdict =
  | { readonly ok: true; readonly seeds: Uint16Array; readonly outline: Uint8Array }
  | { readonly ok: false; readonly code: JfaCode; readonly message: string };
export function jumpFloodReference(grid: ClassGrid): JfaVerdict;
```

Layout. `land[y * width + x]` is 1 for land and 0 for water. `seeds` has length 2·W·H. For texel i = y·W + x, `seeds[2i]` is the seed x and `seeds[2i+1]` the seed y; a texel without a seed holds (65535, 65535). `outline` has length W·H and holds exactly 0 or 255 (255 = coast).

Validation (`validateClassGrid`; first failure wins; never throws):
1. INPUT when width or height is not a safe integer ≥ 1, `land` is not a `Uint8Array`, `land.length !== width·height`, or any land value is not 0 or 1.
2. LIMIT when width > 16384 or height > 16384.

`jumpFloodReference` returns the failing check unchanged; otherwise it computes the result. It uses typed arrays and no per-texel allocation, so a grid of the larger plan size runs in scratch time (section 8).

Algorithm.
- Outline: texel p is coast (255) when some 4-neighbour q inside the grid has `land[q] ≠ land[p]`. Neighbours outside the grid are ignored, so the grid border is not a coast.
- Init: S0(p) = p for coast texels; NONE otherwise. NONE is the pair (65535, 65535). NONE is never a candidate.
- Passes: K is the smallest integer k ≥ 0 with 2^k ≥ max(W,H). K = 0 when max(W,H) = 1 (no passes). For k = K−1 down to 0, with s = 2^k, compute S' from S (S' reads only S):
  - Candidate set C(p) = {S(p) if S(p) ≠ NONE} ∪ {S(q) : q = p + (dx,dy), dx, dy ∈ {−s, 0, s}, (dx,dy) ≠ (0,0), q inside the grid, S(q) ≠ NONE}.
  - If C(p) is empty, S'(p) = NONE. Otherwise S'(p) is the candidate c minimising the key (dsq, cy, cx) lexicographically, where dsq = (cx − x)² + (cy − y)².
- Output: `seeds` from S after the last pass; `outline` as above.
- Bounds: coordinates are at most 16383, so dsq ≤ 2·16383² = 536 805 378 < 2³¹. NONE is excluded from C(p), so no sentinel distance is ever formed. Under exact arithmetic, excluding NONE gives the same output as including it, because a NONE candidate wins only when no real candidate exists.

Hand example (W = 4, H = 3, land only at (1,1)). Derived by hand; the implementer re-derives it before running the code.
- outline, rows y = 0..2: `0 1 0 0` / `1 1 1 0` / `0 1 0 0` (255 where 1).
- seeds, as (x,y), rows y = 0..2:
  - y = 0: (1,0) (1,0) (1,0) (2,1)
  - y = 1: (0,1) (1,1) (2,1) (2,1)
  - y = 2: (0,1) (1,2) (2,1) (2,1)
- Tie rule: texel (0,0) has candidates (1,0) and (0,1), both at dsq 1; cy = 0 wins, so (1,0).

## 4. GPU module (`src/renderer/render/sdf/jfa-gpu.ts`, new)

```ts
export interface JfaGpuOptions { readonly budget: GlBudget; readonly maxTextureSize?: number; }
export function jumpFloodGpu(gl: WebGL2RenderingContext, grid: ClassGrid, options: JfaGpuOptions): { readonly seeds: Uint16Array; readonly outline: Uint8Array };
```

- `GlBudget` comes from `src/renderer/render/gl/budget.ts`; `new GlBudget()` gives the default limit.
- Refusals happen before any GL allocation. An INPUT verdict throws `GlError('UPLOAD', message)`. A LIMIT verdict throws `GlError('LIMIT', message)`. A max(W,H) above `options.maxTextureSize` (default `gl.getParameter(gl.MAX_TEXTURE_SIZE)`) throws `GlError('LIMIT', message)`. `GlError` and its codes come from `src/renderer/render/gl/errors.ts`.
- Pipeline:
  1. Upload `land` as an R8 texture (255 for land, 0 for water) with `createTexture2D`.
  2. Outline pass into an R8 target, reading land with bounds-checked `texelFetch`. The texture holds 0 or 255, so `landAt` returns 0 or 255 for in-grid texels and -1 outside the grid. A neighbour q is a coast partner when `q >= 0` and `q != v`. Never compare with `1 - v`: that value is 1 or -254 for the 0/<redacted> texture, so the outline would be empty (rev 2.2).
  3. Init pass into one of two RG16UI ping-pong targets, from the outline.
  4. K passes with an integer step uniform. Each pass reads one RG16UI target and writes the other. Integer math only (`ivec2`, `int`), bounds-checked fetches, NONE candidates skipped, the key of section 3.
  5. Readback with `readTexels(gl, fb, attachment, x, y, width, height)` over the full rectangle. Outline comes from the R channel of the R8 target; seeds come from the R and G channels of the final RG16UI target (the readback is Uint32Array, four values per texel). Project both into the reference layout: outline 0 or 255; seeds interleaved as Uint16.
- Programs: `createProgram` from `src/renderer/render/gl/shader.ts` with `ProgramSource { label, vertex, fragment, uniforms }`. Framebuffers: `createFramebuffer` from `src/renderer/render/gl/fbo.ts`.
- Draw: the vertex-ID triangle `COMPOSE_VERTEX` from `src/renderer/render/compose/shaders.ts`, with `gl.viewport(0, 0, W, H)` and `gl.drawArrays(gl.TRIANGLES, 0, 3)` as in `src/renderer/render/compose/compositor.ts`. No VAO is bound; the compositor binds none.
- Lifecycle: dispose every texture, framebuffer and program in a `finally` block. Unbind everything the function binds (framebuffer, program, texture units) so GL state matches entry. `budget.usedBytes` is 0 on return. Follow `src/renderer/render/layers/raster-upload.ts` (0.8) for lifecycle and error style.
- Each shader comment names the section-3 rule it implements.

## 5. Harness

`tests/gpu/cases-sdf.ts` (new). Synthetic cases, names exact (each prints one PASS line):
- `sdf: 1x1 water`, `sdf: 4x4 all land`, `sdf: 5x3 all water`, `sdf: 7x1 row`, `sdf: 1x6 column`, `sdf: 4x3 hand example`, `sdf: 9x7 two islands`, `sdf: 8x8 checkerboard`, `sdf: 64x48 seeded`.
- Each compares `jumpFloodGpu` output with `jumpFloodReference`, element by element, exact equality.
- The 64×48 grid comes from a linear congruential generator whose constants are written in the file.
- `sdf: refusals and limits` checks, each by the thrown error's `code`: a 9×1 grid with `maxTextureSize: 8` gives LIMIT; a land array of the wrong length gives UPLOAD; a side of 16385 gives LIMIT.
- `sdf: timing` runs only when `globalThis.__GEORAMA_SDF_SIZES__` is a non-empty string. Each size is a `WxH` pair. For each size: one warm-up call (not counted), then five timed calls of `jumpFloodGpu` on a disc-shaped land grid built with integer arithmetic. The result's `detail` holds the median and p95 per size. Without the global the case is absent from the run and prints nothing.

`tests/gpu/index.ts` (modify): one import; the synthetic cases and the timing function spread into `ALL_CASES`. A case's run function may return `void` or `{ detail: string }`, and the result copies the optional `detail` into the report (today `runAll` hardcodes an empty detail). No other change to `GpuCase` or `runAll`.

`tests/e2e/gl.mjs` (modify, exactly three edits):
- (a) Read `GEORAMA_SDF_TIMING_SIZES`. Unset or empty means null. Otherwise it must match `^\d+x\d+(,\d+x\d+)*$` with each side from 1 to 16384, or the run fails before the page loads. Prefix the evaluate string with `globalThis.__GEORAMA_SDF_SIZES__ = <JSON of the validated value, or null>;`.
- (b) Add the ten synthetic names of section 5 to `EXPECTED_CASES`, so a missing case fails the gate. `sdf: timing` is not in `EXPECTED_CASES`: it appears only when the env var is set.
- (c) After each PASS line, print `DETAIL <detail>` when the result carries a `detail` string.

## 6. Files (exact; nothing else may change)

New: `src/core/sdf/jfa.ts`, `tests/unit/core-sdf-jfa.test.ts`, `src/renderer/render/sdf/jfa-gpu.ts`, `tests/gpu/cases-sdf.ts`.
Modified: `tests/gpu/index.ts`, `tests/e2e/gl.mjs` (the three edits in section 5), `tests/helpers/gl-runner-fixture.ts` (rev 2.2: `passReport()` lists the ten sdf names of section 5 after the ten existing names, in the same order as EXPECTED_CASES; no other change), `tests/unit/gl-runner-lifecycle.test.ts` (rev 2.2: in the successful-control test the title says twenty cases, `GPU CASES 10 passed` becomes `GPU CASES 20 passed`, the PASS count becomes 20, and the negative assertion at line 79 uses `GPU CASES 20 passed, 0 failed`; no other change).
Not allowed: `src/renderer/render/gl/*`, `src/renderer/render/compose/*`, `src/core/*` outside `src/core/sdf`, `electron/*`, `src/shared/*`, `package.json`, tsconfig and vitest configs, `spike/`, and every existing test file not listed under Modified.
Strength cases fold into `tests/unit/core-sdf-jfa.test.ts`. No other test file may be added.

## 7. Acceptance (each item: command and required exit code)

Producer, Node only, in the worktree:
- A1. RED, as the sole command of its tool call: `node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts` with the test file present and `src/core/sdf/jfa.ts` absent. Required: exit ≠ 0 from the missing import. Recorded as setup RED, not behaviour.
- A2. `node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts` → exit 0.
- A3. `node_modules/.bin/vitest run tests/unit/core-sdf-jfa.test.ts --pool=threads --no-file-parallelism` → exit 0.
- A4. `npm run typecheck` → exit 0 (covers the GPU files).
- A5. `npm test` → exit 0. Passed must equal 2231 plus the number of new tests (baseline at `0b8b64e`: 2231 passed, 7 skipped); with 32 new tests the expected result is 2263 passed, 7 skipped, and the lifecycle test passes with twenty names. Any other number is reported with its cause.
- A5b. The portable-core boundary suite is `tests/unit/core-boundary.test.ts`; it runs inside `npm test` (A5). Report its line in the A5 output; it must pass.
- A6. `npm run build` → exit 0.
- A7. Privacy scan of added lines against the base, with a positive control first. The parent writes the pattern file in scratch. Committed files and the commit message contain no private value.

Parent, GPU window only (section 9):
- B1. `npm run e2e:gl` → exit 0. All 10 synthetic names and the 10 existing names print PASS; no FAIL line.
- B2. `npm run e2e` → exit 0, 9/9. `node tests/e2e/cleanup.mjs` → exit 0, 3/3.
- B3. Timing evidence: `GEORAMA_SDF_TIMING_SIZES=<the two plan sizes, taken from the master plan and typed into the environment only> npm run e2e:gl` → exit 0 with DETAIL lines. Kept in scratch.
- B4. Before and after the window: `pgrep -x electron` returns nothing, and no e2e temp directories remain.

Evidence, not gated:
- C1. Approximation: the fraction of texels whose seed is not the true nearest coast texel, on the synthetic grids, by brute force in scratch. No threshold.
- C2. Coastline picture of map 6 (section 8).
- G. Mutation measurement of `jfa.ts` with the ultra-mode runner (operator rows and omission rows; equivalents shown by probe or reasoning). Measured after the producer's seal and reported separately.

## <redacted> Coastline of map 6 (C2, scratch, Node only)

`readWdMap` in `src/core/formats/wonderdraft-map-file.ts` decodes a `.wonderdraft_map`. Its `mask` raster is the heightmap (RGBA8; the alpha channel is the height), and `waterLevel` is the map's water level. Land ⇔ alpha ≥ round(waterLevel × 255). This is the rule of FORMAT doc §4 and of `thresholdFromWaterLevel` and `isLand` in `src/renderer/render/compose/classify.ts`.

The parent reads the map file read-only, builds the class grid in scratch, runs `jumpFloodReference` on it, writes the outline to a PNG in scratch, and views the PNG. The owner judges the image. Nothing derived from the map is committed.

The picture comes from the reference, not from the GPU, because the GPU harness does not load map data. GPU exactness is shown by section 7 on the synthetic grids.

## 9. Budget and approvals

- Delegate calls: at most 10 (call 1 is the rev-1 audit `deleg_21e10600`). Source corrections: at most 2.
- Producers run Node only. They never run `e2e:gl`, `e2e`, or any GPU command.
- GPU runs are the parent's: serial and hidden (the harness sets `GEORAMA_E2E=1`). The first GPU run needs the owner's window approval through clarify before it starts. The window is about 20 minutes, and nothing else runs during it.

## 10. TDD order (producer)

Vertical slices, one behaviour per RED→GREEN, in this order:
1. the hand example outline;
2. the hand example seeds;
3. each INPUT rule;
4. each LIMIT rule;
5. the empty, all-land, all-water and 1×1 grids;
6. determinism;
7. property tests with a seeded generator, including an independent naive implementation of the same rules as an oracle on grids of at most 24×24.

No validation guard exists before its own test. The minimal first module returns only what test 1 needs.

Then the GPU files: `cases-sdf.ts` first (RED: `jfa-gpu.ts` missing, shown by A4), then `jfa-gpu.ts`, `index.ts`, `gl.mjs`, then A4–A7.

Timing is never used to pass or fail anything. Exactness is the gate.
