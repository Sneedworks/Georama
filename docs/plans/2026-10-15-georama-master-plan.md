# Ge'orama — Master Plan

> **For Hermes:** spec-rail gate → on the owner's "go", run under Ultra Mode (standing consent): serial tasks, fresh implementer → spec review → quality+security review → champion lock → live verification.
> Status: **APPROVED 2026-10-15** by the owner ("do all your suggestions"): stack + clean-room boundary (§2), every improvement A–H in the order of §5, wine reference exports, and a name — **Ge'orama**. Phase 0 runs under Ultra Mode. Live state: `docs/STATE.md`. `spike/` is throwaway analysis, kept as provenance.

**Goal:** A premium, Linux-native fantasy map editor that opens every one of the owner's Wonderdraft maps, matches their look, and then goes beyond Wonderdraft (world-aware tools, terrain intelligence, lore-linked labels, agent-drivable).

**Architecture:** Electron 44 shell (native Wayland) + TypeScript. A GPU compositor (WebGL2) draws layers at *screen* resolution from GPU textures; coast effects come from a jump-flood distance field; symbols are instanced sprites. The document model is pure TypeScript (no DOM, node-testable) with command-bus undo/redo. An interop layer reads `.wonderdraft_map` v15 and Wonderdraft-style asset packs/themes **at runtime from the local install** — never copied or bundled.

**Tech Stack:** Electron 44.7.0 (same as the existing Ge'or Maps viewer) · TypeScript strict · Vite · Vitest · Preact + signals (UI) · hand-written WebGL2 (no render framework) · OFL fonts via npm. Versions pinned at install. Tests run with `npm test`; GPU/UI checks run through CDP against the real app.

**Non-Goals (this pass):** 3D globe view · scripting API · multi-user editing · WebGPU backend · packaging/AppImage · non-Linux builds · any code derived from decompiled Wonderdraft · bundling Wonderdraft art/shaders.

**Repo Context:** `~/Documents/georama` (git, no remote) · docs in `docs/` · format notes `docs/FORMAT-wonderdraft-map-v15.md` · no system installs required (npm only).

---

## 1. Evidence behind the plan (all measured on this machine)

| Fact | Evidence |
|---|---|
| Map format fully decoded | 120/120 files byte-exact (<redacted>, <redacted>, all v15, single schema); 0.58–1.09 s decode each |
| Land is a heightmap | `mask.A ≥ water_level×255`; confirmed visually + 99.5 % of <redacted> symbols on land |
| Maps are big and dense | <redacted> <redacted>s; up to <redacted> symbols, <redacted> labels, <redacted> territories |
| Assets are open data | `.wonderdraft_image` = PNG, themes/symbol sets = JSON; his packs sit in `Wonderdraft appdata/assets` |
| GPU path is real | Electron 44.7 / Chromium 152 / ANGLE on **GTX 1050 Ti**, native Wayland, WebGL2, max texture 32768, WebGPU present |
| Render targets OK at <redacted> | RGBA8 · R8 · R16F · RG16F · RGBA16F · R32F · RG16UI · RGBA8UI all valid |
| Distance field is cheap | 13-pass jump flood at <redacted> ≈ **99 ms** (wall-clock, data-dependent sync) |
| Sprites are cheap | 20k blended sprites @1080p ≈ **1.9 ms** dense, ≈ **0.4 ms** at fit-zoom |
| Upload / memory | 128 MB layer ≈ **61 ms**; ~0.94 GB editor-sized texture set allocates clean |
| VRAM is the tight resource | 4 GB total, ~1.1 GB already used by the desktop → budget ≈ 3 GB |

*Note:* the GPU timer-query path returned 0, so timings above are wall-clock with a dependent readback. Computed (not measured) budget for one <redacted> map on GPU: height R8 32 MB + ground RGBA8 128 MB + tint RGBA8 128 MB + 2× RG16UI SDF 256 MB + symbol atlas ≈ 128 MB ≈ **0.7 GB**.

## 2. Decisions

1. **Stack: Electron + WebGL2** (not Godot 4, not Rust). Reasons: measured GPU viability; fastest build→verify loop for me (CDP + DOM + pixel readback); premium UI is HTML/CSS; reuses the Electron already installed; same map data can feed the Ge'or Maps viewer. WebGPU stays a later option. Fallback if GPU regresses: XWayland flags, then Godot 4.
2. **Clean-room boundary.** Ge'orama gets its own algorithms, shaders, UI and default assets. I read *data* (his maps, his packs, public Godot container layout) — not Wonderdraft's compiled scripts or shaders. I won't port decompiled code or ship Wonderdraft's art inside Ge'orama. REA stays unused unless the data cannot explain something. This also keeps Ge'orama forkable.
3. **Your packs, reused.** An asset resolver reads his Wonderdraft install and `assets/` folder at runtime (built-in `res://…`, default packs, `assets/<pack>/…`). Ge'orama ships its own procedural defaults + OFL fonts.
4. **Verification oracle.** Parity is judged against the real Wonderdraft (wine) exports of the same maps, and finally by the owner's eyes.
5. **Name: Ge'orama** (package/command `georama`). A *georama* is a hollow globe with the world mapped on the inside, so you stand inside the world (Merriam-Webster; Delanglard's opened in Paris in 1825) — exactly where World mode (§5-A) is heading. Fits the Ge'or Maps / Ge'or Archive family. The display name is one constant (`src/shared/brand.ts`) so a rename stays a one-line change.
6. **Process model.** The renderer is sandboxed with no filesystem. The main process only reads bytes (maps, PCK ranges, pack files) behind validated IPC; decoding runs in a renderer Web Worker with transferable buffers straight to the GPU, so a 400 MB payload never crosses IPC (only the 43–107 MB compressed file does).
7. **`src/core` is environment-agnostic** (`Uint8Array` in/out, no `node:*` imports), so identical code runs in the worker, main, tests and the future CLI/MCP (§5-F).

