# `.wonderdraft_map` v15 — decoded format notes

**Provenance.** Black-box analysis of the owner's own files (<redacted> files / <redacted> / <redacted>, every one version 15) plus Godot's open-source container layout (MIT). No Wonderdraft code, shader or compiled script was decompiled or read. **Verified by:** all <redacted> files decode byte-exact (the parse ends on the last byte, footer present, one single schema), and a visual check of a decoded map (land/water/ground/overlays form a coherent world). Reference decoders: `spike/gcpf.mjs`, `spike/godot-var.mjs`; tools: `spike/inspect.mjs`, `spike/corpus.mjs`, `spike/analyze.mjs`.

## 1. Container — Godot `FileAccessCompressed` (`GCPF`), little-endian

| offset | size | field |
|---|---|---|
| 0 | 4 | `GCPF` |
| 4 | 4 | compression mode (0 = FastLZ) |
| 8 | 4 | block size (4096) |
| 12 | 4 | total uncompressed size |
| 16 | 4·N | compressed size of every block, N = ⌊total / blockSize⌋ + 1 |
| … | … | blocks; each is an independent FastLZ level-1 stream (back-references never cross a block start) |
| end | 4 | footer `GCPF` |

All-zero blocks compress to ~57 bytes, which is why a ~420 MB payload is a 43–107 MB file.

## 2. Payload — Godot 3.x binary Variant (`File.store_var`)

`u32 length` (= total − 4), then exactly one Variant: a Dictionary with 28 keys.
Variant header `u32`: bits 0–7 = type, bit 16 = 64-bit flag.

