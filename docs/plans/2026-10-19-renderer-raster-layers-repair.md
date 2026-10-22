# CARD REPAIR for 0.8 renderer raster layers (contradiction in the WIP card)

Worktree: <redacted>/Documents/georama-wt/t0.8-raster, branch task/0.8-raster.
HEAD is 78bd53e9a92f8786f49880961a4cdf89c99ee37c, a WIP commit on top of base fe2e91a29f0b9df78114d9f7461c03e5cbfb79ba.
node_modules is a git-ignored symlink. Do not install anything. Do not touch other worktrees or the main repo.

## Why this card exists
The WIP unit test imports modules that reference WebGL DOM types (src/renderer/render/gl/errors.ts and texture.ts).
tsconfig.node.json compiles tests as a DOM-free program. So npm run typecheck and npm run build fail with TS2304 on WebGL2RenderingContext and WebGLTexture,
and tests/unit/core-boundary.test.ts forbids lib.dom in that program.
Repair: the Node-tested logic moves to a module with ZERO import statements and no WebGL or DOM types.
The GL uploader keeps GlError and calls that pure module. Rejections that need a real GL context are tested natively in tests/gpu, which the parent runs.
Do not add reference-lib directives. Do not edit tsconfig, vitest, vite or package files. Do not edit tests/helpers or tests/unit/core-boundary.test.ts. Do not edit anything under src/renderer/render/gl/.

## Hard prohibitions
No npm run app. No npm run e2e, e2e:gl or cleanup. No Electron process. No GPU. No network. No package installs. No npx rea-agents. No access to spike/. No git config writes. No reads of map or private files.

## Commands
Run every verification as ONE direct command in the worktree directory: no pipes, no echo chains, no && chains.
Vitest: node_modules/.bin/vitest run FILES (no --prefix). Commits: git -c user.name=Ichi -c user.email=ichi@localhost commit ...

## File scope (final state relative to fe2e91a: 5 added files and 1 modified file; 1 WIP file is deleted)
1. REWRITE src/renderer/render/layers/chunk-plan.ts. It has ZERO import statements.
2. REWRITE src/renderer/render/layers/raster-upload.ts (GL side).
3. REWRITE tests/unit/render-layers-chunk-plan.test.ts. It imports ONLY chunk-plan.ts and vitest.
4. REWRITE tests/gpu/cases-layers.ts.
5. DELETE tests/unit/render-layers-upload-guards.test.ts with git rm. It imports the GL uploader and cannot compile in the Node program.
6. tests/gpu/index.ts keeps the WIP content: one import line for layersCases and one spread of layersCases in ALL_CASES. Edit only if that content is missing.

## Interface: chunk-plan.ts (exact)
- export interface RasterShape: readonly width (number), readonly height (number), readonly format (string), readonly data (Uint8Array).
- export interface RowChunk: readonly y0 (number), readonly rows (number).
- export type RasterPlan, a union. Success: { ok: true, chunks: readonly RowChunk[] }. Failure: { ok: false, code: 'UPLOAD' or 'LIMIT', message: string }.
- export const DEFAULT_CHUNK_BYTES = 1048576.
- export function planRasterUpload(raster: unknown, maxChunkBytes?: number): RasterPlan. It NEVER throws; every failure is a returned verdict.
Checks in this order; first failure wins:
 a. raster is not a non-null object: UPLOAD, message 'raster must be an object'.
 b. raster.format is not exactly the string RGBA8: UPLOAD.
 c. width is not a safe integer, or is below 1: LIMIT. Check width before height.
 d. height is not a safe integer, or is below 1: LIMIT.
 e. data is not an instance of Uint8Array: UPLOAD.
 f. data.length is not exactly width times height times 4: UPLOAD.
 g. maxChunkBytes (undefined means DEFAULT_CHUNK_BYTES) is not a safe integer, or is below width times 4: LIMIT.
On success: rowsPerChunk = floor(maxChunkBytes / (width times 4)). Chunks are in order, contiguous, and cover [0, height) exactly. The last chunk may be shorter.

## Interface: raster-upload.ts
Imports: GlError from '../gl/errors.ts'; type GlBudget from '../gl/budget.ts'; createTexture2D, uploadRegion and type GlTexture from '../gl/texture.ts'; planRasterUpload from './chunk-plan.ts'.
Exports: interface RasterSource (readonly width, height, format, data, as in WIP); interface UploadOptions (optional label, budget, maxChunkBytes, yieldFrame, signal); interface UploadedLayer (texture, chunks, yields); async function uploadRasterLayer(gl, raster, options?) resolving to UploadedLayer.
Order inside uploadRasterLayer:
 1. const plan = planRasterUpload(raster, options maxChunkBytes). If plan.ok is false, throw new GlError(plan.code, plan.message). This happens before ANY GL call and before the signal check.
 2. If options signal is aborted, throw GlError('UPLOAD', 'upload aborted').
 <redacted> texture = createTexture2D(gl, { width, height, format: 'RGBA8', label: options label or 'raster-layer' }, options budget). Do NOT pass data.
 4. try: for each chunk at index i of plan.chunks: if the signal is aborted, throw GlError('UPLOAD', 'upload aborted'). Call uploadRegion(gl, texture, 0, chunk.y0, width, chunk.rows, data.subarray(chunk.y0 * width * 4, (chunk.y0 + chunk.rows) * width * 4)). If it is not the last chunk: await yieldFrame(), where the default yieldFrame resolves after setTimeout with 0 milliseconds; increment yields.
 5. Resolve { texture, chunks: plan.chunks.length, yields }.
 6. On any error: texture.dispose(), then rethrow.

