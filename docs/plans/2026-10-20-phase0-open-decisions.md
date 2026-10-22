# Phase 0 open decisions, 2026-10-20: what is blocked and what each answer does

Written 23:57:46 -03 (from `date`). Nothing in this record is approved. The owner answers each item in plain text, one letter or number per item. An answer covers only the item it names (ultra-mode, standing consent).

## Facts observed in this session

- **Data volume is read-write.** `<redacted>` is mounted `rw` (ntfs3) in the kernel mount table at 23:57:46 -03. STATE recorded it as read-only, and the mount approval says read-only. No file on it was modified in the last 24 hours (read-only scan at 23:57:46 -03). The record was wrong. The cause is unknown.
- **`<redacted>` is mounted read-write (ext4).** I have no record of mounting it and have not touched it. I will not touch it unless you say.
- **Node changed on PATH.** `node -v` gives v26.7.0 from `~/.hermes/tools` at 23:57:46 -03. `/usr/bin/node` and `/usr/sbin/node` are v22.23.3. The reviewer check at 21:46 gave v22.23.3 in the same worktrees. The gate logs do not record which Node ran each gate.
- **The 0.12 card contradicts a standing rule.** The master plan's 0.12 screenshot step is `npm run app -- <map>`. The standing rule says never `npm run app`, because it opens a window on the screen. The card's own rule is to stop on a contradiction, so 0.12 stops.
- **The oracle is approved in principle only.** Master plan section 7, item 3: Wine reference exports approved, run before 0.12. Card 0.12: wine automation runs with your OK for the window; otherwise you export 2 to 3 reference PNGs.
- **Held stages are unchanged.** 0.11 stage A: `docs/plans/2026-10-20-symbols-v0-decision.md`. 0.10: `docs/plans/2026-10-20-distance-field-coast-decision.md`.

## Decisions

**D1. Data volume `<redacted>`** (approved read-only; now read-write)
- a. Remount read-only: unmount, then `udisksctl mount -b <redacted> -o ro`, then check with `findmnt` that it shows `ro`. Cost: about a minute. **Recommended**: it matches the approval. Leaves open: P1 needs the volume later, which is a new mount approval.
- b. Unmount only. Cost: a minute. Leaves open: P1 and any real-data run wait for a new mount approval.
- c. Keep read-write. Cost: none now. Leaves open: the record and the approval disagree.

**D2. 0.11 window** (stage A: reviews of seal 9284672, dry merge onto 0b8b64e, P1 real-data proof in scratch, and the atlas probe)
- 1a. Window for the SPEC and QUALITY reviews, the dry merge and P1. Cost: 2 delegate calls (7 left after); about 30 minutes (estimate, not measured). **Recommended.** Leaves open: integration (D3), stage B, and one correction if a review finds a Critical or Major item (1 of 2 left).
- 1b. Window for the two reviews only. Cost: 2 delegate calls; about 15 minutes (estimate). Leaves open: dry merge and P1.
- 1c. Hold. Cost: none. Leaves open: stage A is unreviewed and unmerged.
- 1d. Atlas probe only, no window: a scratch check on the seal. Cost: no delegate calls; a few minutes (estimate). Leaves open: everything else in stage A.

**D3. 0.11 integration into `integ/phase0-b`**
- 2a. Same window as 1a, once the gates are green. **Recommended** if the reviews pass.
- 2b. After 0.10 is integrated.
- 2c. Hold.

**D4. 0.10 correction 3** (seal 7067e49, test only; kept provisionally)
- a. Approve for integration. **Recommended**: it closes a real tie-break gap.
- b. Drop before integration; the tie-break gap stays open.
- c. Hold. The card (section 6c) needs an explicit approval. "Whatever you find best" does not count.

**D5. 0.10 GPU gates B0 to B4** (about 25 minutes, nothing else running)
- a. Yes, in a fresh window.
- b. No, hold.
- "Whatever you find best" was not a yes.

**D6. 0.10 coastline pictures (C2, scratch)**
- a. Accept as evidence and close C2.
- b. Redo with another crop.
- c. Hold.

**D7. Oracle: Wine reference exports** (run before 0.12)
- a. Approve the Wine window: you get a warning first, the window is visible while it runs, and I drive it.
- b. You export 2 to 3 reference PNGs yourself (the plan's fallback). **Recommended**: fewer visible windows, and the automation is untested.
- c. Hold.

**D8. 0.12 screenshot step** (`npm run app` contradicts the standing rule)
- a. Rewrite the step to the hidden harness: `GEORAMA_E2E=1`, a readback PNG, no window. **Recommended.**
- b. Accept one visible window for that capture.
- c. Hold 0.12.

**D9. Dead `loadConfig`** (0.6 follow-up; defined at `electron/assets/config.ts:117`; no production caller; three test files call or spy on it and one lists its name)
- a. Remove it under a card, with the test edits in the same card. Cost: about 3 delegate calls (estimate). **Recommended**: an unbounded, path-based read left in place can be called later.
- b. Keep it, documented as dead code. Cost: none.
- c. Hold.

## Notes that need no answer

- No file on `<redacted>` was modified in the last 24 hours.
- Default for any window: pin `/usr/bin/node` (v22.23.3, the version the environment notes list) and record it, unless you say otherwise.

## Reply format

One line, for example: `D1 a, D2 1d, D3 2c, D4 a, D5 b, D6 c, D7 b, D8 a, D9 b`. Each answer covers only the item it names.

## Not observed

- Which Node ran the gates on each seal.
- Whether any write reached `<redacted>` before the last 24 hours.
- The gates on seal 9284672 under a recorded Node version.
- 0.12 and p0 to p3: not started; blocked on D7 and D8.
