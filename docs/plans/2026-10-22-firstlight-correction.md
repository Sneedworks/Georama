# 0.12 first light v0: correction and final record (02:43:39 -03 2026-10-22)

Corrects `docs/plans/2026-10-22-firstlight-closure.md` (commit 93134cc). That record is not rewritten; the corrections below name it and state the observed values.

Status: engineering gates closed on the final seal. The picture judgement is the owner's and has not been given. Nothing here claims that the render matches Wonderdraft.

## Corrections to 93134cc
1. **Visibility.** 93134cc says the compositor client list was read before and after the runs. It was read only around the integration-tip run: 6 clients before, none Electron- or Georama-like; none after, and no new client class. The dry-tree runs have no client-list reading. That read failed at window open because the Hyprland instance variable was unset, and the window was opened anyway instead of stopping. Dry-run visibility: not observed. The harness is hidden in code (`show: !e2e`), and no Electron process was running after the tip cleanup.
2. **SPEC count.** 93134cc says "11 checks". The reported checks were S1 to S8 and S11, with no gaps. The full SPEC report is not saved in scratch, so the count is not re-verified.
3. **QUALITY probe.** 93134cc calls the 350-case probe a reviewer claim. The reviewer's evidence file records 350 cases, 0 mismatches, an independent oracle and a fixed seed. That is observed.
4. **Map-derived figure.** 93134cc gives a memory figure at the map's size. It is computed from the map's dimensions, so it does not belong in a committed record. It is removed here. Memory at full-map size is not part of v0 and is not observed.
5. **Mutation status.** 93134cc lists the stride-zero mutant as an open gap. It is closed; see the sweep below.
6. **GPU output.** The full stdout of the GPU steps was not saved to scratch. Only pass and fail counts and the first-light line were parsed. The GL info log and any console errors in the window are not observed.
7. **Node.** The gate commands in the first round did not print `node -v`. The resolved Node was /usr/bin/node v22.23.3, checked separately. The final round printed it in each gate command.
8. **Budget.** The scratch budget file was stale (it said max 4). The card's rule is producer 1, SPEC 1, QUALITY 1, and each correction cycle adds a fix, a SPEC and a QUALITY review. Used: 4 delegate calls, 6 subagent tasks, 1 correction of 2. Corrected in scratch.
9. **Pairing wording.** "Same-size" copies is replaced by "candidate copies". The candidates were compared by per-layer hash, not by size.

## Seal chain (one commit over ac6abfa, author Ichi, subject as the card)
- 4914c9d: producer.
- d4f179f: correction 1 (repo-root guard), reviewed by SPEC and QUALITY re-reviews (both PASS).
- d12e05f: 12 test-only pins from the sweep (no reviewer, per the pace rules).
- 0cb1f2c: zero-stride pin replacing the first one, which hung under one mutant. Final seal.
- The GPU runs were on the tree of d12e05f. Since then, `git diff --name-only d12e05f 0cb1f2c` lists only `tests/unit/firstlight-layers.test.ts`.

## Trees
- Dry: 14704b7 (merge of 0cb1f2c onto ac6abfa). Superseded: 6efde20.
- Integration tip (integ/phase0-b): 72ca139, same tree. Superseded: 208eda2. The integration branch was reset to the base and re-merged, because the old merge conflicts with the amended commit. It is not promoted to master.

## Node gates (final seal, both trees; node v22.23.3 printed in each command)
- Typecheck 0. `npm test` 2366 passed, 7 skipped (2344 + 22). Unit file 22/22 on the threaded pool. Boundary exit 0. Build 0.
- Offline shader check on the gated tree `src/`: 5 sources, 0 failing.
- Not gated: `tests/gpu` as a whole gives 8 sources, 1 failing. The failure is `tests/gpu/cases-readback.ts:58`, a shader template with an interpolation that the checker reports as NEEDS-EVAL. That file is not in this card and is identical to the base.

## Mutation sweep (seal 0cb1f2c; 43 exact-string mutants; controls pass at start and end)
- Killed 41: 33 by `expect()` failures; 8 by a failed run with no AssertionError. Two were checked line by line (M11 and M47): in both, the mutant makes the function throw a RangeError inside the test body. The other six were not inspected line by line. If only `expect()` failures count, the kill count is 33 of 41.
- Equivalent 2, argued from the code: M08 (removing the self-skip; the self cell always has the same classification, so it never counts) and M30 (removing the water-class guard; the water coast flag is set only for water texels).
- Survivors (non-equivalent): 0. Timeouts: 0. Invalid: 0.
- Before the pins, 13 non-equivalent mutants survived: M03, M11, M12, M17, M21, M22, M23, M27, M28, M37, M38, M41, M47. M38 (stride check removed) had no zero-stride call in the producer's suite.
- The first zero-stride pin used a window that fits. Under M38 the scan loop never ends, which is a timeout and not a kill. The replacement uses a window larger than the map, so M38 returns without looping and fails with `expected ... to match /stride/`.

## GPU window (standing yes; one 40-minute window for this card)
- Opened 01:57:49 -03; closed 01:58:31 -03. Within the fuse.
- Dry (6efde20): `e2e:gl` exit 0, 31 PASS, 0 FAIL. First-light readback exact on every window texel; orientation PASS. Smoke `e2e` exit 0, 9 PASS. Cleanup exit 0, 30 PASS (its summary line not captured).
- Tip (208eda2): `e2e:gl` exit 0, 31 PASS, 0 FAIL; exact on every texel; orientation PASS. Smoke 9 PASS. Cleanup 3/3 signals passed.
- The render PNG is byte-identical across the two trees.
- Not observed: a screen capture; the GL info log; visibility during the dry runs.

## Pairing (aggregates in scratch)
- The render's coastline sits on the reference export's edges well above a shifted-crop control: aligned 0.80 to 1.00 against 0.08 to 0.39, across two edge thresholds and two tolerances.
- Candidate copies of the map share identical mask, ground and water data at this window (per-layer hashes). Which copy the export came from does not change the render. Not decided; v0 does not need it.

## Open
- Picture judgement: The owner. The side-by-side is in scratch and was delivered in chat.
- Non-blocking QUALITY suggestions, not done. Each changes source after the GPU run, so each needs its own card and window: summed-area tables use Float64; a transient map allocation in selectWindow; two causes share one error message in the window selector; the window parser is lenient; encodePngRgba8 does not validate its input. The RangeError idiom is pinned by the card and stays.
- Later cards need scope from the owner: full-map and zoomed views (tiling and a coastline distance field), symbols (card 0.11b, never written), and textures.
- The second ext4 volume is mounted read-write and is not on the approved list. Left untouched, as decided. The corpus volume is mounted read-only (verified this session).
- Eight extra maps: not read, not gated.
