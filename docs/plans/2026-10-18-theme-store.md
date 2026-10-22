# Explicit theme-file loading implementation plan

> For Hermes: subagent-driven-development, strict vertical TDD, parent current-source mutation measurement, fresh independent SPEC then quality/security, serial dry/actual integration.

**Goal:** Complete the theme-JSON service part of master-plan0.6 using explicit data-file references, without guessing real install paths or changing image/symbol behavior.
**Architecture:** A new pure theme-reference validator accepts only explicit `res://` or `user://` `.wonderdraft_theme` files. Existing Node asset store reads the validated PCK virtual path or user-data-relative path through its existing readers and shared four-operation admission/drain state, then `parseThemeFile(decodeAssetText(bytes))`.
**Tech:** existing Node22/TS7/Vitest5, no packages or network.
**Base:** reviewed integration `84c090ea5cc0a6a3e2f9492930d1c97e36653549`, parent1886passed/seven skipped,67 focused, nativeGPU10/eight formats, hidden9/9, cleanup3/3.
**Authority:** The owner's “so? continue and do all,” remaining approved master-plan0.6. Genuine new theme functionality; never a reset of completed image/PCK correction allowances.
**Wave:**90-minute fuse, at mostnine delegate calls including up totwo new-feature source corrections and fresh SPEC+quality after each, parent campaigns on both modules, replay/privacy reconciliation and both integration passes. Producer8minutes/~80calls; reviews4minutes. Reserve measured closing gates before merging; no last-second gate starts. One source-correction counter across validator and service.
**Data availability:** expected external volume is unmounted. All fixtures are invented. This API defines explicit reference behavior; no claim that any real theme path exists or that fresh real-data proof passed. No mounting or discovery scans as a side effect.

## Exact scope

- Create `src/core/assets/theme-ref.ts` (pure; no Node/DOM/FS imports).
- Create `tests/unit/assets-theme-ref.test.ts`.
- Modify `electron/assets/store.ts` only for theme API/imports/own cap helper/request body.
- Create `tests/unit/assets-theme-store.test.ts`.
- Parent may add `tests/unit/assets-theme-ref-strength.test.ts` and `assets-theme-store-strength.test.ts` before review seal.
- Existing image/symbol67 tests, `resolve.ts`, `asset-json.ts`, PCK/open/config, all other core/helpers/package/renderer/IPC/CLI and `spike/` stay byte-identical.
- No resource enumeration/default-theme guessing/config/CLI/IPC/pixel decode/cache/raw offset APIs. Full asset adversary and fresh real-data verification remain later gates.

## Pure reference API and exact validation order

```ts
export const THEME_REF_LIMITS = Object.freeze({ maxChars: 512, maxSegments: 16, maxSegmentBytes: 255 });
export type ThemeRefErrorCode = 'TYPE' | 'EMPTY' | 'TOO_LONG' | 'CHARACTER' | 'SCHEME' | 'SEGMENT' | 'EXTENSION';
export class ThemeRefError extends Error {
  readonly code: ThemeRefErrorCode;
  constructor(code: ThemeRefErrorCode, message: string) {
    super(message); this.name = 'ThemeRefError'; this.code = code;
  }
}
export type ThemeRef = Readonly<{ source: 'pck'; path: string }> | Readonly<{ source: 'user'; path: string }>;
export function resolveThemeRef(reference: string): ThemeRef;
```

Order: runtime type string or TYPE (never coerce) -> empty EMPTY -> UTF16 length above512 TOO_LONG -> CHARACTER gate -> exact lowercase scheme -> segments -> exact extension. Return frozen plain ref. Wrong inputs never leak raw JS errors.

Character gate matches existing reference policy: reject C0, DEL/C1, backslash, unpaired surrogates, U+2028/2029, U+202A..202E, U+2066..2069, FEFF/FFFE/FFFF; allow paired Unicode, punctuation and percent literals otherwise. No percent/URI decoding, Unicode normalization, case folding or path normalization.

