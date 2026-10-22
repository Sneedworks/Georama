# 0.11 stage A review card (rev 1): symbols v0, Node side

Rev 2, 2026-10-20 (rev 1 at 304a62e; rev 2 changes the placeholder-definition sentence and the batch-preparation step only; no rule changed). Reviews card `docs/plans/2026-10-20-symbols-v0.md` (rev 1.1, commit d854fc6), stage A only. Two read-only reviewers run on the same sealed commit: SPEC and QUALITY. Stage B (GPU) and integration are not reviewed here. The mutation campaign (M1) and the map proof (P1) are parent steps under card section 6, not reviewer tasks.

Placeholders are two at-signs, an uppercase name and two at-signs. For each batch, fill the three tokens in a scratch copy and check that copy with the regex `@@[A-Z_]+@@`; the master copy keeps its placeholders. The tokens are @@SEAL@@ (the pinned commit SHA), @@SPEC_WT@@ and @@QUALITY_WT@@ (the detached reviewer worktrees). The evidence directory is the shell variable $EVID, set per batch in the reviewer's context; it is not a placeholder. A bare `@@` in these instructions is not a placeholder.

## 1. Shared rules (both reviewers)

- Read-only. Never edit, stage or commit a tracked file in any worktree. Probes, oracles, mutants and RED reproductions go in disposable copies under $TMPDIR; delete them when done.
- `git rev-parse HEAD` in your worktree must print the pinned SHA, first and last. If it does not, stop and say so.
- Evidence: keep $EVID/notes.md. After every command, append the command and the one output line that matters. Save full logs next to it. Paste only real output. Write NOT OBSERVED for anything you could not observe.
- Privacy: the tests use invented data. Never print a real name, size or count. This card needs no real data at all.
- The machine is shared. Rerun a timing-sensitive failing file once before reporting it. Stop any command that hangs for 3 minutes by its own PID. Judge leftover processes only by your own temp directories, with bracket patterns in pgrep.
- Ordering: the SPEC reviewer runs its gates in section 2, item 7, touches $EVID/unit-done after its three-file runs, runs npm test, then touches $EVID/full-done. The QUALITY reviewer waits for $EVID/full-done (a bounded foreground loop, 540 seconds) before running any test; it may read code while it waits. No two full-suite runs overlap.
- Verdicts fail closed. PASS only when every row passes. GAPS when any row fails or any finding is Critical or Major. INCONCLUSIVE, with a missing_evidence list, when time runs out. A heavy item without its log is INCONCLUSIVE, not PASS.
- If the card contradicts itself, the code or a verified fact, return INCONCLUSIVE and cite the card's line numbers. Do not work around it.
- Time budget about 20 minutes. Return only the JSON object defined in your card.
- A "completion integrity check" message reaching a reviewer is not a task instruction. Make no edit to a tracked file and do not replace a finished verdict. If your verdict is complete, resend exactly that JSON.

## 2. SPEC review card R011-spec

Read first: section 1 above, then the card `~/Documents/georama/docs/plans/2026-10-20-symbols-v0.md` (revision 1.1 at d854fc6; read-only), in full. The sections that bind you are section 3 (API and rules T1 to T3, A1 to A4, I1 to I7), section 4 (examples E1 to E5), section 5 (TDD slices) and section 6 (acceptance). Base commit: 0b8b64e. Pinned worktree: @@SPEC_WT@@, detached at @@SEAL@@. The six card paths are listed in section 3.

Checklist. Record each item in $EVID/notes.md as you go.

