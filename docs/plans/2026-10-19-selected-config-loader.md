# Owner-selected bounded configuration loader implementation plan

> For Hermes: vertical TDD, parent current-source mutation measurement, independent SPEC then quality/security, serial dry/actual full native integration. Ongoing approved master-plan0.6 config/evidence workflow, the owner's continue. This is NEW composition functionality, not another correction of a frozen reader.

**Goal:** Provide the future headless checker with an explicitly selected, safely bounded, strict-UTF8 configuration loader using already reviewed primitives.
**Architecture:** One new Node module composes C7 readSelectedDataFile with CONFIG_LIMITS.maxBytes, portable decodeAssetText and frozen parseConfig. It adds ONLY a scoped decoder-error translation, never root discovery, environment defaults or a second filesystem reader. Existing loadConfig remains frozen and is NOT called.
**Stack:** existing Node22/TS7/Vitest5, no installs/network/private data.
**Base:** integration546f1434d56645123f06b36fea67d0a083c8eebb, parent full2047PASS/7skip,981all-asset+selectedthreads/4skip,build3typechecks0,nativeGPU10/eightformats,hidden9/cleanup3.
**Budget:** genuine NEW45-minute end-to-end fuse from recorded preparation start, maximum9delegatecalls, maximum2sourcecorrections shared across reviews. Include preparation, A2/probe replays, both reviews, permitted correction routes and both closing passes; producer4minutes/~45calls, reviews3minutes/~40calls, small-module A2 pilot then full campaign, closing10minutes/margin. Missing independent gates consume calls; if all required remaining work cannot fit, checkpoint, never reset counters/time. All previous exhausted sourcecaps unchanged; C7 closed1/2 and does not reopen here.

## Exact scope

- CREATE `electron/data/config-file.ts`.
- CREATE `tests/unit/selected-config-file.test.ts`.
- Parent may CREATE `tests/unit/selected-config-file-strength.test.ts` before seal.
- ALL existing source/tests/config/package/helpers/core/asset/PCK/store/opener/C7 selected-file/renderer/IPC/CLI/spike frozen.
- Named read deps: electron/data/selected-file.ts; electron/assets/config.ts (parseConfig, CONFIG_LIMITS, ConfigError, GeoramaConfig ONLY); src/core/assets/asset-json.ts (decodeAssetText ONLY); package/tsconfigs; tests/unit/selected-data-file.test.ts and assets-config.test.ts for fixture patterns.
- No actual config/maps/home discovery, process launch, root scanning/mounting, provider/config/guard changes, external operations or vendor data. Synthetic owned managed-TMPDIR fixtures only.

## API and exact semantics

```ts
import type { GeoramaConfig } from '../assets/config.ts';
export function readSelectedConfigFile(filename: string): Promise<GeoramaConfig>;
```

1. Delegate filename as-is ONCE to readSelectedDataFile(filename, CONFIG_LIMITS.maxBytes). Fixed existing cap65536bytes, no exposed/implicit override or extra options. Runtime path validation/no-coercion/selection/snapshot/cleanup belongs to C7; do not duplicate or weaken it.
2. All C7 SelectedFileError objects/codes propagate UNCHANGED (including exact identity in controlled dependency-failure probes). Reader rejection must bypass decoder and parser. Await C7 fully, so owned native close settles BEFORE text decode. No name reopens, readFile/stat/FS APIs, hidden fallback or auto-discovery.
3. Decode native bytes using existing decodeAssetText ONLY. Its reviewed strict UTF8 fatal+ignoreBOM contract is reused, not reimplemented. It retains BOM in text, therefore frozen parseConfig rejects leading BOM as SYNTAX; malformed byte sequences must not be silently replacement-decoded into a valid path string.
4. Normalize ANY decoder throw to `new ConfigError('SYNTAX', '', 'config is not valid UTF-8')`, generic message/no native cause. Scope this catch to decode ONLY; do not swallow/translate C7 errors or parseConfig schema failures.
5. Parse using frozen parseConfig OUTSIDE decoder catch. Preserve its exact ConfigError(code,key,message) and object identity for controlled parser-failure probes; no new schema, key handling, path normalization or unknown-field policy. Return its fresh frozen root/mapRoots containers, not an invented clone, mutable wrapper or cache.
6. No filename suffix restriction beyond frozen C7 data-file allowlist (.json/.wonderdraft_map). Configuration CONTENT must be valid strict JSON; supporting an owner-selected map-suffixed file containing JSON is explicitly allowed. No compiled/vendor suffixes added. This choice avoids a contradictory second extension policy.
7. Empty file => ConfigError SYNTAX; absent explicitly selected file => C7 MISSING, not silent empty config. No configFilePath/loadConfig/resolveRoots/process.env/os.homedir/default search, no mutation of parsed data or inputs. Unknown keys follow frozen parseConfig behavior.

## TDD tracer bullets (no preemptive new error catch)

