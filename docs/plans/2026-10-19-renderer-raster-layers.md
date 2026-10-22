# Renderer raster layers (0.8) Implementation Plan

> **For Hermes:** Ultra Mode v2 pipeline. The producer owns the Node-side source and tests in worktree `t0.8-raster` only. The parent runs mutation measurement, reviews and every GPU/Electron gate, serially.

**Goal:** Upload the three map rasters (`mask` with height in alpha, `ground`, `waterTint`) into GPU textures in bounded row chunks, with every read-back texel exactly equal to the source.

**Architecture:** A pure row-chunk planner (`chunk-plan.ts`) feeds an async uploader (`raster-upload.ts`). The uploader allocates storage with the frozen `createTexture2D` (budget-accounted, no data), writes each row chunk with the frozen `uploadRegion`, and awaits an injected yield between chunks so the UI thread never runs one unbounded upload. An AbortSignal disposes the partial texture, which releases its budget.

**Tech stack:** TypeScript, Vitest (Node unit tests, plus the native GPU harness run by `npm run e2e:gl`), WebGL2 on the frozen `src/renderer/render/gl/*` foundation.

**Fuse (Ultra Mode):** est 45 min, fuse 75 min from 21:22 BRT (absolute 22:37 BRT). Max 8 delegate calls. Source corrections max 2, shared across SPEC and quality.

---

## Source facts (verified at integ `fe2e91a`)

- `WdMap` fields `mask`, `ground`, `waterTint` are `WdRaster` (`src/core/formats/wonderdraft-map.ts`, lines 99 to 101).
- `readRaster` enforces `format === 'RGBA8'`, `mipmaps === false`, and `data.length === width*height*4`, row-major, top-left origin. The renderer re-checks these as defense in depth.
- `mask` alpha is the heightmap (land when `A >= round(water_level*255)`). `ground` is opaque. `waterTint` is sparse, with alpha 0 on most texels.
- Frozen foundation: `createTexture2D(gl, spec, budget?)`, `uploadRegion(gl, tex, x, y, w, h, data)`, `readTexels(gl, fb, attachment, x, y, w, h)`, `createFramebuffer(gl, [tex])`, and `GlBudget` (default 3 GiB). `GlError` codes come from `src/renderer/render/gl/errors.ts`.

> **Superseded in part (2026-10-19).** The first producer stopped on a card contradiction: its Node-tested tests imported WebGL-typed modules into the DOM-free node program. The repair card `docs/plans/2026-10-19-renderer-raster-layers-repair.md` (commit `2a4f17f`) governs wherever it differs from this plan. In particular, the planner returns verdicts and never throws, and the Proxy guard test is replaced by native GPU rejection cases.

## Tasks

### Task 1: `planRowChunks` (pure)

**Files:** create `src/renderer/render/layers/chunk-plan.ts`; create `tests/unit/render-layers-chunk-plan.test.ts`.

**Interface:** `export interface RowChunk { readonly y0: number; readonly rows: number }` and `export function planRowChunks(width: number, height: number, maxChunkBytes: number): readonly RowChunk[]`.

**Behavior:** rows per chunk = `floor(maxChunkBytes / (width*4))`. Chunks are ordered, contiguous, and cover `[0, height)` exactly; the last chunk may be short. Invalid input throws `GlError`: width or height not a safe integer, or below 1, gives `LIMIT`; `maxChunkBytes` below one row (`width*4`) gives `LIMIT`.

**TDD:** RED is the missing-module run, as the sole command in its call. Then one behavioral RED per validation class, each guard added only after its own failing test. Then GREEN.

### Task 2: `uploadRasterLayer` validation (no GL touched)

**Files:** create `src/renderer/render/layers/raster-upload.ts`. The file `tests/unit/render-layers-upload-guards.test.ts` is superseded and deleted, because no Node test may import the GL uploader. Rejections move to `tests/gpu/cases-layers.ts`.