## TDD (mandatory; the parent audits the order)
- Step 1. Rewrite tests/unit/render-layers-chunk-plan.test.ts FIRST for the new API. Run it as the SOLE shell command in its call. Expect failure, because planRasterUpload and DEFAULT_CHUNK_BYTES are not exported yet. Record the exit code and first error line.
- Step 2. Write the MINIMAL chunk-plan.ts: the exported constant, the types and a planRasterUpload with NO guards that computes the valid plan. Run the test. Valid-plan cases should pass; record them as verify-pass, not RED.
- Step 3. For the invalid classes a to g: write ALL their verdict tests first. Run the test file as the sole command and record the genuine failures (ok true, or a crash). Then add the guards, each returning its verdict, and run GREEN. A test asserts plan.ok is false and plan.code equals the expected code. Do not assert against an undefined symbol. If the unguarded planner hangs or exhausts memory on maxChunkBytes below one row, record that crash as the RED with its exit code and first line. Do not add timeouts or wrappers to the source.
- Step 4. Write raster-upload.ts as specified above. No Node test may import it.
- Step 5. Rewrite tests/gpu/cases-layers.ts with the four native cases below.
- Step 6. git rm tests/unit/render-layers-upload-guards.test.ts.

## Native GPU cases: tests/gpu/cases-layers.ts exports layersCases (array of GpuCase: name and run)
Imports from './index.ts': assertEqual, assertThrowsGlAsync, freshCanvas, type GpuCase. Also createGlContext from '../../src/renderer/render/gl/context.ts'; createFramebuffer and readTexels from '../../src/renderer/render/gl/fbo.ts'; GlBudget from '../../src/renderer/render/gl/budget.ts'; uploadRasterLayer and types from '../../src/renderer/render/layers/raster-upload.ts'.
Each case creates its context with createGlContext(freshCanvas()) and disposes it in finally.
(a) 'layers: chunked upload exact (mask, ground, waterTint)': three 37 by 23 RGBA8 layers, maxChunkBytes 444. Expect chunks 8 and yields 7 for each. Read back with createFramebuffer and readTexels(gl, fb, 0, 0, 0, 37, 23); compare every byte exactly. mask: pseudo-random RGBA. ground: pseudo-random RGB with alpha 255. waterTint: pseudo-random RGBA with alpha 0 on most texels.
(b) 'layers: random texels exact on a larger layer': 1024 by 512 ground-like pattern, default chunk size. Compare 256 pseudo-random texels, each read with readTexels 1 by 1.
(c) 'layers: budget and abort cleanup': GlBudget(1048576). Upload the 37 by 23 layer with maxChunkBytes 444: usedBytes equals 37 times 23 times 4; after dispose it is 0. Then an upload whose yieldFrame calls AbortController.abort() must reject with UPLOAD (assertThrowsGlAsync). Afterwards usedBytes is 0 and gl.getError() is NO_ERROR.
(d) 'layers: invalid input rejects before any allocation': for each bad input, assertThrowsGlAsync with the expected code; then usedBytes is 0 and gl.getError() is NO_ERROR. Inputs: null raster (UPLOAD); format R8 (UPLOAD); width 0 (LIMIT); height 1.5 (LIMIT); 2 by 2 RGBA8 with data length 15 (UPLOAD); maxChunkBytes 4 with width 2 (LIMIT).

## Node test: tests/unit/render-layers-chunk-plan.test.ts
Imports ONLY planRasterUpload and DEFAULT_CHUNK_BYTES from '../../src/renderer/render/layers/chunk-plan.ts', plus vitest.
Covers: DEFAULT_CHUNK_BYTES is 1048576; a 37 by 23 raster with maxChunkBytes 444 gives 8 chunks with a 2-row tail; coverage and contiguity for several shapes including 1 by 1 and 5 by 7 with one row per chunk; one verdict per invalid class with the exact code. Verdicts are read, never caught.

## Node gates (each one direct command in the worktree; record exit code and summary line)
1. node_modules/.bin/vitest run tests/unit/render-layers-chunk-plan.test.ts
2. node_modules/.bin/vitest run tests/unit/render-layers-chunk-plan.test.ts --pool=threads --no-file-parallelism
3. npm run typecheck (must be exit 0; this is the boundary condition)
4. npm test (must be exit 0)
5. npm run build (must be exit 0)
Before committing, run git status --short and git diff --stat fe2e91a as separate commands and record both outputs.

## Commit
Replace the WIP commit with ONE amended commit, since nothing is pushed. Stage the five files explicitly with git add; use git rm for the deletion.
Then: git -c user.name=Ichi -c user.email=ichi@localhost commit --amend -m "feat(0.8): renderer raster layer upload with DOM-free planner"
Result must have parent fe2e91a29f0b9df78114d9f7461c03e5cbfb79ba and show exactly 5 added files and 1 modified file (tests/gpu/index.ts). Verify with git show --stat HEAD and git log --oneline -2, separately. Never leave a wip commit at HEAD.

## Notes and final answer
Write <redacted>/.hermes/cache/scratch/evidence/T08-raster/NOTES-CORRECTION.md: every command in order with exit code, summary line and time (date --iso-8601=seconds in its own call). Record each RED with exit code and first error line.
Final answer: one JSON object with keys commit (full SHA), parent (SHA), files (added, modified, deleted), gates (name mapped to exit code and summary), tdd (ordered steps with command, exit code and first error line), deviations (string or none), unseen (anything not observed, stated plainly).
Do not read or write any other evidence or scratch directory. Target 15 minutes. If the card contradicts reality, stop and report the evidence instead of working around it.