### A — first minimal real composition

FIRST mutation creates tiny owned JSON test before module. Import new function, create a real invented config using known keys and literal invented absolute path values; spy C7 named module function with call-through and assert exactly ONE call with exact filename+CONFIG_LIMITS.maxBytes. Assert frozen parsed result and exact data. Native spy can also capture exact owned FileHandle/EBADF and no other file opens. Run SOLE shellcommand `node_modules/.bin/vitest run tests/unit/selected-config-file.test.ts` in prepared workdir. Actual missing-module failure before source is setup only. If blocked STOP, never write source to appease progress.

Minimal source to satisfy positive test (do not preload decoder catch):
```ts
import { readSelectedDataFile } from './selected-file.ts';
import { CONFIG_LIMITS, parseConfig } from '../assets/config.ts';
import type { GeoramaConfig } from '../assets/config.ts';
import { decodeAssetText } from '../../src/core/assets/asset-json.ts';
export async function readSelectedConfigFile(filename: string): Promise<GeoramaConfig> {
  const bytes = await readSelectedDataFile(filename, CONFIG_LIMITS.maxBytes);
  return parseConfig(decodeAssetText(bytes));
}
```
Run direct GREEN. Reusing already strict reviewed dependencies is intentional; their later refusal cases may first-GREEN and must be labeled verify-pass, not reconstructed RED.

### B — genuine decoder-error translation

Write a malformed UTF8 sequence INSIDE a JSON path STRING where replacement-decoding would otherwise produce a valid config: fictional bytes before/after0xff. Expect ConfigError SYNTAX/key'' and generic message/no cause. Current source throws AssetJsonError ENCODING; observe exact class/code behavioral failure BEFORE new catch. Also a controlled decoder throw can pin all-throw normalization independently of payload. Only THEN add scoped decoder catch and ConfigError import. Source shape:
```ts
const bytes = await readSelectedDataFile(filename, CONFIG_LIMITS.maxBytes);
let text: string;
try { text = decodeAssetText(bytes); }
catch { throw new ConfigError('SYNTAX', '', 'config is not valid UTF-8'); }
return parseConfig(text);
```
Run same direct GREEN. Never insert catch just because the earlier cap or setup RED exists.

### C — permanent composition/lifecycle matrix

Tests before any further source behavior (none planned): real Unicode config; leading BOM rejects via parseConfig, empty/malformed/array/null/wrong key type/relative path and unknown-key policy exactly frozen schema;64roots bounds through parser. Exact65536-byte JSON+padding accepted,65537-byte sparse refusal before decode; no huge allocations. Wrong filename types/unsupported suffix/missing/leaf symlink/FIFO deadline propagate C7 codes (these reuse dependency, honest verify-pass). All7 SelectedFileError code identities unchanged from mocked reader; decoder never called after reader failure. Parser's ConfigError identities/keys unchanged and not caught by decoder catch. Gate actual native close (realclose first then gate) and assert decoder not invoked until gate release; release in finally, exact-handle EBADF. Fresh returned root/arrays across rereads, no retained/cached result, one selected read/no additional IO. Decode failure tests inject by operation position, not byte length. Do not weaken frozen dependencies or modify their tests.

## Gates and delivery

Run SOLE shellcommand per test tool call (no appended echo/EXIT/stat/hash/tee/pipes/prefix or reporter changes). Take mtimes separately. Direct own tests default AND `--pool=threads --no-file-parallelism`, then `npm test` and `npm run build` (three projects). Preserve failures, including known untouched sparse200ms benchmark; quiescent full rerun only, no threshold edit. Source/module filesystem read is synthetic only; native helpers real-close-before-injected-report-error and all roots finallyremoved.

Commit ONLY2allowedfiles via `git -c user.name=Ichi -c user.email=ichi@localhost commit`, no sharedgitconfig. Save COMPLETE DELIVERY.json+physicallyseparate NOTES.md at owned evidence/T06c8-config; actual outputs/statuses and first-write/RED/source/GREEN ordering, absolute paths, deviations/notobserved honest. Do not claim first-run-genuine RED for cases that first passed.

Parent regenerates operators+anchored composition omissions: fixedcap, singlecall, rawfilename, strictdecoder use, missing/overscopedcatch, errorclass/key/identity, parsercall/return/cache/extraIO, ownership/close-decode ordering. Tiny controls first/last, gaps closed in separate strength file, real failures/timeouts/setup/equivalents separately. Both final reviews read all final files and explicitly run each required pool; missing gates get narrow supplement under same call cap. Privacy full diff+messages/positive controls, dry+actual full/all-asset+selectedthreads/build/nativeGPU/hidden/cleanup repeated serially. No extra standalone adversary needed for thin composition of already-defensively-reviewed C7/strict parser; whole-asset defensive integration remains pending later. Full CLI/config-root evidence workflow, fresh real-data volume and renderer/editor are NOT completed by this component.
