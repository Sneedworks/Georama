# Git history redaction (2026-10-21)

Status: done and verified. Approved by the owner ("yes redact for privacy").

## What was redacted
- Private committed text: external volume label, folder labels, private path segments, and map-derived counts and statistics. Each match of the privacy scanner's 14 rules was replaced with `<redacted>`. The rules themselves stay in scratch and are not committed.
- No map files, map names, or map-derived values are in this repo. Nothing on the external volume was written.

## Method
- Tool: `git filter-branch` (git-filter-repo is not installed; nothing was installed). An index filter rewrote blobs; a commit filter redacted messages and recorded each old-to-new commit pair.
- Dry run on a mirror clone first; the real run was identical (same commit map and branch tips).

## Verified results
- 329 commits rewritten (every commit reachable from a branch); 51 branches re-pointed.
- 1,662 blob entries changed. All are under `docs/`. No file outside `docs/` changed.
- 1 commit message changed. Author, committer, dates and parent order are unchanged.
- The privacy scanner over every object in the repo: 0 hits (commits, trees, blobs, paths).
- `git fsck --full`: no problems. `.git` went from 25 MB to 5.7 MB.

## What this changes for pins (read this)
- Every commit SHA from the first redacted commit onward changed. This includes the sealed reviewed commits.
- The source of each seal is byte-identical to before, because only `docs/` changed. Reviewed content is unchanged, but the pinned SHAs now point at the old commits.
- Old SHAs in reviews, budgets and STATE entries still resolve through `2026-10-21-history-redaction-sha-map.tsv` (old SHA, new SHA).
- Whether the existing verdicts cover the new SHAs is a judgment call: they reviewed identical source. Re-review is not required by this record, but the owner can require it.

## Key pins (old to new)
| Old | New | What | Status |
|---|---|---|---|
| `e2e6e12` | `ac0cc54` | corpus-correction record (master, before) | mapped |
| `08e6d74` | `72f3846` | D9 closure record (master) | mapped |
| `2799ec7` | `76ab628` | integration tip with D9 | mapped |
| `c06f95c` | `cf1995c` | D9 seal | mapped |
| `4ab70b7` | `391e84d` | integration tip after 0.10 | mapped |
| `bf113c9` | `84698ce` | 0.10 seal | mapped |
| `aba5ffe` | `65f2ac3` | 0.10 closure record | mapped |
| `2165a18` | `4691fa7` | integration tip after 0.11 | mapped |
| `07ea5ec` | `3416638` | 0.11 seal | mapped |
| `fae9d0a` | `79edb93` | W9 open record | mapped |
| `b5bb7ad` | `750ee44` | W10G3 approval record | mapped |
| `28875b2` | `dc97ee5` | 0.12 amendment | mapped |
| `dd2805b` | `7966e25` | D9 card | mapped |
| `bc501d4` | `3fa9ba7` | 0.6 closure | mapped |

## Worktrees
- 99 worktrees re-pointed to their new SHAs and verified clean.
- 27 worktrees whose HEAD no branch reached were removed. They were disposable dry-merge and reviewer snapshots. Their old commits remain only in the pre-redaction backup, and each is listed in the map file with `-`.

## Backup (outside the repo, not committed)
- Location: `~/.hermes/backups/georama-redaction-20261021/` (bundle of all refs, full `.git` tarball, ref and worktree snapshots from before the run). Keep it until the owner confirms the new history.

## Not done
- Earlier commits on other branches were rewritten the same way; nothing was promoted to master.
- The integration branch was not promoted. The 0.12 card still waits on the owner's reference images.
