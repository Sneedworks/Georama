# Asset image store implementation plan

> For Hermes: execute through subagent-driven-development, TDD, parent mutation measurement, fresh SPEC then separate quality/security; integrate only after actual parent gates.

**Goal:** Connect the reviewed reference resolver, held-PCK session, scoped user-file reader and full PNG validator into one bounded Node-only image service.

**Architecture:** The store owns at most one PCK session and snapshots explicitly supplied root strings. Each request resolves an existing map reference, routes to exactly its declared source, reads bounded encoded bytes and runs `validatePng`. It does not decode pixels or cache buffers. User files remain beneath the supplied user-data root through the existing descriptor-walking reader; append `assets/<pack>/<relPath>` rather than reauthorizing a derived assets directory as a new trusted root.

**Base:** reviewed integration `113a8e2dab77ec4edceec2d344d0a855f35b6cb1`.
**Tech stack:** existing strict erasable TypeScript, native Node22, Vitest5; no packages.
**Approved scope:** the remaining image-store portion of master-plan0.6. This is a new facade, NOT another correction to completed C2.
**Non-goals:** JSON/theme/symbol metadata loading (next slice), config discovery/CLI/UI/IPC, enumeration, pixel decode, caching, arbitrary resolved-ref/offset APIs, changes to any reviewed underlying module, actual private data, installed configuration or guard changes.
**Wave:**45-minute fuse, at most5 delegate calls (implementation, SPEC, quality; remaining calls reserved for at most2 proved corrections across both reviews). Existing C2 correction budget stays exhausted. A new Important/Major finding in an existing frozen dependency requires escalation, not editing it under this facade's budget.

**Explicit escalation approval:** After the two facade corrections were used and the option-capture ROOT error bug was reproduced, the owner said “so? continue and do all.” This approves ONE additional narrowly scoped capture-normalization correction (third facade correction overall), followed by fresh SPEC then separate quality and parent integration gates. The resumed correction/review wave is15minutes/three delegate calls; it does not reset either facade or dependency budgets. Parent may close the identified test gaps in the already-authorized strength file before the final review seal. Preserve every superseded source, failed probe and approval-timeout record; no installation/provider/guard changes are authorized.

## Exact allowed implementation files

- Create `electron/assets/store.ts`.
- Create `tests/unit/assets-store.test.ts`.
- Parent may later create `tests/unit/assets-store-strength.test.ts` in a separate test-only branch before reviews are pinned.
- Everything else, including `electron/assets/{pck-file,open,config}.ts`, `src/core/**`, existing tests/helpers, package files, renderer and `spike/`, remains unchanged.

## Public contract (exact names)

```ts
import type { AssetRef, RefKind } from '../../src/core/assets/resolve.ts';
import type { PngInfo } from '../../src/core/assets/png.ts';
export const ASSET_STORE_LIMITS = Object.freeze({ maxReadBytes: 64 * 1024 * 1024, maxConcurrentReads: 4 });
export type AssetStoreErrorCode = 'ROOT' | 'LIMIT' | 'BUSY' | 'CLOSED';
export class AssetStoreError extends Error {
  readonly code: AssetStoreErrorCode;
  constructor(code: AssetStoreErrorCode, message: string) {
    super(message); this.name = 'AssetStoreError'; this.code = code;
  }
}
export interface AssetStoreOptions {
  readonly installRoot?: string;
  readonly userDataRoot?: string;
}
export interface ImageAsset {
  readonly key: string;
  readonly ref: AssetRef;
  readonly info: PngInfo;
  readonly bytes: Uint8Array;
}
export interface AssetStore {
  readImage(kind: RefKind, reference: string, maxBytes?: number): Promise<ImageAsset>;
  close(): Promise<void>;
}
// Implement the factory, not an additional injected-backend API:
// export async function createAssetStore(options: AssetStoreOptions = {}): Promise<AssetStore>
```

Return fresh caller-owned bytes. Freeze the plain result/ref/info metadata, NOT the nonempty Uint8Array. No returned FileHandle, PCK session, mutable index or absolute physical path. This remains trusted Node-host code, not renderer authorization against a host already possessing fs.

## Required semantics

1. Validate/copy ALL provided options/root values before ANY filesystem I/O. Default undefined options means `{}`; empty store succeeds without I/O, each configured-source request then reports ROOT. Null/nonobject/array/nonplain option objects and invalid supplied roots report typed path-free ROOT. Plain and null-prototype records are allowed. Catch throwing option-property/prototype access as ROOT; never coerce root objects or Symbols. Roots must be normalized absolute Linux paths of1..4096chars without controls, DEL/C1 or unpaired surrogates. Preserve legitimate root punctuation and non-ASCII. Copy strings before the first await; later mutation of options must not redirect requests.
2. A supplied installRoot eagerly opens `openPckFile`; userDataRoot is lazy, with physical safety/errors delegated unchanged to `readAssetFile`. No environment/home/config scanning or writes. Either root is optional, both and neither are supported. Never substitute another source or search arbitrary paths when a root/asset is missing.
3. `readImage` order: validate numeric cap (safe integer0..64MiB, caller only lowers; no coercion), call `resolveRef(kind,reference)`, reject CLOSED, reject missing configured source with ROOT, enforce global4-admission/fifthBUSY, then admit. Resolve once via the existing resolver and derive `assetKey(ref)`. No URL decoding/case folding/extension stripping or reinterpretation. Builtin reads call heldSession.readData(ref.path,cap); user reads call readAssetFile(userDataRoot,`assets/${ref.pack}/${ref.relPath}`,cap). Underlying path/byte bounds remain authoritative; an otherwise resolver-valid reference may be refused by the tighter filesystem path budget. NEVER loosen/re-root around those guards.
4. Run **full `validatePng(bytes)`**, not only `readPngInfo`. Return `{key,ref,info,bytes}` only after it succeeds. PNG framing/CRCs/dimension/pixel/chunk limits are checked; this is NOT a claim of zlib/pixel decoding. Preserve existing typed RefError/PckError/PckFileError/AssetFileError/PngError and codes; the facade's own errors use AssetStoreError. No raw JS error for the specified malformed public-argument cases. Missing/invalid images fail explicitly, no placeholder bytes.
5. At most4 admitted requests ACROSS PCK+user, with no fifth queue/byte allocation. Keep admission until read+validation settles and release in finally, including parse/read failures. Max store-owned in-flight encoded bytes is bounded by four capped reads; returned caller-owned buffers are outside that bound. No cache or in-flight deduplication: mutating a returned buffer cannot affect later reads; a changed PCK must not be hidden by stale image reuse.
6. `close` synchronously bars new valid requests, waits for ALL admitted work to settle, then closes the owned PCK session once. It is async/idempotent, also without a PCK, and preserves typed close failures. Accepted operations finish during close. Never call session.close while user-file reads are still admitted. Use a drain notification or bounded await strategy, not a synchronous busy loop. No timers survive closure.