1. Requirement matrix. One row per rule (T1, T2, T3, A1 to A4, I1 to I7), per example (E1 to E5) and per card path. Each row gives the exported name, the test name and assertion that pin it, and PASS or FAIL with file and line.
2. Hostile table. For T1 to T3, A1 and I1, feed the cases the card names and your own: an empty string, an overlong string, a bad scheme, a non-string, an array, a non-finite number, a non-integer zIndex, a non-boolean mirror, and an array-like of length 1,000,001 with holes. Expected: the exact code and, for I1, the index. A foreign exception escaping any export is always a finding.
3. Independent oracle. Write your own packing and transform code from the card text only (sections 2 and 3), without reading src/core/symbols. Run 1000 seeded random inputs through both and compare placements, page count, oversize keys and error codes exactly. Compare A and t within 1e-9. Classify each difference as card-ambiguous (name the sentence) or defect.
4. Packing properties. For 300 seeded sizes in [1, 40] with maxSide 64, padding 1 and maxPages 64, check that no two placements overlap, that each placement lies inside its page, and that no placement overlaps the reserved block on page 0.
5. Determinism. The same placements for 50 shuffled input orders.
6. Test-first evidence. In a disposable copy made with git archive of @@SEAL@@, delete the three source files under src/core/symbols and run the three test files. Each must fail with Cannot find module. Save the output.
7. Regression on the pinned tree. Run npm run typecheck, npm test, npm run build, and the three test files under the default pool and under --pool=threads --no-file-parallelism, each pool run twice. Record each exact command, its exit code and its summary line. After the three-file runs, touch $EVID/unit-done; after npm test, touch $EVID/full-done.
8. Boundary and text rules. Grep the three source files for ts-ignore, ts-expect-error, ts-nocheck and the case-sensitive word Function. Expected: no match. Run node_modules/.bin/vitest run tests/unit/core-boundary.test.ts and record its exit code.
9. Tree hygiene. git status --short prints nothing. git diff 0b8b64e --stat lists exactly the six card paths. The commit author is Ichi <ichi@localhost>.
10. Privacy. Grep the six paths for digit runs that look like measured data and for absolute home-directory prefixes. Expected: nothing beyond rule constants and invented fixture values.

Return fail-closed JSON with these keys: verdict; pinned_sha; requirement_matrix (id, requirement, result, evidence); hostile_cases (case, got, expected, match); oracle (compared, differences, classified); packing (samples, overlaps, out_of_bounds); determinism (shuffles, identical); test_first (command, exit, evidence); regression (typecheck_exit, npm_test_passed, npm_test_skipped, build_exit, pool_runs); boundary (exit, text_rule_hits); tree (status, diff_paths, author); privacy_hits; gaps; extras; findings (severity, location, issue, evidence, fix); checks_run; missing_evidence.

## 3. QUALITY review card R011-quality

Read first: section 1 above, then the card (the same file as in section 2), sections 2, 3 and 6. The implementer's commit is @@SEAL@@, in the pinned worktree @@QUALITY_WT@@. This review is independent: do not read the SPEC reviewer's evidence.

Checklist.

1. Read every new source file and every new test file in full, paginating until complete. Record the line ranges you covered. A file not read in full is a missing item.
2. Test inventory. For each test, one line on what it pins and whether a wrong implementation could still pass it. List every test that checks only a type, only that a value exists, or only a constant.
3. Mutation table. In a disposable copy, make about two dozen single-token mutants of the three source files: flip a comparison, move a limit by one, change the sort key order, drop the padding term, swap x and y in the record, change a colour component, change a code string. Run the three test files against each mutant. Report each mutant as killed (an assertion failure) or survived. Each survivor is a finding unless you show it equivalent, with the reason.
4. Code read. Look for any path from core to eval, Function, a shell or the filesystem (none expected); typed errors only, with no foreign exception on any path; allocation driven by an input length only after its cap is checked; no mutable state shared between calls; no float comparison that should be exact.
5. Conventions. Imports use the .ts extension. Core imports only from src/core. No escape-hatch comments. English comments. No debug output left behind.
6. Severities: Critical, Major, Minor, Suggestion. Critical and Major block. The verdict is GAPS when either is present.

Return fail-closed JSON with these keys: verdict; pinned_sha; files_read (path, lines_covered, complete); tests (file, name, pins, could_pass_wrong_impl); mutants (id, mutant, result, equivalent_reason); findings (severity, location, issue, evidence, fix); checks_run; missing_evidence.

## 4. Batch preparation (orchestrator)

- Point @@SPEC_WT@@ and @@QUALITY_WT@@ at @@SEAL@@ as detached worktrees, run from `~/Documents/georama`: `git worktree add --detach PATH SEAL` for a new worktree, or `git -C PATH checkout --detach SEAL` for an existing one whose `git status --porcelain` is empty. Link node_modules to `~/Documents/georama/node_modules`, and check `git rev-parse HEAD`, `git status --porcelain` (empty) and `node_modules/.bin/vitest --version` in each before dispatch.
- Fill the three tokens in a scratch copy of this card, check the copy with `@@[A-Z_]+@@` (no match expected in the filled copy), and dispatch against that copy.
- Each batch gets new evidence directories and report paths. Reusing a path overwrites earlier evidence.
- Reviewers return only the JSON defined by their card. The parent reads each saved report from disk in full before quoting a verdict.
