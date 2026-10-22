# 2026-10-22: approvals, corrected plan reading, next card (02:59:14 -03 2026-10-22)

Records decisions taken after the first-light closure (93134cc) and its corrections (eb52471, e53f94c). Corrections are added as new commits; earlier records are not rewritten.

## Approvals (The owner, 2026-10-22)
1. **First-light picture.** "the picture looked good". His judgement, recorded as given. The reviewers did not certify a match.
2. **Second ext4 volume.** "do your recommendation": remount read-only. Done at 02:58 -03. The unmount and the read-only mount both succeeded, and the kernel reports `ro`. Before the remount, the only scheduled job whose text names a removable volume was `Backup-Health-Monitor`. It is paused and disabled (last run 2026-10-11, failed). No enabled job refers to this volume. Nothing was written to it.
3. **Eight extra maps.** "when we finish". They stay out of the collection and unread until then. The corpus count in the Phase 0 exit waits on the same decision.

## Plan reading (corrected)
- The Phase 0 exit (master plan, sections 3 and 4) requires "symbols with real sprites". Card 0.11's GPU stage (0.11b) was never written, so Phase 0 is not complete. My earlier reading that improvement A comes next was wrong. Improvements A to H are Phase 3, after the parity renderer (Phase 1) and the editor core (Phase 2).
- The Phase 0 exit also says "corpus <redacted>" and "open any of the <redacted> maps". The approved folder holds <redacted> maps, and its corpus gate passes with <redacted> of <redacted> identical. The figure of 57 is open, and it depends on the eight-maps decision.
- Phase 1 (water and ground textures, coast effects, labels) and 0.11b both need PNG pixels. The core has PNG header checks only.

## Next
- **Card 0.11p PNG pixel decoder.** Node only, no GPU, three new files. Taken under "do what you think is the best". It is an internal workspace step and changes no existing file. Card: `docs/plans/2026-10-22-0.11p-png-pixels-card.md`.
- **Card 0.11b GPU symbol draw with real sprites.** Needs the owner's plain yes, as the <redacted> decision record requires (Stage B). Not given. Not started.