## Task1 — first vertical builtin image

Write a real test using the exported factory. Reuse existing `buildPck` and `makePng` from `tests/helpers/pck-synthetic.ts` without editing the helper:

```ts
const png = makePng({ width: 2, height: 3 });
await fs.writeFile(path.join(installRoot, 'Wonderdraft.pck'), buildPck([
  { path: 'res://sprites/synthetic/tree.wonderdraft_image', data: png },
]));
const store = await createAssetStore({ installRoot });
try {
  const image = await store.readImage('symbol', 'res://sprites/synthetic/tree');
  expect(image.bytes).toEqual(png);
  expect(image.key).toBe('pck:res://sprites/synthetic/tree.wonderdraft_image');
  expect(image.info.width).toBe(2);
  expect(image.info.height).toBe(3);
} finally { await store.close(); }
```

Run `npx vitest run tests/unit/assets-store.test.ts` RED, recording missing-module setup separately. Implement the minimal factory+builtin path and GREEN. Then add a behavioral killer: preserve valid IHDR but corrupt a later chunk CRC and require PngError CRC; prove a disposable header-only-validator mutant fails. Do not claim an import failure proves PNG validation.

## Task2 — user route and source/root boundaries

Add one test for `<userDataRoot>/assets/synthetic-pack/trees/tree.png` loaded by `user://assets/synthetic-pack/trees/tree`; verify exact bytes/key/info. Then table all six RefKind routes, root-only/user-only/empty/both, missing roots/files, no cross-source fallback, punctuation/non-ASCII, malicious references, assets/pack/leaf symlink refusal, directory/FIFO refusal with owned subprocess deadline, no outside-root I/O. Test the tighter filesystem path budget as a refusal, not a reason to weaken the opener. Snapshot options before awaits and prove later caller mutation has no effect. Release every owned resource even when a refusal unexpectedly succeeds.

## Task3 — global admission and lifetime

Deterministically gate actual payload/file reads after factory setup. Admit four mixed user/PCK requests; fifth immediately BUSY with no fifth read. Release gates in finally and observe all results. Repeat waves and failures. Start close while one user request remains gated and require no underlying PCK close yet, new valid read CLOSED, accepted read completes, PCK close count exactly1 after drain. No fixed-sleep-only correctness tests. Test PCK close rejection without duplicate close, post-close failures, user-only/empty-store close, no leftover fixtures.

## Task4 — hostile tables, full gates and seal

Wrong-type options/roots/kind/reference/caps; exact lowered cap at PNG byte length and one less; negative/NaN/infinite/fraction/Symbol/throwing cap with zero coercions; full PNG bad CRC/truncation/dimension-limit probes using tiny headers, no huge real allocations; slot release after each backend/PNG error; changed PCK propagation; byte freshness and metadata freeze. Real FS synthetic positive controls accompany every refusal class. No test allocation above about200MiB.

Run DIRECT from the task worktree, summary and true exits visible:

- `npx vitest run tests/unit/assets-store.test.ts`
- `npx vitest run --pool=threads tests/unit/assets-store.test.ts`
- `npx vitest run tests/unit/core-boundary.test.ts`
- `npm test` (baseline reverified1819passed/7skipped)
- `npm run build`

Default reporter only; never `--reporter basic`, `--prefix`, pipe/tail or hidden test exit codes. Commit ONLY the two allowed files with explicit Ichi identity. Preserve per-command notes/RED/GREEN/probes in owned scratch evidence, not repository private fixtures. Scope/privacy scan diff+commit message, verify clean tracked status. Return actual commit/evidence/deviations.

## Parent acceptance after implementation

Generate current-source operator AND anchored omission mutants for cap/ref resolution/source routing/full PNG validation/global admission/finally release/close drain. Verify controls first/last; close every non-equivalent gap in a separate strength file. Seal before fresh independent SPEC, then separate quality/security. At most2 proved facade correction cycles across both reviews. Dry merge against current integration, full tests+threads/build/nativeGPU/hiddenE2E/cleanup; only then normal actual merge and repeated gates. The broader0.6 and application remain incomplete until JSON/config/CLI/real-data/adversary and rendering/editor work land.
