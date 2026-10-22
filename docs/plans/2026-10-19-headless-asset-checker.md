# Headless selected-map asset checker implementation plan

> For Hermes: writing-plans → vertical TDD producer → parent mutation strength → fresh SPEC → separate quality/security → whole-asset defensive verification → serial dry/actual native integration. The owner explicitly directed “do whatever is left, dont stop”; this advances the approved master-plan0.6, not a reset of any old feature/correction cap.

**Goal:** Ship an actually runnable read-only CLI that checks every nonempty unique external image reference of an explicitly selected map against explicitly selected configuration roots, with deterministic JSON evidence and truthful unresolved/empty/embedded counts.
**Architecture:** NEW Node service composes C8 selected config, C7 held map read, frozen map parser+validator+inventory and frozen asset store. NEW CLI invokes it, never unsafe old wd-check/loadConfig or automatic discovery. Runtime-only assets, no vendor files or private fixtures committed.
**Stack/base:** installed Node22/TS7/Vitest5, integrationfe2e91a29f0b9df78114d9f7461c03e5cbfb79ba, parent2120PASS7skip/build/nativeGPU/hidden/cleanup green. No packages/network/system changes.
**New feature budget:** 60-minute end-to-end fuse from preparation17:43:55Oct19BRT to18:43:55, max12delegation calls, max2source corrections shared across reviews. Producer target9min/~80calls; two reviews4min/~50calls each, defensive5min, parent measurement/probe/closing margin included. Old C8 complete17:31:28; old C3/C5/PCK/GPU caps frozen. Do not silently reset any counter/deadline; checkpoint before an operation that cannot fit. The continuation covers remaining approved components, not extra risky permissions.

## Exact file ownership

Producer ONLY CREATE:
- `electron/data/map-asset-check.ts`
- `scripts/check-map-assets.ts`
- `tests/helpers/asset-check-synthetic.ts`
- `tests/unit/map-asset-check.test.ts`
- `tests/unit/check-map-assets-cli.test.ts`
Parent may CREATE `tests/unit/map-asset-check-strength.test.ts` before seal. ALL old source/tests/config/package/helpers/core/asset/PCK/store/C7/C8/renderer/IPC/CLI/spike remain frozen. Do not modify package.json: native command is `node scripts/check-map-assets.ts --config ABSOLUTE_FILE --map ABSOLUTE_FILE`.
Named read deps: electron/data/{selected-file,config-file}.ts; electron/assets/{config,store}.ts; src/core/{assets/map-refs,assets/resolve,formats/wonderdraft-map-file,formats/wonderdraft-map,formats/godot-var,formats/gcpf}.ts; tests/helpers/{wd-synthetic,pck-synthetic}.ts; tests/unit/assets-store.test.ts first115lines for fixture patterns; package/tsconfigs. No other exploration/private files/mounts/vendor code.

## Service API and contract

```ts
export interface AssetCheckEntry {
 readonly kind: RefKind;
 readonly reference: string;
 readonly locations: readonly string[];
 readonly status: 'valid' | 'unresolved' | 'empty';
}
export interface MapAssetCheckReport {
 readonly version: 1; readonly ok: boolean;
 readonly groups: number; readonly checked: number;
 readonly valid: number; readonly unresolved: number; readonly empty: number;
 readonly embeddedSymbols: number;
 readonly entries: readonly AssetCheckEntry[];
}
export class MapAssetCheckError extends Error {
 readonly code = 'VALIDATION';
 readonly issueCount: number;
 constructor(issueCount: number) {
  super('Selected map failed semantic validation');
  this.name = 'MapAssetCheckError'; this.issueCount = issueCount;
 }
}
export async function checkSelectedMapAssets(mapFilename: string, configFilename: string): Promise<MapAssetCheckReport>;
```