| type | meaning | encoding |
|---|---|---|
| 0 | nil | — |
| 1 | bool | u32 |
| 2 | int | i32, or i64 when flag set |
| 3 | real | f32, or f64 when flag set |
| 4 | string | u32 length, UTF-8, padded to 4 |
| 5 / 6 | Vector2 / Rect2 | 2 / 4 × f32 |
| 14 | Color | 4 × f32 (0..1) |
| 15 | NodePath | u32 (bit31 = new format; name count), u32 subname count, u32 flags, then strings |
| 17 | Object | class string; if it is empty the value is the **null Object** and nothing follows (8 bytes in total, distinct from nil's 4); otherwise u32 property count, then (name string, Variant) pairs |
| 18 / 19 | Dictionary / Array | u32 count (bit31 = shared flag), then entries |
| 20 | PoolByteArray | u32 length, bytes, padded to 4 |
| 7–13, 21–26 | other math types, pool arrays | per Godot layout (implemented in the spike; most not exercised by the corpus) |

## 3. Root keys (v15, fixed order)

`version`(15) · `map_width` `map_height` (real, e.g. <redacted> × <redacted>) · `water_level`(0.61) · `water_flip_x/y` · `water_offset`(Vector2) · `water_stain` · `windroses`[] · `theme` · `layers` · `paths`[] · `territories` · `symbols`[] · `labels`[] · `sharpen_labels` · `mask` · `ground` · `water_tint` · `trace` · `grid` · `frame` · `scale` · `boxes`[] · `load_default_symbols` · `load_default_not_symbols` · `included_default_packs`[] · `included_packs`[]

### `theme` (24 keys)
`water_texture`, `ground_texture` (names of built-in textures) · `water_hue/saturation/value` · `vignette_strength` · `coastal_fx_distance` · `coastline_style` · `coastline_color` · `landmass_outline_color/blend` · `freshwater_color`, `freshwater_outline_color` · `ground_colors`[10] + `ground_color_names` · `water_colors`[7] + `water_color_names` · `path_color` · `symbol_custom_colors`[3] · `windrose_color` · `label_presets` {City, Town, Water → `font_name font_size font_color font_outline_width font_outline_color`} · `color_grading` {offsets: PoolReal[4], colors: PoolColor[4], strength} · `randomize_water_mirror`, `randomize_water_offsets`.

### Records
- `layers` {`enabled`, `names`[11] (`+5`…`Default`…`-5`), `visibility`[11], `lock`[11]} — z-layers; `enabled` is false in all observed maps.
- `paths[]` {`position` V2, `points` **string** (Godot `var2str` text of a PoolVector2Array: `[ Vector2( x, y ), … ]`), `color`, `style` (`res://textures/paths/<name>`), `width`, `roughness`, `noise_seed`, `z_index`, `straight`}.
- `territories.territories[]` {`position`, `points` (text, same form), `smoothing`, `color`, `opacity`, `style` (`res://textures/borders/<name>`), `width`, `z_index`}.
- `symbols[]` {`texture`, `position` V2, `rotation`, `scale` V2, `z_index` (−5…+5), `offset` V2, `radius`, `type` (`tree`/`mountain`/`symbol`), `mirror`, `sample` (Color or nil), `custom_colors`, `custom_color_mode` (nil in every sample seen)}.
- `labels[]` {`position`, `rotation` (degrees), `text`, `font`, `size`, `color`, `outline_size`, `outline_color`, `glow_size`, `glow_color`, `align`, `curve`, `extra_spacing_char`, `z_index`}.
- `frame` {`enabled`, `texture`, `size`, `tint`} · `scale` {`position`, `rotation`, `colors`, `size` V2, `segments`, `line_width`, `segment_distance`, `numbers_display`, `font`, `font_size`, `outline_width`, `font_color`, `outline_color`, `units`} · `grid` {`pattern`, `layer`, `size`, `line_width`, `color`, `offset`} or nil · `trace` nil in all observed maps · `windroses` empty in all observed maps.
- `boxes[]` — a serialized Godot **`NinePatchRect` object** (≈52 scene-node properties) holding an `ImageTexture` → `Image`; position/size live in `margin_left/top/right/bottom`.

## 4. Raster layers — three serialized Godot `Image` objects (RGBA8, `map_width × map_height`, row-major, top-left origin)

Each is `Object:Image` {`data` {`width`, `height`, `format`:"RGBA8", `mipmaps`:false, `data`: PoolByteArray}}; ≈139 MB each for <redacted>×<redacted>.

| layer | meaning (verified) |
|---|---|
| `mask` | **A = heightmap.** Land ⇔ `A ≥ round(water_level × <redacted>)` (map <redacted>: <redacted>). Confirmed visually, and <redacted> % of that map's <redacted> symbols stand at A ≥ <redacted> The map is a full generated world; the "noise" is the unpopulated rest of it. R/G/B are <redacted>/<redacted>-style flags (R><redacted>: ~<redacted> % of pixels, <redacted> % of them on land; G/B><redacted>: ~<redacted> %, <redacted> % on land). **Role of R/G/B not yet confirmed** (candidates: painted-land / coast flags). |
| `ground` | Fully opaque (A = 255 everywhere). RGB = ground colour paint; shown on land. |
| `water_tint` | Sparse RGBA tint painted over water; ~85 % of pixels have A = 0. |

## 5. Asset references (as stored in `symbols[].texture`, etc.)

- `res://sprites/{trees,mountains,symbols}/<set>/<name>` — built-in, inside the install's `.pck` as `<name>.wonderdraft_image` (**a plain PNG**).
- `res://packs/<DefaultPack>/sprites/…` — built-in packs (Arabia by Chan, Gothic Horror, Tang Dynasty by Chan).
- `assets/<CustomPack>/…` — user packs in the Wonderdraft user-data `assets/` folder (here: `GogotsMaps-Hand Draw`, `themes`).
- Path/border/ground/water styles are referenced by name (`res://textures/paths/path_blended`, `border_gradient`, theme `Worn`, …).
- `.wonderdraft_theme` = plain JSON; `.wonderdraft_symbols` = plain JSON per symbol folder.

## 6. `.pck` (Godot 3.0, `GDPC` v1) index layout

`magic(4) pack_version(4)=1 godot_major(4) minor(4) rev(4) reserved 16×u32 file_count(u32)`, then per file `{u32 path_len (padded to 4), path, u64 offset, u64 size, 16-byte md5}`; offsets are absolute in the standalone `.pck`. Install inspected: 2403 files — 1745 `.wonderdraft_image` (PNG), 114 compiled scripts (**not touched**), 21 shaders (**names only, not read**), 18 fonts (OFL families), 9 themes.

## 7. Corpus facts (<redacted> maps)

Sizes <redacted> (<redacted>), <redacted>×<redacted> (<redacted>), <redacted>×<redacted> (<redacted>), <redacted>×<redacted> (<redacted>), <redacted> (<redacted>). Max per map: symbols <redacted> · labels <redacted> · territories <redacted> · paths <redacted> Grids on <redacted> maps, a legend box on <redacted> **no** windroses, frames or traces. Theme pairs: (Equirectangular ground, Black & White water) · (Worn, Feudal) · (Worn, Black & White) · (Worn, Worn). Decode (Node <redacted>): <redacted>–<redacted> s per map.

## 8. Still unknown / to verify

`mask` R/G/B roles · exact `shared`-flag semantics · `coastline_style` enum · `sample` (per-symbol colour sample) behaviour · `custom_colors` / `custom_color_mode` encoding (none observed) · Wonderdraft's exact compositing order (settle by comparing against the real app's export — the reference oracle).

## 9. Writer rules (measured over the <redacted> maps; zero exceptions)

These are the contract for any encoder that must reproduce Wonderdraft-written bytes.

| Item | Measured |
|---|---|
| Int | every int is 64-bit-flagged (header `0x00010002` + i64): 629,544 of 629,544 (627,391 would fit in int32) |
| Real | f32 **iff** exactly representable as f32 (`Math.fround(v) === v`), else f64: 1,129,660 f32 · 17,515 f64 · 0 f64 values representable as f32 |
| String | u32 byte length + UTF-8 + zero padding to a multiple of 4: 7,843,979 strings; every pad byte is 0; all valid UTF-8 round-trip |
| PoolByteArray | u32 length + bytes + zero padding to 4 (every pad byte is 0) |
| Dictionary / Array | count word never has bit 31 set (562,640 dictionaries, 2,617 arrays); all 6,711,947 dictionary keys are strings, no duplicate keys |
| NodePath | new format only; only the empty path occurs (217×: 0 names, 0 subnames, flags 0) |
| Object | `Image` ×360, `NinePatchRect` ×31, `ImageTexture` ×189; 642 null objects (empty class string, `11 00 00 00 00 00 00 00`) next to real nils (`00 00 00 00`): the two are different wire values and must stay different in memory; no object-as-id |
| Types present | 0 1 2 3 4 5 6 14 15 17 18 19 20 22 26 — never seen: 7–13, 16, 21, 23–25 |
| Header flags | only bit 16 occurs; bools are 0/1 |
| End | every payload parses to its last byte (57/57) |