## 3. Phases

| Phase | Outcome | Exit criteria |
|---|---|---|
| **0 Foundation + first light** | Open any of the <redacted> maps, pan/zoom on the GPU | corpus <redacted>; real land/ground/tint render; symbols with real sprites; screenshot vs oracle shown to the owner |
| **1 Parity renderer** | Looks like his Wonderdraft maps | water/ground textures + HSV + vignette, coast effects, textured paths, territory borders, curved labels, grid/scale/boxes, full-res export; the owner signs off visually |
| **2 Editor core** | Make maps, not just view them | command-bus undo/redo (tile diffs), landmass/ground/path/symbol/region/label tools, layers, save native + export back to `.wonderdraft_map` (round-trip) |
| **3 Improvements** | The "better" | all of §5 in the stated order; each gets its own spec-rail plan when reached |

Detail for Phase 1+ is written when reached (rolling-wave) — no speculative task cards.

## 4. Phase 0 task cards (12)

Each: Objective · Evidence required · Excludes. Every code task: failing test first (RED shown), then GREEN, commit per task. Untrusted-input rule for 0.2/0.3: malformed or oversize length fields throw typed errors, never hang, never allocate beyond the buffer.

**0.1 Scaffold.** Electron 44.7.0 + TS strict + Vite + Vitest + Preact; `npm test` / `npm run build` / `npm run app`; native-Wayland flags; `contextIsolation` on, `nodeIntegration` off, narrow preload IPC. *Evidence:* `npm test` and `npm run build` EXIT 0; window titled "Ge'orama" confirmed over CDP. *Excludes:* menus, UI chrome. **Adversary review** (Electron security).

**0.2 `formats/gcpf`.** FastLZ-1 decode + encode, GCPF read/write. *Evidence:* known vectors; round-trips of zeros / random / long runs / exact block multiples (zero-length last block) / >64 KB; truncated & oversize inputs rejected; real-map decode when the volume is mounted.

**0.3 `formats/godot-var`.** Decoder + encoder for types 0–26 incl. Object and NodePath; preserve dictionary key order; reals encode as f32 when exact else f64, ints as the width observed. *Evidence:* decode→encode is **byte-identical** on the payload of all <redacted> maps (width rules proven by the corpus).

**0.4 `formats/wonderdraft-map`.** Typed `WdMap` for v15 (`theme`, `paths`, `territories`, `symbols`, `labels`, rasters as zero-copy views, `points` text → Float32Array) and back to raw. *Evidence:* all 57 normalise; invariants (finite positions, raster byte length = W·H·4).

**0.5 Corpus gate.** `npm run corpus`; vitest suite auto-skips when the volume is absent. *Evidence:* <redacted> parse, normalise, re-encode identical; report with timings.

**0.6 `assets/` (PCK + resolver + config).** Index the `.pck` (offset reads, no extraction), resolve `res://`, default packs and `assets/<pack>`, load theme/symbol JSON; roots in `~/.config/georama/config.json` with auto-detected candidates. *Evidence:* every unique texture of map 6 (284) resolves to a valid PNG — unresolved list printed (target 0). **Adversary review** (file access / path traversal).

**0.7 `render/gl`.** Context, capability probe, shader/texture/FBO helpers, error checks, test readback. *Evidence:* CDP e2e proves context on the real GPU (renderer string) and all required formats.

