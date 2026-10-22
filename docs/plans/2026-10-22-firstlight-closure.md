# 0.12 first light v0: closure record (02:02:43 -03 2026-10-22)

Status: engineering gates closed. The picture judgement is the owner's and has not been given. No claim that the render matches Wonderdraft.

## What v0 is
- One 1024 x 1024 window at 1:<redacted> from one map in the approved folder. Not the whole map.
- Land and water from the heightmap at the map's water level; ground colour from the ground paint; water tint over a flat base colour; coastline painted into the layers on the CPU (two-texel band, both sides).
- Not in v0: symbols, built-in water and ground textures, labels, paths, grid, scale. The side-by-side shows them as absent.

## Chain
- Card `8c1fcfd`. Scope decision `2704610`. Standing GPU approval `4dc73dd`.
- Producer seal `4914c9d`: six files, 10 unit tests. Reviews at the seal: SPEC PASS (11 checks, no gaps). QUALITY PASS (no security concerns, no logic errors, 350-case differential probe with zero mismatches; one Minor finding on the repo-root guard).
- Correction 1 (cap 2, one used), commit `d4f179f`: the guard now refuses folders named with a leading double dot and symlinks into the repo before any write. Checked without writing into the repo. Focused SPEC re-review PASS; focused QUALITY re-review PASS (10 edge cases, zero mismatches).
- Test-only pins (parent; no reviewer under the pace rules; not counted as a source correction): 12 unit tests added from the mutation sweep. Seal `d12e05f` (one commit over base, author Ichi).
- Dry tree `6efde20` (tree equal to the seal). Integration tip `208eda2` (tree equal to the dry tree).

## Node gates
- Typecheck 0. `npm test` 2366 passed, 7 skipped (2344 + 22). New unit file 22/22 on the threaded pool. Boundary 235/235. Build 0. Offline shader check on `src/`: 5 sources, 0 failing.

## Mutation sweep on the layers module (seal `d12e05f`)
- 43 mutants by exact-string replacement, each string checked unique. Controls passed at the start and the end.
- Killed by assertion: 40. Equivalent by construction (no pin): 2 (removing the self-skip; removing a redundant water-class guard). Not counted: 1, the stride-zero check removed, where the loop never ends. Its test hangs rather than fails, so it is an open gap.
- Before the pins, 13 non-equivalent survivors. After the pins, none.

## GPU window (standing yes; one 40-minute window for this card)
- Opened 01:57:49 -03 2026-10-22; closed 01:58:31 -03 2026-10-22. Fuse 40 minutes.
- Dry tree: `e2e:gl` with the first-light inputs, exit 0, 31 PASS, 0 FAIL. First-light readback exact-matched the CPU reference on every texel; orientation PASS. Smoke `e2e` exit 0, 9 of 9. Cleanup exit 0 (30 PASS lines; its summary line was not captured in that run).
- Integration tip: `e2e:gl` exit 0, 31 PASS, 0 FAIL; first-light exact on every texel; orientation PASS. Smoke 9 of 9. Cleanup exit 0, `CLEANUP: 3/3 signals passed`.
- Render files on the dry and tip trees: byte-identical.
- Visible windows: the compositor client list was read before and after the runs. No Electron or Georama client appeared. No Electron process was left running. Not observed: a screen capture.

## Pairing (aggregates kept in scratch)
- Coastline positions in the render sit on the reference export's edges well above a shifted-crop control, under both edge thresholds and both tolerances tried.
- The same-size candidate versions of the map share identical mask, ground and tint data at this window, so the render does not depend on which copy was used. Which copy the export came from is not decided, and v0 does not need it.

## Open
- The owner's judgement of the side-by-side (scratch; delivered to chat).
- Stride-zero mutant: a kill needs a child-process test with a timeout. Not done.
- Non-blocking QUALITY notes: summed-area tables are Float64 (about 511 MB at this map size; Uint32 halves it); two causes share one error message in the window selector; the window parser is lenient; the PNG encoder does not validate its input.
- D10 `<redacted>`: left read-write, as decided earlier.
- The other maps outside the approved folder were not read.
- Full-map and zoomed views, coastline distance field, symbols, and textures are later cards.