1. FIRST fully await readSelectedConfigFile(raw configFilename) ONCE. Its65536cap/strictdecoder/errors stay frozen, propagate exact thrown identity. Config failure means NO map read/store creation.
2. THEN fully await readSelectedDataFile(raw mapFilename,SELECTED_FILE_LIMITS.maxReadBytes) ONCE (536870912); decode using readWdMap on the native byte backing (full-range same-buffer views permitted), no encoded copy/reopen/no extension restriction beyond C7. Preserve reader/parser error identities. No buffers/decoded map/config retained in report or global caches.
3. Call validateWdMap(map) ONCE before inventory/store. Nonempty issue list rejects with new MapAssetCheckError(issues.length), whose code is VALIDATION, before any root/PCK opens or image attempt. Decoder errors and semantic rejection are distinct. No copying/reimplementing validators. A schema-valid synthetic map with water_level1.5 must produce the new validation rejection (old schema accepts its Real type, validator rejects range).
4. Inventory = collectMapAssetRefs(map) ONCE; exact raw sorted/deduped kind+reference groups/locations, embedded symbols remain opaque and never sent to readImage. Do NOT invent location resolution, drop invalid refs, conflate equal reference across kinds, filter inactive frame or trim/normalize/casefold/percent-decode names.
5. createAssetStore({installRoot:config.wonderdraftInstall,userDataRoot:config.wonderdraftUserData}) ONCE after successful parse/validation/inventory. No resolveRoots/loadConfig/env/home/discovery/mounts/alternate roots; mapRoots do not grant asset access or sandbox an explicit owner selection. Existing roots/authorization/limits unchanged.
6. For every inventory group sequentially (NO Promise.all/fanout), exactly empty string => status empty, increment empty, ZERO readImage. It is an explicitly reported non-reference, not a valid PNG or unresolved asset. Every NONempty string => exactly one awaited store.readImage(group.kind,group.reference) with NO cap override; it already validates PNG. Success valid; ANY readImage throw unresolved, retain raw ref/kind/locations and continue through ALL later groups. Never inspect/render exception message/cause/getters or include it in report. No new reference validation or fallback root.
7. Each entry frozen, entries array/root frozen; locations borrowed from already-frozen inventory. Fresh result each invocation, independent of earlier results. Counts: groups=entries.length=checked+empty, checked=valid+unresolved, ok iff unresolved===0, embeddedSymbols=inventory.embeddedSymbolLocations.length. These are honest counts; zero checked does NOT prove historical private corpus.
8. ALWAYS await store.close() exactly once in finally for every successfully created store before public promise settles (positive/unresolved/empty paths). A close rejection propagates unchanged and is a fatal command failure, never successful report. Config/map/validation/inventory/store-factory errors happen before an owned store exists and preserve identity. No requirement to recover from OOM or hostile mutation of our trusted built-in Array/Object methods. No process launch, FS access beyond reviewed dependencies, IPC or network in service.

Final source skeleton (ADD each behavior ONLY AFTER its own genuine RED; never preload guards/catches because missing-module RED happened):
```ts
const config = await readSelectedConfigFile(configFilename);
const bytes = await readSelectedDataFile(mapFilename, SELECTED_FILE_LIMITS.maxReadBytes);
const map = readWdMap(bytes);
const issues = validateWdMap(map);
if (issues.length !== 0) throw new MapAssetCheckError(issues.length);
const inventory = collectMapAssetRefs(map);
const store = await createAssetStore({installRoot:config.wonderdraftInstall,userDataRoot:config.wonderdraftUserData});
try {
 const entries: AssetCheckEntry[] = [];
 let valid=0, unresolved=0, empty=0;
 for (const group of inventory.groups) {
  let status: AssetCheckEntry['status'];
  if (group.reference === '') { status='empty'; empty++; }
  else {
   try { await store.readImage(group.kind,group.reference); status='valid'; valid++; }
   catch { status='unresolved'; unresolved++; }
  }
  entries.push(Object.freeze({kind:group.kind,reference:group.reference,locations:group.locations,status}));
 }
 return Object.freeze({version:1 as const,ok:unresolved===0,groups:entries.length,checked:valid+unresolved,valid,unresolved,empty,embeddedSymbols:inventory.embeddedSymbolLocations.length,entries:Object.freeze(entries)});
} finally { await store.close(); }
```

## CLI literal contract

- Exactly four tokens, two UNIQUE pairs --config VALUE and --map VALUE, either order; values forwarded byte-for-byte, no path.resolve/trim/default. Unknown/duplicate/missing/excess flags => stderr exactly one JSON line `{ok:false,error:'USAGE'}`, stdout empty, exit2, no checker/selected-input/root I/O (ordinary Node module loading is not prohibited).
- Standalone --help => stdout one usage line naming command/flags, stderr empty, exit0, no checker/selected-input/root I/O. --help combined with anything is USAGE.
- Success => stdout exactly ONE JSON.stringify(report) line, stderr empty, exit0 when report.ok true / exit1 when unresolved. Preserve all entries; no pretty print/debug logs or selected absolute filenames/config roots/raster or label contents in output. Asset reference strings and inventory locations ARE intentionally reported, including refused strings; real-data output stays private/never committed.
- Checker failure of ANY class/value => stdout empty, stderr exactly one line JSON `{ok:false,error:'CHECK_FAILED'}`, exit2, no native message/stack/cause/filename/config contents. Catch unbound so no hostile error property access. Use process.exitCode ONLY, never process.exit (stdout must drain and cleanup settle).
- Static entry uses process.argv.slice(2); no exported parser API, no child_process/shell/Electron/network or package edits. Test real Node subprocesses, with timeout/kill and fictional HOME/XDG/managed TMPDIR; no inherited actual config/root discovery. No visible window.

## Genuine vertical TDD ordering

