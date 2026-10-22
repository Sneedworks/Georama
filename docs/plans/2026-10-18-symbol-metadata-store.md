# Symbol metadata service implementation plan

> For Hermes: use subagent-driven-development, strict vertical TDD, parent strength measurement, independent SPEC then separate quality/security, serial dry/actual integration.

**Goal:** Add strict `.wonderdraft_symbols` reads to the integrated Node asset store without changing any existing image behavior.

**Architecture:** Resolve a validated symbol image reference with existing `resolveRef('symbol',reference)`, derive its sibling metadata using `symbolSetRef`, read exactly that declared source using the same private admission/drain machinery as images, then `parseSymbolSet(decodeAssetText(bytes))`. No new filesystem primitive, reference grammar or parser. All admitted image+symbol operations share the existing four global slots.

**Base:** integration `3271851837b626f90a95e68340e3686ac5803061` (parent fresh1862passed/seven skipped,43image tests both pools, build/nativeGPU/hiddenE2E/cleanup allgreen).
**Tech:** current Node22/TypeScript7/Vitest5 and existing dependencies; no packages.
**Authorization:** The owner's “so? continue and do all” covers this remaining master-plan0.6 feature. This is genuinely new symbol-JSON functionality, not a reset of the completed C3 or PCK correction budgets.
**Wave:**60-minute fuse and at mostnine worker calls, covering implementation, mutation measurement, up totwo new-feature corrections with fresh SPEC+quality after each, both integration routes and reconciliation. Producer six minutes; reviews four minutes each. Re-check live deadline before a batch/merge; reserve measured15-second full suite plus build/GPU/hidden/cleanup and second actual pass. No final gate started on the last second.

## Exact file scope

- Modify `electron/assets/store.ts` only for the API extension and shared private read/cap plumbing needed by it.
- Create `tests/unit/assets-symbol-store.test.ts`.
- Parent may later create `tests/unit/assets-symbol-store-strength.test.ts` separately before review seal.
- Existing `tests/unit/assets-store.test.ts` and `assets-store-strength.test.ts` (30+13cases) stay byte-identical; their image contract is frozen.
- All dependencies (`pck-file.ts`, `open.ts`, `config.ts`, `src/core/**`, helpers), package/renderer/IPC/CLI and `spike/` stay unchanged.
- Themes, config/evidence CLI, actual private data and full asset adversary are later slices; no pretending this completes0.6/app.

## API addition

```ts
import type { SymbolSetFile } from '../../src/core/assets/asset-json.ts';
export const SYMBOL_STORE_LIMITS = Object.freeze({ maxReadBytes: ASSET_JSON_LIMITS.maxChars });
export interface SymbolSetAsset {
  readonly key: string;
  readonly ref: AssetRef;
  readonly file: SymbolSetFile;
}
// Add to existing AssetStore, preserving readImage/close signatures:
// readSymbolSet(reference: string, maxBytes?: number): Promise<SymbolSetAsset>
```

Keep `ASSET_STORE_LIMITS` exactly unchanged (two existing fields). Do not export raw reader/session/handle/range APIs. Freeze the new wrapper and virtual ref. The parsed file/tree is fresh caller-owned data, NOT claimed deeply immutable: ReadonlyMap is a type contract, and Object.freeze(Map) does not prevent set/delete. Mutating a returned parsed tree/map cannot affect later reads (no cache). No encoded bytes need be returned by this metadata API.

## Exact semantics

1. Factory/root behavior remains unchanged, including ALL option/root snapshots and validation before any IO, any capture exception=>ROOT, eager install/lazy user and no discovery/fallback.
2. `readSymbolSet` order: validate cap (undefined defaults1MiB; safe integer0..1MiB, only lowering, no coercion) -> `resolveRef('symbol',reference)` -> `symbolSetRef(image)`/`assetKey(meta)` -> CLOSED -> missing declared root ROOT -> global BUSY/admit -> read -> strict UTF8 decode -> full symbol parser -> release in finally.
3. Metadata is the sibling `.wonderdraft_symbols`, NOT the image bytes, NOT caller-supplied arbitrary metadata paths. PCK example `res://sprites/synthetic/tree` derives `res://sprites/synthetic/.wonderdraft_symbols`; user `user://assets/synthetic-pack/trees/tree` derives `<userDataRoot>/assets/synthetic-pack/trees/.wonderdraft_symbols`. No URI decoding/case folding, no fallback to another folder/source, no reauthorizing the derived assets directory.
4. Forward the caller cap to the existing backend. Files above physical cap fail with the existing backend LIMIT before allocation; do not promise AssetJsonError TOO_LARGE when the backend already refuses first. Underlying errors remain their original typed errors. Decoding/parsing must use existing `decodeAssetText` and `parseSymbolSet`, preserving ENCODING/SYNTAX/SHAPE/TYPE/LIMIT and pointer paths. No coercion/default JSON/empty success/missing metadata placeholder.
5. Keep admission through decode+parse completion and release after every failure. Image+JSON requests share FOUR slots, not four per method/source. Fifth fails BUSY before extra backend IO/allocation. Metadata cap1MiB, image cap64MiB, existing overall four-admission bound preserved. Never copy encoded buffers or cache decoded results.
6. Existing close bars both valid method types synchronously, drains all admitted operations before PCK close once; already accepted operations finish. Idempotence and native close-failure semantics remain unchanged.
7. No changed-image semantics: full validatePng, caller-owned bytes/frozen result/ref/info, original cap/ref/error ordering and all43cases unchanged. A private generic `withRead(ref,cap,consume)` is permitted to share routing/admission/finally without duplicating counters. A private cap helper may take an optional ceiling; readImage's default remains64MiB.

