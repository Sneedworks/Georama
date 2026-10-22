# Owner-selected data-file reader implementation plan

> For Hermes: vertical TDD; parent current-source operators/anchored omissions; independent SPEC then quality/security then defensive adversarial review; serial dry/actual integration.

**Goal:** Supply the future headless map/config checker with bounded, snapshot-checked reads of explicitly owner-selected `.wonderdraft_map` and `.json` files, without weakening frozen asset/PCK allowlists.
**Architecture:** One NEW Node module opens exactly one selected absolute file descriptor with safe flags, validates held metadata before allocating, reads a capped native byte region, compares held-file snapshots after reads and finally, and awaits close on every path. It does not decode, discover roots or authorize map-provided names.
**Tech:** existing Node22/TS7/Vitest5, Linux native FS, no installs/network.
**Base:** integration12d8a093bffd2431b3842994e8d073b9a12f7735;1943PASS/7skip,124asset threads,nativeGPU10/eight formats,hidden9,cleanup3.
**Authority:** ongoing approved master-plan0.6 headless config/evidence workflow and the owner's continue/do-all direction. Existing opener supports image/asset-metadata suffixes only, not map/config files; do not bypass or edit it.
**Budget:** NEW90-minute feature fuse from dispatch, at most10delegatecalls, maximumtwo source corrections across the feature. Include parent measurement/replays, SPEC+quality, additional defensive adversary, privacy and both closing passes. Producer8minutes/~80calls, reviews4minutes each, parent measured campaigns budget20minutes, closing10minutes plus cleanup/checkpoint margin. If all permitted correction/re-review routes cannot fit, checkpoint rather than silently reset time/calls. Adversary maximumone correction cycle before escalation. All earlier exhausted correction caps remain frozen.

## Exact scope

- NEW `electron/data/selected-file.ts`.
- NEW `tests/unit/selected-data-file.test.ts`.
- Parent may add `tests/unit/selected-data-file-strength.test.ts` before seal.
- All existing sources/tests/core codecs, asset open/PCK/store/config/resolvers/inventory, helpers/package/renderer/IPC/CLI and spike byte-frozen.
- Synthetic isolated files only. No actual private maps/config, no mounting/scanning, no vendor executable/scripts/shaders. No source shell/network/process launch, config writes or IPC.

## API

```ts
export const SELECTED_FILE_LIMITS = Object.freeze({ maxReadBytes: 512 * 1024 * 1024, maxPathChars: 4096 });
export type SelectedFileErrorCode = 'PATH' | 'EXTENSION' | 'LIMIT' | 'MISSING' | 'TYPE' | 'IO' | 'CHANGED';
export class SelectedFileError extends Error {
 readonly code: SelectedFileErrorCode;
 constructor(code: SelectedFileErrorCode, message: string) { super(message); this.name='SelectedFileError'; this.code=code; }
}
export function readSelectedDataFile(filename: string, maxBytes: number): Promise<Uint8Array>;
```

`maxBytes` is REQUIRED, not defaulted by accessing another argument. Hard maximum536870912bytes is an explicit resource policy for this primitive, NOT a claim that all format-valid arbitrarily huge maps fit it. Future large-map streaming may use a separately approved design. Configuration callers will pass their smaller65536-byte cap. No global aggregate-admission promise; trusted Node/CLI callers bound their own concurrency.

## Trust and path contract

This is ONLY an owner-selected full filename capability in trusted Node code; not an asset-reference API, sandbox descendant resolver or renderer bridge. Filename ancestors belong to that explicit selected path and may be symlinks; the final leaf is NEVER followed. Holding the opened file protects subsequent reads from namespace replacement; do not reopen by name or claim ancestor containment. All untrusted map/pack refs must continue through the frozen descriptor-root asset readers.

Argument order BEFORE IO: validate cap (runtime typeof number, safe integer0..536870912, no coercion) -> path -> suffix. Wrong cap always LIMIT even if filename bad. Filename must be string1..4096UTF16chars, start `/`, equal `path.posix.normalize(filename)`, and contain no C0/DEL/C1/unpaired surrogates. Allow paired Unicode and literal Linux punctuation/space/percent/backslash/colon otherwise; no URI/case/Unicode/path normalization. Hidden owner-selected directories are allowed. Exact case-sensitive suffix `.json` or `.wonderdraft_map` only; all other suffixes EXTENSION before open, including dummy `.gdc`, `.shader`, `.js`, `.png` and trailing query/extra suffix. No appending/stripping/extensions guessed. Wrong path type/shape PATH, zero coercions. Error messages generic/path-free; never echo filename, native error.message or data; no native cause object exposed.

## Held descriptor and exact behavior