A. FIRST new real service test/helper (no production module): tiny valid GCPF+Godot map from makeSyntheticRoot,5PCK PNGs+one user PNG, one embedded symbol. Fix style refs to reviewed grammar. Assert correct six valid groups/one embedded/count invariants/frozen result, exact config+map native read args/order, store factory forwarded roots, owned store close awaited once. Sole direct focused command missing-module fails; THEN write MINIMAL valid-flow service with no validation refusal, no per-image error catch, no empty skip yet. Await close is justified by first positive lifecycle assertion. GREEN.
B. Write schema-valid water_level1.5 test: expect new VALIDATION/issueCount, zero store/inventory after invalid. Observe actual returned-success mismatch before adding validator/error class. Add only that gate. GREEN. readWdMap shape/format failures that already pass are honest verify-pass.
C. Remove real user PNG and expect unresolved row while ALL remaining groups still checked. Observe actual native rejection before new per-image catch. Add scoped catch only, generic no error inspection. GREEN. Throwing primitive/typed errors follow same newly general behavior, later verify-pass.
D. Make one reference exactly empty, expect empty row/checked decrement/ZERO imagecall; current catch reports unresolved, observe behavioral RED then add exact-empty branch. Whitespace must NOT be treated as empty. GREEN. Test duplicated references within/across kinds, sorted complete locations, embedded counts, invalid refs/PNG/caps/missing roots/symlink refusal, no raw-error output, sequential gate maxactive1, no second reads/cache, close-entry and settlement gates with finally-release. Native close-before-report-error and EBADF where needed. Every new behavior first tested before source, dependency/general behavior firstGREEN honestly labeled.
E. FIRST actual CLI subprocess positive test BEFORE script; missing script failure is setup, then minimal fixed-order success flow and report exit code. Next reverse-order command failure before argument mapping; invalid-input stderr generic/exit2 failure before catch; USAGE/no-IO and --help failure before respective guards. Do not preload all guards into initial script. Actual subprocess tests on valid/unresolved/config/malformed-map/semantic errors, raw quoted/Unicode paths and hostile env bait, repeat deterministic JSON, correct stdout/stderr and exits. Do not count wrong test fixture expectations as production REDs.

Test helper may create owned fixtures only, never call new service itself to compute expected values. Use frozen makeSyntheticRoot/GdDict.entries pairs (no .set API), encodeStoreVar→encodeGcpf, buildPck/makePng; mutate only invented roots. Reference fixture:5 PCK paths res://textures/{water/SynthWater,ground/SynthGround,frames/SynthFrame,paths/SynthPath,borders/SynthBorder}.wonderdraft_image plus user://assets/synthetic-pack/trees/tree (assets/synthetic-pack/trees/tree.png). Original synthetic embedded symbol remains embedded. Replace existing fake path/border strings with their valid fixed res://textures/... names and first symbol with user path. Existing fractional map dimensions are validator-valid with2x2rasters; water1.5 is known semantic invalid. All roots/handles finally cleaned.

## Acceptance/delivery/continuation

Run EACH test command as SOLE shellcommand in exact workdir (no echoEXIT/stat/pipes/tee/reporter/prefix): new service+CLI tests default AND --pool=threads --no-file-parallelism; npm test; npm run build (3typechecks). Preserve setup/test-only failures and known untouched sparse timing flake; never weaken thresholds. No npm run app, GPU/Electron only after Node workers/campaigns finish, and only parent in serial native slot.
Commit ONLY5newfiles via explicit git -c user.name=Ichi -c user.email=ichi@localhost commit, no sharedgitconfig. Save COMPLETE DELIVERY.json and separate NOTES.md at owned evidence/T06c9-checker: exactSHA/scope/realoutputs/statuses/firstwrites/RED/source/GREEN ordering/deviations/notobserved. Parent closes non-equivalent gaps in separate strength file and regenerates operators+anchored phase omissions/counts/cap/argforwarding/catch/awaitclose/seriality/errors/privacy/CLI exit-output rows; first+last controls, actualfailedtest vs timeout/setup vs qualified survivors explicit. Both fresh final reviews fullread ALLfinalfiles and run BOTHpools; source corrections shared2max. Then whole-asset defensive verification with synthetic controls over selectedread→config→map→inventory→store→CLI and frozen authorization boundaries. Any surviving Important finding in exhausted old components is escalated, not silently patched.
Before promotion: exactscope/hash/privacypositivecontrol full diff+ALLmessages; dry+actual full/allasset-selected-newserializedthreads/build/nativeGPU/hidden/cleanup separately repeated, profiles absent/bracketpgrep empty. No main source promotion until finalPhase0 gate. Real private proof remainsBLOCKED now: freshmounttable17:43:55 showed0externalmedia mounts, no automount. Continue synthetic CLI/defensive/renderer work without pretending the private acceptance criterion passed. After closing this component, continue remaining approved build automatically; do not pause at its success report.
