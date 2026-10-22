# Map asset reference inventory implementation plan

> For Hermes: use subagent-driven-development, vertical TDD, parent strength, SPEC then separate quality, serial dry/actual gates.

**Goal:** Give the future headless asset-evidence CLI a deterministic, lossless inventory of every explicit image-reference field in a parsed v15 map, without filesystem access or guessed defaults.
**Architecture:** New portable pure helper accepts the minimal readonly structural projection of a validated WdMap. It groups exact (RefKind, raw string) pairs, records every source location, and separately reports embedded ImageTexture symbol locations. Existing resolvers/readers are unchanged; inventory is not reference validation or authorization.
**Tech:** existing TS7/Vitest5; no packages/network.
**Base:** integrated50b5ae4c26e804ce1341d2f672028334e31326e7;1934unitPASS/7skip,115focused, nativeGPU10/eight formats,hidden9,cleanup3.
**Authority:** existing approved master-plan0.6 asset evidence and the owner's continuing do-all direction. This is genuine NEW collection functionality, not another source correction to C3/PCK/GPU/C5.
**Budget:**45-minute end-to-end fuse from dispatch, at mostnine delegate calls, maximumtwo source corrections for THIS helper across both reviews; all old exhausted budgets stay frozen. Expected producer4minutes/~40calls, parent measurement/strength5, reviews3+3, full replay/privacy/both integration3 plus cleanup/checkpoint margin. Record actual start/deadline at dispatch; stop/checkpoint if whole remaining route cannot fit.

## Scope

- NEW `src/core/assets/map-refs.ts`.
- NEW `tests/unit/assets-map-refs.test.ts`.
- Parent may add `tests/unit/assets-map-refs-strength.test.ts` before review seal.
- All existing source/tests/core codecs/readers/config/resolvers/theme/symbol/store/package/renderer/IPC/CLI/helpers and spike stay byte-identical.
- No actual private maps/assets; fixtures invented from the typed projection. No filesystem, Node/DOM imports, decoding, resource reads, default guesses or asset availability claims.

## Public interface

```ts
import type { WdMap } from '../formats/wonderdraft-map.ts';
import type { RefKind } from './resolve.ts';
export interface MapAssetInput {
  readonly theme: Readonly<Pick<WdMap['theme'], 'waterTexture' | 'groundTexture'>>;
  readonly frame: Readonly<Pick<WdMap['frame'], 'texture'>>;
  readonly paths: readonly Readonly<Pick<WdMap['paths'][number], 'style'>>[];
  readonly territories: Readonly<{ territories: readonly Readonly<Pick<WdMap['territories']['territories'][number], 'style'>>[] }>;
  readonly symbols: readonly Readonly<Pick<WdMap['symbols'][number], 'texture'>>[];
}
export interface MapAssetGroup {
  readonly kind: RefKind;
  readonly reference: string;
  readonly locations: readonly string[];
}
export interface MapAssetInventory {
  readonly groups: readonly MapAssetGroup[];
  readonly embeddedSymbolLocations: readonly string[];
}
export function collectMapAssetRefs(map: MapAssetInput): MapAssetInventory;
```

WdMap must be assignable to MapAssetInput (prove through TS typecheck). Input domain is the validated parsed model projection, not arbitrary JS objects/proxies; do not add a second map schema validator or claim malformed-shape safety. Untrusted raw reference STRINGS remain opaque inventory data, not authorized IO. The existing resolver handles their refusal later.

## Exact field matrix and order

Visit exactly in this order, including empty strings and disabled/inactive frame references (this inventories EXPLICIT fields, not active rendering):

| Model field | kind | emitted source location |
|---|---|---|
| theme.waterTexture | water-texture | /theme/water_texture |
| theme.groundTexture | ground-texture | /theme/ground_texture |
| frame.texture | frame-texture | /frame/texture |
| paths[i].style | path-style | /paths/i/style |
| territories.territories[i].style | border-style | /territories/territories/i/style |
| symbols[i].texture when string | symbol | /symbols/i/texture |
| symbols[i].texture when ImageTexture GdObject | NO external group | append /symbols/i/texture to embeddedSymbolLocations |