**Interface:**

```ts
export interface RasterSource { readonly width: number; readonly height: number; readonly format: string; readonly data: Uint8Array }
export interface UploadOptions { readonly label?: string; readonly budget?: GlBudget; readonly maxChunkBytes?: number; readonly yieldFrame?: () => Promise<void>; readonly signal?: AbortSignal }
export interface UploadedLayer { readonly texture: GlTexture; readonly chunks: number; readonly yields: number }
export function uploadRasterLayer(gl: WebGL2RenderingContext, raster: RasterSource, options?: UploadOptions): Promise<UploadedLayer>
```

**Validation order, all before the first GL call:** raster is an object; `format === 'RGBA8'`, else `UPLOAD`; width and height are safe integers of at least 1, else `LIMIT`; `data` is a `Uint8Array` with length `w*h*4`, else `UPLOAD`; `maxChunkBytes` defaults to 1048576 and must be at least `width*4`, else `LIMIT`; a signal that is already aborted gives `UPLOAD`.

**Test (superseded):** the Proxy test cannot run in the Node program. The bad-input table is checked natively in `tests/gpu/cases-layers.ts` (case d), and the Node test covers the verdicts of `planRasterUpload`.

### Task 3: chunked upload loop

**Implementation:** `createTexture2D(gl, {width, height, format: 'RGBA8', label}, budget)` with no data. For each chunk from `planRowChunks`: check the signal, then `uploadRegion(gl, tex, 0, y0, width, rows, data.subarray(y0*width*4, (y0+rows)*width*4))`. If more chunks remain, `await yieldFrame()` (default `setTimeout(0)`) and count the yield, then re-check the signal. On any throw, call `texture.dispose()` (which releases the budget) and rethrow. Return `{texture, chunks, yields}`.

### Task 4: native GPU cases (parent-run)

**Files:** create `tests/gpu/cases-layers.ts`; modify `tests/gpu/index.ts` with one import and one spread entry in `ALL_CASES`.

- `layers: chunked upload exact (mask, ground, waterTint)`: 37x23 synthetic layers, `maxChunkBytes` = 3 rows. Assert `chunks === ceil(23/3)` and `yields === chunks-1`. Read back every texel with `readTexels` and compare exactly.
- `layers: random texels exact on a larger layer`: 1024x512 deterministic PRNG pattern, default chunk size, N = 256 random texels read individually and compared exactly.
- `layers: budget and abort cleanup`: while the layer is alive, budget used equals `w*h*4`. After dispose, used is 0. An abort inside `yieldFrame` rejects with `UPLOAD`, leaves budget used at 0, and produces no GL error.

### Task 5: Node gates (producer)

Producer runs only: `npm run typecheck`; `node_modules/.bin/vitest run tests/unit/render-layers-chunk-plan.test.ts`; the same with `--pool=threads --no-file-parallelism`; `npm test`; `npm run build`. Never `npm run app`, never `npm run e2e*`, never an Electron process. The parent runs GPU gates serially.

## Acceptance (lettered)

- **A.** Planner RED/GREEN evidence, invalid-input table, coverage invariant.
- **B.** Every bad input rejects before GL is touched.
- **C.** Chunked exact upload of mask, ground and waterTint, native (parent-run).
- **D.** Random-texel exactness, native (parent-run).
- **E.** Budget and abort cleanup, native (parent-run).
- **F.** Node gates green. The `e2e:gl` count equals the previous 10 plus the new cases; the parent reports the actual number.
- **Real-map proof:** BLOCKED while the external volume is absent (`/proc/self/mountinfo` shows no `<redacted>` mounts). Synthetic proof only. Real maps are not claimed.

## Frozen

`src/renderer/render/gl/*`, `src/core/*`, `electron/*`, `src/shared/*`, `spike/`, `package.json`, tsconfig/vite/vitest configs, and all existing tests except the one-line change to `tests/gpu/index.ts`.
