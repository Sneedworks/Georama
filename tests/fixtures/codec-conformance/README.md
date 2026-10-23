# Frozen codec conformance vectors

`tests/unit/codec-conformance-golden.test.ts` contains **inline, immutable wire
fixtures** for three existing Georama codecs and one composed pipeline. No
production encoder is used to manufacture the input for its own decoder. This
supplements the generated/round-trip/fuzz fixtures in the existing unit suites:

| Wire input | Independent construction | Asserted behavior |
| --- | --- | --- |
| PNG RGBA8 3×2 | PNG chunks and CRC32 via Python `struct`/`zlib`; filtered rows built from explicit samples; zlib level 9 | Sub and Paeth filters, an ancillary `tEXt` chunk, three *consecutive* IDAT chunks, exact RGBA bytes |
| PNG indexed8 4×1 | Same PNG writer, four palette entries, three explicit tRNS alpha bytes | Indexed colors, full/zero/partial transparency, unspecified fourth alpha = 255 |
| GCPF 20-byte payload | `GCPF` header, u32 little-endian size table and literal-only FastLZ-1 blocks written by hand | Two independent blocks, 16-byte final-block padding, offsets, footer |
| Godot `store_var` | Godot 3 Variant tags and little-endian fields written with Python `struct` | Dictionary order, duplicate string keys, Unicode key, Vector2 signed zero, and padded PoolByteArray |
| GCPF → Godot `store_var` | Independent literal FastLZ wrapping the frozen Godot fixture | Chained container decode and Variant decode without production encoding of the input |

Fixture bytes and SHA-256 fingerprints are frozen in the test. Every expected
pixel/sample/value is written independently from its decoder. To keep the
fixtures auditable, the complete binary input is encoded as readable hexadecimal
rather than adding opaque binary files or committing any private map/asset.

## Provenance and validation

The two PNG fixtures were separately decoded with Pillow 12.3.0 (Python) and
produced exactly these RGBA byte strings:

- RGBA: `0a141e00fa0007ff012c50800b1623fff503093202374600`
- Indexed: `0a141eff28323c0046505a7f78828cff`

PNG IDAT byte streams are also independently decompressed by Node's `zlib` in
the Vitest suite and compared to explicit *filtered scanline* bytes. The GCPF
FastLZ input contains **literal instructions only**, so its bytes are directly
inspectable without a compression oracle. The Godot wire fixture is manually
assembled from the documented Godot Variant layout; **it has not been validated
against a running Godot executable**. The test verifies conformance to that
specified wire layout and round-trip byte preservation through Georama.

All fixtures contain only invented test values. No real Wonderdraft maps,
asset-pack data, file paths, private screenshots, or proprietary shaders are
included. There are no time or memory assertions that depend on a specific
machine or operating system.

## Running the isolated suite

```sh
npx vitest run tests/unit/codec-conformance-golden.test.ts
```

The test suite only imports existing portable codec APIs and Node standard
libraries. It does not modify production code, public APIs, UI, or the roadmap.

The SHA-256 checks protect against accidentally editing a frozen fixture. If a
wire fixture must be intentionally replaced, calculate a new fingerprint and
obtain a **separate independent decoding/format verification** for its expected
values, rather than deriving those values from Georama's decoder output.