1. Open once read-only with numeric `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. Native ENOENT=>MISSING; ELOOP/ENOTDIR=>PATH; other open errors=>IO. No raw native JS/system error escapes.
2. `handle.stat({bigint:true})`. Require regular file before checking size (directory/FIFO held descriptors=>TYPE). Socket/device open may refuse IO; ordinary typed refusal/no hang/no allocation is sufficient for cases that cannot open. Compare BigInt size against caller cap BEFORE allocation; oversize=>LIMIT. Capture independent values dev/ino/size/mtimeNs/ctimeNs. These are required; mode may be additionally tracked.
3. Allocate exactly one owned encoded `Uint8Array(Number(size))`; allocation failure=>LIMIT with cleanup. Zero-sized regular file and cap0 accepted, return fresh empty bytes. Do not allocate a production-size positive fixture; use small valid controls and sparse over-cap refusals.
4. Read using the held handle only. Native call trace for a short read uses buffer offset=bytes already read, length=remaining, position=bytes already read; full requested range must be valid even when a test fake returns fewer. Loop until exact original size. After EVERY completed native read, compare a fresh bigint held snapshot BEFORE interpreting bytesRead/count failures, so changed+bad/short data yields CHANGED. Native read rejection=>IO. Stable zero/invalid/noninteger/negative/over-remaining count=>IO; stable positive short reads continue normally. No unbounded zero-read spin.
5. Perform a FINAL held snapshot check even for empty files, before success. A change to any required snapshot field=>CHANGED, no partial success or caching. Rename/replacement never causes a path reopen; only held-file snapshot contract is claimed, not atomic filesystem immutability after the last check.
6. Await exactly one owned native close attempt on every opened-handle path, including stat/type/cap/allocation/read/snapshot failure. A successful read does not resolve until close settles. If close alone reports failure=>IO; if a prior typed operation failure exists preserve that primary error. In injected close-report failures perform REAL native close first, then throw, so fixtures do not leak FDs; don't retry a cached rejected close to fake cleanup. No handles or raw offsets returned.
7. Return caller-owned fresh bytes, no encoded copy (`Buffer.from`, `slice`, `Uint8Array.from`, copying constructor/map/filter). Same-buffer full-range view is permitted; returned region identity/offset/length must match native destination. No parser, UTF8 decoder, path enumeration or application-store state in this module.

## Task1 — real TDD tracer bullets

FIRST mutation minimal invented `.json` payload test with exact byte result, required safe open flags, held stat bigint option and awaited real close; include limit constant/freeze assertions here if implementing them in the first module. Run DIRECT `node_modules/.bin/vitest run tests/unit/selected-data-file.test.ts` from the prepared workdir. Actual missing-module failure BEFORE source; if blocked STOP without production, no progress appeasement. Missing module is setup-only, not behavioral RED.

Minimal real file read GREEN, then one behavior class at a time: cap/no-coercion order; selected path/suffix refusal0IO; regular/size bounds and zero; stable partial-read trace; IO cleanup; metadata changes before count validation/final empty check; allocation/close failures and native backing identity. Tests before corresponding validation/source guards; don't preload TYPE/EMPTY/cap/path checks before their tests. Safe flags/close may first-GREEN in later refusal cases because already required by the first explicit test; log honestly as verify-pass, no reconstructed RED.

Use owned roots under managed TMPDIR. Native probe handles closed; roots recursively removed in finally, pending gates released on failure. Node22 FileHandle.close is an own property: fake via owned fs.open wrapper or exact instance, not an ineffective prototype spy. Validate full ranges BEFORE a short-read fake clamps the count. Snapshot perturbation can inject valid bigint-stat field deltas around actual native file reads; label exact timing, separate real writes from simulated metadata. Never open real private or compiled files; dummy forbidden-suffix bytes are fictional.

Tests require: malformed cap/path tables/counters; cap-1/exact/+1 on small files and exact hard-cap acceptance before missing/extension (no512MiB positive allocation); normalized length-1/exact/+1 argument boundaries via no-IO seams; paired/unpaired path text and punctuation controls; symlink leaf refusal/real target unchanged, FIFO with outer subprocess deadline, directories; all5 snapshot dimensions, unchanged controls, changed+stable short reads, final zero-file snapshot; exactly one region and no duplicate file open; close ordering/failure precedence/actual EBADF; allocation/read/stat failures with cleanup. Keep deadlines/gates deterministic, no fixed sleeps as sole proof.

## Task2 — gates and delivery

Direct own file default + `--pool=threads --no-file-parallelism`; `npm test` baseline1943PASS/7skip; `npm run build` (three typechecks). Known untouched sparse200ms benchmark can flake: preserve first failure and rerun entire quiescent suite, never edit threshold. No tee/pipes/basic/prefix/echo exit masking. Save actual command outputs/statuses separately, not invented log summaries. Only2 files committed using `git -c user.name=Ichi -c user.email=ichi@localhost`, never shared git config. E/DELIVERY.json absolute path, notes/provenance/RED+GREEN+gates, no private path fixtures/messages.

## Parent route

Current-source operators plus anchored omissions for every guard/open flag/size-before-allocation/read range/snapshot/final check/close/backing ownership step. Widen any actual gap class before closure; separate runtime failures/timeouts/setup and first/last controls; no source patches from coordinator. Parent strength tests then exact seal. Fresh independent SPEC -> separate quality/security -> fresh defensive adversarial review of this local selected-file boundary (typed refusal/symlink/FIFO/races/caps/zero forbidden IO/cleanup), no exfiltration or real targets. An exploit/finding blocks, sharedtwo-source-correction cap and adversaryone-cycle limit, no silent extra fix. Scope/privacy scan including commit messages, dry+actual full unit/all-asset serializedthreads/build/nativeGPU/hidden/cleanup with Node/GPU strictly serial. No master source promotion; CLI/full0.6/whole-asset adversary/fresh data and renderer/editor remain open after this primitive milestone.