The projection's symbol texture union is already validated string|GdObject(ImageTexture); no traversal into embedded data, no serialization/coercion. Fonts, pack names, unknown metadata, raw windrose/trace/boxes values and rasters are not image-reference fields and are not scanned.

Group only by exact kind PLUS exact original reference; do not merge same string across kinds or different Unicode/case/percent spellings. A nested Map keyed by kind then reference avoids delimiter collisions (raw strings may themselves contain any delimiter/control). Each group's locations retains visit/index order and includes EVERY occurrence exactly once, including repeated references and nonadjacent duplicates. Output groups sorted by kind then reference using JS code-unit lexical ordering (a<b/a>b), not localeCompare or normalized spellings. Embedded locations remain original symbol-index order, including two symbols sharing the same object.

Freeze returned root, groups array, EVERY group record and its locations array, and embeddedSymbolLocations. Return fresh containers every call; no mutable module-level accumulator. Do not retain input arrays/objects, mutate inputs or freeze caller-owned data. Raw strings may be retained by value. Consumer may distinguish explicit empty refs from absence; no trimming or validation/default synthesis here.

## Task1 — tracer bullets

FIRST mutation minimal test exercising ground/water/frame explicit fields and frozen output shape with an invented MapAssetInput fixture (remaining arrays empty). Run DIRECT `node_modules/.bin/vitest run tests/unit/assets-map-refs.test.ts` from prepared worktree, observe actual missing-module failure before source. Missing-module is setup-only, not a behavioral claim. If blocked STOP without production; never appease the guard.

After minimal GREEN, add separate real behavior tests before respective implementations for path/border traversal; string vs embedded symbol handling; repeated same-kind references with exact locations; deterministic ordering/cross-kind identity; opaque empty/case/percent/decomposed/control/delimiter references; fresh immutable outputs/input nonmutation. Each NEW behavior is RED before its source. Already-general behavior first-GREEN is reported verify-pass, not fabricated RED. No premature runtime guards: the domain is already-validated MapAssetInput, no TYPE/EMPTY validation is specified. Preserve failed attempts.

Example fixture:
```ts
const input: MapAssetInput = {
  theme: { waterTexture:'synthetic-water', groundTexture:'synthetic-ground' },
  frame: { texture:'' }, paths:[], territories:{territories:[]}, symbols:[],
};
// Sorted kinds: frame-texture, ground-texture, water-texture.
// Empty frame string is still an explicit group with /frame/texture location.
```

Use `new GdObject('ImageTexture', ...)` only after inspecting actual frozen constructor signature. No hand-copied private GdObject/map values. Add compile-time assignment proof using a type-only WdMap parameter, never an unsafe cast that bypasses the actual assignability requirement.

## Task2 — focused/full gates

- `node_modules/.bin/vitest run tests/unit/assets-map-refs.test.ts` default and `--pool=threads --no-file-parallelism`.
- `npm test` expected no new failures (baseline1934PASS/7skip; known untouched sparse200ms benchmark may flake, preserve/retry quiescent without threshold edits).
- `npm run build`, all three typechecks.
- Exact2-file diff, no private paths/data, explicit git identity `git -c user.name=Ichi -c user.email=ichi@localhost commit`, never git config.

## Parent acceptance

Generate CURRENT-source operators plus anchored omission of each field, grouping dimension, sort, embedded classification and freeze/ownership operation. One location per field and index, duplicates under shuffled appearance order, both same-kind/cross-kind equality, delimiter/case/NFC opacity and shared embedded objects. Close real gaps in separate strength file; no source fix from coordinator, use at mosttwo authorized corrections and fresh review seals. Qualify equivalent survivors by exact groups/locations/order/freeze, not merely equal counts.

Fresh version-pinned SPEC then separate quality/security read all changed files fully, direct gates and own assertion sidecars. This helper introduces no IO/auth/IPC/network/deletes; whole-asset adversary remains mandatory for full0.6, not replaced by this helper review. Scope/privacy scan including commit messages before dry and actual merges; full unit/focused threads/build/nativeGPU/hidden/cleanup repeated on both. No GPU while Node implementation/review active. Master promotion, CLI completeness and fresh real-data proof not claimed. The external source volume remains unmounted; no mounting/discovery as a side effect.