## Task1 — first real builtin metadata vertical

FIRST create a failing test using the existing factory and synthetic archive:

```ts
const entry = { name: 'synthetic folder', radius: 3, offset_x: 1, offset_y: -2, draw_mode: 'normal' };
const data = new TextEncoder().encode(JSON.stringify(entry));
// Write buildPck([{path:'res://sprites/synthetic/.wonderdraft_symbols',data}])
const store = await createAssetStore({ installRoot });
try {
  const result = await store.readSymbolSet('res://sprites/synthetic/tree');
  expect(result.key).toBe('pck:res://sprites/synthetic/.wonderdraft_symbols');
  expect(result.file).toMatchObject({ shape:'folder', entry:{radius:3,offsetX:1,offsetY:-2} });
} finally { await store.close(); }
```

Run only the new file RED before source changes. Missing method is new-feature evidence, not a decoder-validation regression. Implement minimal builtin path, GREEN, then next vertical user folder/per-image map. Unknown draw modes stay valid per existing parser; `symbolEntryFor`/`imageBaseName` can verify selection without adding an unnecessary second API.

## Task2 — strict JSON and exact routing verticals

Behavioral RED then GREEN for user metadata routing; folder/per-image forms; exact name keys including constructor/__proto__ stored only in Map; missing entry selection=>null; strict invalid UTF8 inside an otherwise JSON-shaped byte sequence=>ENCODING, BOM=>SYNTAX, malformed/empty/array JSON=>appropriate existing typed parser code; invalid field/radius=>TYPE; valid controls and success after each failure. No raw bytes fallback. Mutate returned parsed map/entry then reread to prove no cache. Reuse frozen helpers; all fixtures invented, tracked and removed.

## Task3 — shared limits/lifetime vertical

Gate native reads deterministically after factory setup. Mix image and symbol requests across PCK/user, four admitted then fifthBUSY with no fifth native data read. Block a user metadata read while close starts; no underlying PCK close before it settles, both valid method types CLOSED afterward, accepted read completes. Release gates in finally before awaiting all results/cleanup. No fixed-sleep-only correctness tests. All new roots/handles removed even on failure; do not use a mock close that skips native cleanup.

Pin exact metadata cap (data.length-1/data.length/data.length+1), zero,1MiB,1MiB+1; wrong type/NaN/Infinity/fraction/Symbol/throwing cap zero coercions; cap beats malformed ref and CLOSED, resolver beats CLOSED, closed beats ROOT/BUSY. Prove existing image cap still64MiB. Tighter filesystem path limits may refuse a resolver-valid metadata ref with PATH: preserve, never loosen the backend.

## Task4 — gates and seal

Direct exact-workdir commands, real stdout and exits, default reporter/no pipes:

- `node_modules/.bin/vitest run tests/unit/assets-symbol-store.test.ts tests/unit/assets-store.test.ts tests/unit/assets-store-strength.test.ts`
- Same `--pool=threads`.

**Measured runner isolation deviation:** concurrent thread files share the process FD table, while frozen image tests count basename-matched archive FDs globally. Parent reproduced new-trio FAIL/PASS/FAIL versus three serialized-file PASS runs; failing cases are the pre-existing global FD assertions, not source reads. Accepted deterministic thread gate is the same files with `--pool=threads --no-file-parallelism` (or each file separately). All assertions and within-file multi-request tests still execute. Keep failing concurrent attempts; no frozen-test/package/config edits or green-retry concealment. Default-fork full/mutation gates retain their normal file isolation.
- `npm test` (parent baseline1862+7skip; preserve known unrelated sparse timing failure if encountered, retry quiescent unmodified only).
- `npm run build` (three typechecks included).

Commit only `electron/assets/store.ts` and the new test with explicit `git -c user.name=Ichi -c user.email=ichi@localhost commit`. Never change git config. Evidence owned scratch with real RED/GREEN, per-command notes and DELIVERY.json; preserve failures. Source-correction counter starts for this new feature only, maximumtwo across both reviews. Any discovery in an already-frozen dependency/C3 behavior requires escalation rather than hiding another correction in the API extension.

## Parent acceptance

Regenerate the entire current-source image+metadata operator table and anchored omissions for cap/ref derivation, sibling metadata route, UTF8 decode, symbol parse, global admission/finally, no cache and both-method close drain. Widen decoder bypass to nonfatal decoding, header-only/JSON.parse-only output and dropped metadata cap. Keep first/last genuine controls. Close every non-equivalent gap in the separate strength file; qualify survivors against real caller exception domains. Seal both final independent reviews to the strengthened revision. Then separate privacy/scope gate, dry merge on current integration, all gates, actual normal merge and repeat unit/threads/build/nativeGPU/hiddenE2E/cleanup. Never run visible app, install, publish private data or alter guards/providers/configurations.
