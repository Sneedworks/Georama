# Phase 0 approvals, 2026-10-21 (clock read 00:09:23 -03, from `date`)

The owner's reply to the D1 to D<redacted> list (decision record `docs/plans/2026-10-20-phase0-open-decisions.md`): "i approve all, do whatever you find the best, if you need permission just send to me and i approve".

Each item below takes the recommended option, or the best option where none is marked, and states the basis. Where an option names a stage (GPU, integration, a window), the approval covers only the stage the list named.

## Mapping

- **D1 data volume `<redacted>`: a.** Remount read-only (unmount, then `udisksctl mount -b <redacted> -o ro`), then check with `findmnt`. Basis: the recommended option; it matches the mount approval.
- **D2 0.11 window: 1a.** SPEC and QUALITY reviews on the seal, the dry merge onto `0b8b64e`, and the P1 real-data proof in scratch. The atlas probe runs first (decision record addendum 2). If the probe confirms the finding, one source correction runs (1 of 2 left), then the reviews run on the new seal.
- **D3 0.11 integration: 2a.** Into `integ/phase0-b` once the gates are green, in the same window. Not master.
- **D4 0.10 correction 3: a.** Approved for integration. Basis: the recommended option; it closes the tie-break gap.
- **D5 0.10 GPU gates B0 to B4: a.** Yes, in a fresh window of about 25 minutes, with nothing else running. Basis: the list stated this option, and "approve all" names it. The GPU run waits until every Node-side step of 0.11 has finished.
- **D6 coastline pictures (C2): a.** Accepted as evidence; C2 closes. Recorded as the owner's judgment.
- **D7 oracle: b.** The owner exports two or three reference PNGs himself. No Wine window is opened. The request is sent in the reply.
- **D8 0.12 screenshot step: a.** The step uses the hidden harness (`GEORAMA_E2E=1`, readback PNG). `npm run app` is removed from the 0.12 step.
- **D9 dead `loadConfig`: a.** Removed under a card, with its test edits in the same card. Lands on `integ/phase0-b` after its gates. Basis: the recommended option.

## Standing conditions for every window

- Node for every gate: `/usr/bin/node` v22.23.3, with `PATH=/usr/bin:$PATH` set in each command. Recorded because PATH resolves v26.7.0 by default.
- Hidden harness only; `npm run app` never runs.
- GPU and Electron runs are serial and never overlap Node workers or reviews.
- Source corrections: 0.11 has 1 of 2 used; each new correction needs its own yes.
- Not touched: `<redacted>`. The owner did not approve it.

## Windows

- **W11 (0.11, D2 and D3):** opened 00:09:23 -03 2026-10-21. Fuse 60 minutes, so it ends 60 minutes after the clock read above. Delegate calls: 3 of 10 used.
- **W10G (0.10 GPU, D5):** opens only after W11's Node-side work has finished. Fuse 40 minutes from its own clock read.

## Still needs the owner

- The PNG export for D7 (request sent in the reply).
- Any Wine window, any new mount, any correction beyond the caps: each comes back as a plain-text question.

## Amendments (clock read 00:12:28 -03, 2026-10-21)

- **Atlas probe run (decision D2, 1a, addendum 2).** The parent probe on an archive of seal 9284672 confirmed the finding: `buildInstances` threw a TypeError for a lookup without a valid `reserved` block, including an empty symbol list. Scratch evidence only. Consequence: source correction 2 (the second and last allowed for 0.11), test first, two files, dispatched 00:12:28 -03. The reviews run on the new seal, not on 9284672.
- **Fuse amended for W11, from 60 to 75 minutes, recorded before the old fuse ran out.** The correction cycle was not in the first estimate (about 50 minutes including it, times 1.5, capped at 90). Window W11 now ends 75 minutes after its opening clock read in this record (00:09 BRT), that is 01:24 BRT. Any step not finished by then is reported, not run.
- **Data volume `<redacted>` (D1 a) is done.** It was remounted read-only, and the kernel confirms `ro`. `<redacted>` untouched.


## Amendments 2 (clock read 00:24:15 -03 2026-10-21)

- **D1 done.** The data volume is mounted read-only (kernel `ro`, observed 00:08 and 00:17).
- **D6 a done.** C2 is closed.
- **D7 b and D8 a done.** Master plan `28875b2`: 0.12 runs through the hidden harness, `npm run app` is removed from that step, and the owner exports the 2 to 3 reference PNGs himself.
- **D9 a: card committed** as `dd2805b` (`docs/plans/2026-10-21-loadconfig-removal.md`). Not dispatched; window W9 opens after W11 and the 0.10 stage.
- **Order after W11** (replaces the order implied by the window list): 0.11 integrated first (D3 2a); then the 0.10 GPU stage on a dry tree cut from that tip; then 0.10 integration; then D9.
- **Open question D10.** The second ext4 volume is mounted read-write. The earlier environment record says unmounted. I did not mount it in this session; it is untouched. Options: unmount it, remount it read-only, or leave it.
- **Corrections by addition.** See the STATE section dated 00:24:15 -03 2026-10-21 for the two claims that were not observed when recorded, and their observed values.


## Amendment (clock read 01:32:15 -03 2026-10-21)

- **D3 2a executed.** Integrated into `integ/phase0-b` as `f56ce3e` (merge of f06dada onto 0b8b64e). Gates green on the tip. Not master. Basis: this record's D3 line.
- **W11 end.** The W11 line above (01:24 BRT) is superseded by the extension to 02:08 BRT in the decision record's addendum at 00:38:08 (commit `2486c9d`), under the delegation recorded there.
- **Open for the owner.** The Minor residual (decision record addendum at 01:32:15 -03 2026-10-21): accept, or close with a fifth correction (cap 4 to 5, budget 10 to 13). GPU B0 to B4 waits for that choice.

- **Correction by addition (01:34:03 -03 2026-10-21).** Option (b) needs a budget of 12 delegate calls (9 used, three more), not 13.


## Window W12 (clock read 01:42:36 -03 2026-10-21): residual closure, option (b)

- **Basis.** "i give all the permissions" and "also do whatever is better". The choice between accepting the residual and closing it is delegated; I chose to close it, because the gap is a pinned gutter in the atlas and a width/height pin in the placeholder record, both measurable and cheap to close.
- **Named cap raise.** Source corrections 4 to 5. Delegate calls 10 to 11 (9 used; two reviews, SPEC and QUALITY, on the new seal). Both raises are named here, as the rule requires.
- **Scope.** Test-only additions to the two card-listed test files. No source line changes. Integration afterwards into integ/phase0-b as a merge, under D3 2a.
- **Fuse.** 60 minutes from this clock read. Stop at the fuse; record the state if not finished.
- **Findings this window (measured, scratch).** Term-deletion and field-swap sweep on f06dada: 61 rows; 58 killed; three survivors. (1) Same-shelf gutter (`st.x += w + pad` dropped pad): the known residual. (2) Placeholder record `rw` and `rh` swapped: a real gap, because every placeholder test uses a square 16x16 reserved block. (3) Tie-break `return a - b` to `return a`: equivalent on V8; differential 4,400 seeded cases (4000 + 400 structured, n up to 2,999), zero output differences. Equivalence is qualified to V8 on Node 22.
- **Not observed.** Equivalence on other engines or sorts.