Only exact prefixes `res://` and `user://`. The remainder must contain1..16 nonempty slash-separated segments, none `.`/`..` or beginning `.`, every segment at most255 UTF8 bytes (TextEncoder). Extension must be exactly `.wonderdraft_theme` on the final path, case-sensitive; caller cannot select other data/compiled types. No silent extension appending/stripping. These explicit refs do NOT assume a particular theme directory layout.

Examples:
- `res://themes/synthetic/Willow.wonderdraft_theme` -> `{source:'pck',path:originalFullReference}`.
- `user://themes/synthetic/Willow.wonderdraft_theme` -> `{source:'user',path:'themes/synthetic/Willow.wonderdraft_theme'}`.
- `user://assets/synthetic-pack/themes/Willow.wonderdraft_theme` remains that relative path under the original user-data root.
- Literal `%2e%2e` is not decoded into traversal. Actual dot/empty/leading-dot segments refuse. Leading/trailing slash in remainder refuses. Native user-reader punctuation/path budgets remain authoritative and may refuse more tightly.
- Error messages are path-free; exact English text is not fixed.

## Node API addition

```ts
export const THEME_STORE_LIMITS = Object.freeze({ maxReadBytes: ASSET_JSON_LIMITS.maxChars });
export interface ThemeAsset { readonly key: string; readonly ref: ThemeRef; readonly file: ThemeFile; }
// Extend existing AssetStore, retain both earlier signatures/limits unchanged:
// readTheme(reference: string, maxBytes?: number): Promise<ThemeAsset>
```

`ThemeFile`/`parseThemeFile`/`decodeAssetText` come from frozen `src/core/assets/asset-json.ts`. Order: cap validate (undefined1MiB, safeint0..1MiB only lowering, no coercion) -> resolveThemeRef -> virtual key -> CLOSED -> missing declared source ROOT -> shared global BUSY/admit -> read -> strict decode+full theme parser -> finally release. All image+symbol+theme requests share FOUR slots across both sources.

PCK `heldSession.readData(ref.path,cap)`; user `readAssetFile(userDataRoot,ref.path,cap)` — theme paths are already relative to the original user-data root. Do NOT prepend `assets/` unconditionally, and NEVER reauthorize a derived theme directory. Enforce `.wonderdraft_theme` via the pure resolver before backend access. No caller-supplied arbitrary resolved-ref object API.

Keys are distinct across service domains: `theme:pck:${ref.path}` or `theme:user:${ref.path}`. Freeze result/ref, return fresh caller-owned parsed tree/maps, not a false deep-immutable-Map promise. No metadata encoded-byte copy and no cache. Preserve native/PCK/AssetJson errors and parser JSON pointer fields. Physical cap errors may occur before decoder TOO_LARGE. Existing image64MiB, symbol1MiB, root capture/error mapping, close order/failure idempotence, accepted operations and all67 existing cases remain unchanged. Keep public promise settle-before-close in user-only stores; avoid gratuitous shared-async refactors.

## Task1 — pure validator verticals

First minimal positive test (missing-module setup RED separated), minimal PCK result GREEN. Then real behavioral wrong-type/empty/scheme/segment/extension RED before implementing those validations; expand to user refs and boundaries. Exact limit-1/limit/limit+1 char/segment/UTF8 tests; paired/unpaired Unicode, every control class, opacity `%2e`/spaces/punctuation, lowercase/suffix strictness. Every boundary probe has a valid control. No horizontal pile of unexecuted imagined tests followed by full implementation. Do not edit the existing resolver to obtain reuse.

Direct `node_modules/.bin/vitest run tests/unit/assets-theme-ref.test.ts` RED/GREEN. Freeze limits/result and check shape/path equality. Generate wrong-type input table including null/undefined/Symbol/throwing valueOf/toString with zero coercions.

## Task2 — first real theme read vertical

Write a failing builtin readTheme test through the existing factory, then minimal implementation GREEN. Use a complete INVENTED theme object with the actual required parser keys:

```ts
const color = '0.1,0.2,0.3,1';
const theme = {
  water_texture:'synthetic-water', ground_texture:'synthetic-ground',
  water_hue:0, water_saturation:1, water_value:1, vignette_strength:0,
  coastal_fx_distance:1, coastline_style:0, coastline_color:color,
  landmass_outline_color:color, landmass_outline_blend:0,
  freshwater_color:color, freshwater_outline_color:color,
  ground_colors:[color], path_color:color, windrose_color:color,
  symbol_custom_colors:[color], label_presets:{ synthetic:{
    font_name:'Synthetic Font', font_size:12, font_color:color,
    font_outline_width:1, font_outline_color:color,
  }},
};
// buildPck([{path:'res://themes/synthetic/Willow.wonderdraft_theme',data:encoder.encode(JSON.stringify(theme))}])
// store.readTheme('res://themes/synthetic/Willow.wonderdraft_theme') => file.waterTexture synthetic-water
```

Then user-root `themes/...` and `assets/pack/themes/...` routes, distinct virtual keys, no source/folder fallback, caller tree/map mutation isolation and unknown-key handling. No actual private assets or copied real theme JSON. Backend/PCK/helpers remain untouched.

## Task3 — strictness, caps and shared lifetime

Pin BOM SYNTAX, invalid UTF8 ENCODING inside otherwise JSON-shaped bytes, missing required theme key SHAPE, invalid field/color TYPE, valid controls and slot release. UTF8 byte cap len-1/len/len+1 on BOTH sources, zero accepted by cap checker before missing ROOT,1MiB and1MiB+1, malformed/no-coercion caps, cap/ref/CLOSED/ROOT/BUSY priority. Wrong extension must refuse before backend IO (even when a fake `.gdc` entry exists; NEVER read real compiled data).

Deterministic native gates mixing all3methods/bothsources: four admitted, fifth from each method BUSY before extra IO; release every gate in finally. Close while a user theme read is held: no PCK close yet, all3 valid new methods CLOSED, accepted operation completes and public promise settles before close in user-only stores too. No fixed-sleep-only proof, no timers/fixtures/handles left. Existing67 cases stay byte-identical.

## Task4 — direct gates and seal

From exact workdir, default reporter, true exits visible, no tee/pipes/basic/prefix:
- `node_modules/.bin/vitest run tests/unit/assets-theme-ref.test.ts tests/unit/assets-theme-store.test.ts tests/unit/assets-store.test.ts tests/unit/assets-store-strength.test.ts tests/unit/assets-symbol-store.test.ts tests/unit/assets-symbol-store-strength.test.ts`
- Same with `--pool=threads --no-file-parallelism` (measured process-wide FD table interference across old frozen tests; within-file concurrency preserved).
- `npm test` (baseline1886passed/seven skipped), `npm run build`.

Producer may read actual frozen parser/reference/helpers and new task scope only, no repo-wide exploration/private discovery. Track all temp roots under managed scratch, real native closes and removal on failure; no GC warnings hidden. Own evidence notes/RED/GREEN/DELIVERY.json, preserve failed attempts honestly. Commit ONLY4 allowed files, explicit Ichi/ichi@localhost identity, no shared git config edits, scoped privacy diff+message, clean tracked status.

## Parent acceptance

Current-source operator+anchored campaigns for BOTH new pure validator and expanded store. Crosswalk all125 prior image/symbol mutants into unchanged blocks, regenerate after source changes. Add strength files for actual non-equivalent gaps, including extension/data-only gate, every ref-bound clause, strict decode/parser/caller cap, actual user root path/no-prefixing, shared admission/finally/close and no second encoded region. Verify controls first/last and distinguish test failures/timeouts/setup; independently qualify survivors against actual caller exception domains. Fresh independent SPEC then separate quality/security cover final strengthened seal. Separate privacy/scope gate, dry merge/full unit+serialized threads+build+nativeGPU+hidden/cleanup, actual normal merge and repeat gates. Full0.6/app remain incomplete until config/evidence CLI, full asset adversary and fresh real-data proof plus downstream phases.