**0.8 `render/layers`.** Upload `mask` (height = A), `ground`, `water_tint` in chunks without blocking the UI. *Evidence:* N random texels read back equal the source (exact).

**0.9 Viewport + compositor v0.** Pan/zoom/fit/1:1; per-pixel land/water/ground/tint from the height threshold. *Evidence:* screenshot of map 6; frame-time p50/p95 at fit and 1:1 (target ≤ 16.7 ms p95 — a target, recorded as measured).

**0.10 Distance field + coast v0.** Jump-flood SDF + outline. *Evidence:* SDF time on <redacted>×<redacted> and <redacted>; coastline screenshot.

**<redacted> Symbols v0.** Texture atlas from resolved PNGs, instanced draw sorted by (z_index, y), rotation/scale/mirror/offset. *Evidence:* all <redacted> symbols of map 6 drawn; placeholders counted; frame time recorded.

**0.12 First light + oracle.** Run through the hidden harness (`GEORAMA_E2E=1`, no window, a readback PNG of the target, not a page capture). `npm run app` is not used (D8 a). Compare with the real Wonderdraft export of the same map: The owner exports 2–3 reference PNGs himself, with no Wine window (D7 b). *Evidence:* side-by-side handed to the owner — his eyes are the judge.

**Phase 0 done =** all 12 PASS spec review + APPROVED quality review; `npm test` and `npm run build` EXIT 0; corpus <redacted>; no private data in git (`git ls-files` checked); commit ids + screenshots shown.

**Process / fuse:** 12 tasks × (implement + spec + quality) = 36 subagent calls base, + 2 adversary + 1 integration review. Larger than one 90-minute fuse → two waves with checkpoints: 0.1–0.6, then 0.7–0.12. Minutes are not estimated.

## 5. Improvements — all approved

Grounded in what his <redacted> maps actually use (<redacted>s, <redacted> symbols, ~<redacted> labels, ~<redacted> territories).

| # | Improvement | Why it fits his world |
|---|---|---|
| A | **World mode:** seamless left/right wrap painting, latitude-correct brushes and symbol scale, live globe preview, projection exports (orthographic, cubemap, heightmap for 3D) | most of his maps are 2:1 equirectangular; Ge'or is a world |
| B | **Terrain intelligence:** rivers from flow over the heightmap, lakes, hillshade/contours, biome painting from height/latitude | the heightmap already exists in `mask.A` |
| C | **Symbol power tools:** select/group/lock, density & biome scatter, per-instance variation, pack manager with previews/search | up to <redacted> symbols per map |
| D | **Label system:** auto-placement with collision avoidance, curve-along-path, presets, bulk edit/search | <redacted> labels per map |
| E | **Lore-linked map:** labels/regions ↔ Ge'or vault notes; export to the Ge'or Maps viewer with markers | map and archive become one world |
| F | **Agent-drivable:** CLI + MCP — Ichi can open, edit, batch-render any size ("place these 40 cities from the lore") | unique to your setup |
| G | **Big maps:** sparse tile storage for 16k+ px, tiled export for print | VRAM is the limit, not the GPU |
| H | **Your bug list:** every Wonderdraft bug you name becomes a regression test | "some bugs" — tell me which |

**Build order (approved):** A → C → D → B → E → F → G. **H is standing:** every Wonderdraft bug the owner names becomes a regression test. Each item gets a short spec-rail plan when reached (rolling wave), so he can re-rank at any time.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Coast/water look can't be copied from shaders (not read by design) | design by eye against oracle exports; the owner's eyes are final |
| 4 GB VRAM with ~1.1 GB already taken | R8 height, sparse tint, screen-res compositing, sparse tiles in G |
| NVIDIA + Wayland driver drift | measured working now; documented XWayland fallback |
| Curved labels with many fonts | OFL fonts + SDF or canvas-to-texture; own spike in Phase 1 |
| Round-trip export to `.wonderdraft_map` (Object/NinePatchRect records) | payload byte-identity proven on corpus in <redacted>/<redacted>; templates from real maps |
| Scope ("full clone + better") | phases are each shippable; detail written when reached |

## 7. Approval gate — resolved 2026-10-15

The owner: "do all your suggestions and create a name for the new program."
1. **Go** on stack + clean-room boundary (§2) — approved.
2. Improvements — all of §5, order A → C → D → B → E → F → G; H as he reports bugs.
3. Wine reference exports of the real Wonderdraft — approved 2026-10-15; method changed 2026-10-21 (D7 b): The owner exports 2–3 reference PNGs himself, with no Wine window (see docs/plans/2026-10-21-phase0-approvals.md).
4. Name — **Ge'orama**.

Ultra Mode on (standing consent): Phase 0 = 12 tasks, two waves. Say stop to abort.
