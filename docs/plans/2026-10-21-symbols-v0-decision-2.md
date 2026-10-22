# <redacted> symbols v0 decision record 2: seal 656acc3, measured survivors, the correction cap

Written 01:04:54 -03 2026-10-21 (from `date`). 0.11 is not complete. This record states the open items, their evidence and the cost of each option. It approves nothing.

## Facts on the record

- **Seal.** 656acc3: one commit over 0b8b64e, tree 64e763cd, six card paths, author Ichi. It amends 422ae49 (reviewed) by three witness tests in `tests/unit/core-symbols-instances.test.ts` (nine inserted lines, no deletions).
- **Reviews on 422ae49** (batch deleg_c4439fa9, read from the saved reports). SPEC: PASS, no findings. QUALITY: GAPS, one Major, three Minor, two Suggestion. The reviews on 656acc3 have not run.
- **Parent gates on 656acc3** (Node v22.23.3, PATH=/usr/bin first): A2 78/78 (default pool); A3 78/78 (threads, no-file-parallelism); A4 typecheck exit 0; A5 npm test 2309 passed, 7 skipped; A6 core-boundary 235 passed; A7 build exit 0. Tree clean afterwards.
- **Measurement on 656acc3 (M1, full table, this session).** Operator table 379 rows; disjunct table 125 rows, including four hand-written rows for the one mixed-operator `return` the generator skipped (instances.ts line 37). 504 generated: 440 killed by a failing assertion, 0 run-crashed, 0 setup, 4 timeouts, 60 survivors. Controls passed in every part. Three reviewer mutants were merged: all three survived. Survivors total 63.
- **Timeouts.** Four loop-step mutants (`i += 1` to `i += 0`, instances.ts lines 96, 133, 157, 175) hang. Re-run at 240 s: still TIMEOUT. Reported as hangs, not kills and not survivors.
- **Survivor classes (63).** GAP: 4 (below). Equivalent or unreachable: 59, in the classes below.
- **P1 (real-data scratch proof, sealed modules, aggregate invariants only).** Passed on the real map: every symbol yields a sprite record, every draw slot corresponds to its symbol, and records are finite. P1 is non-vacuous: under the record-placement mutant it reports mismatches on nearly every draw slot. Counts stay in scratch; they are map-derived and not committed.
- **Source-correction counter: 3 of 2.** The witness change in 656acc3 is a test-only change made after a mutation finding. The card (M1) says a test-only gap closure counts as a source correction, and the budget rule covers any change after a review or a mutation finding. The record 2486c9d and its STATE addition said the counter stayed at 2 of 2. That was wrong. This record corrects it by addition.
- **Budget.** Delegate calls 6 of 10: audit, producer, correction 1, correction 2, SPEC review, QUALITY review. Cap changes: none.

## Survivor classes

| Class | Rows | Status and evidence |
|---|---|---|
| GAP-major: draw-order record written at input index (reviewer I-M1, instances.ts line 180) | 1 | Gap. Survives 656acc3 (37 tests pass). No unit test catches it. The real-data P1 check does: non-vacuity observed (under this mutant it reports mismatches on nearly every draw slot; the unmutated run reports none; counts stay in scratch). |
| GAP-minor: fresh-page placement at x = padding, and continuation without padding (reviewer A-M13 atlas.ts line 140, A-M14 line 137) | 2 | Gap. Both survive 656acc3. Card A3.3 specifies x = 0 and x += w + padding. |
| GAP-differential: function-valued atlas accepted (instances.ts line 89, the typeof operand) | 1 | Gap. Differential: original returns INPUT, mutant returns ok. The G11 test does not include a function. |
| EQ-engine: comparator zero or sign branches (atlas.ts lines 99, 104) and index tie-break `a + b` (instances.ts line 163) | 13 | Equivalent on Node 22 (V8). V8 sorts test only the sign of the comparator. Differential: 0 output differences over 300 atlas cases (up to 400 items) and 200 instance cases (up to 300 items). Qualified: not shown for other engines. |
| EQ-guard: redundant null and undefined guards on later reads of the same parent, and the atlas, zIndex and placement guards (instances.ts lines 42 to 117) | 26 | Equivalent for data-property inputs. Differ only for accessor properties that return a different value on each read. See Decision 2. |
| EQ-state: unread initial page fields, and an initial x overwritten at line 137 (atlas.ts lines 43, 47, 108, 136) | 6 | Equivalent by reading the code. |
| EQ-zero-record: zero written to a slot that is already zero, or to the next record's slot 0 (instances.ts lines 211, 234, 235, 248) | 6 | Equivalent. The record array is zero-initialised, and the next record rewrites slot 0. |
| EQ-unreachable: default colour channels, overwritten on every path (instances.ts lines 213 to 215) | 5 | Equivalent. All four kinds are assigned explicitly. |
| EQ-local: typeof and finite reasoning in the isFiniteNumber return (instances.ts line 37) | 3 | Equivalent. The return is true only for finite numbers. |
| HANG: loop step zero (four rows) | 4 | Not a kill. Hangs at 240 s. |

## Decision 1: how to close the four gaps, with the counter at 3 of 2

- **1a. Approve a cap of 4 for 0.11, by naming it.** One test-only correction closes GAP-major, both GAP-minor rows and GAP-differential. It may also include the one-line message fix for non-array items (reviewer finding F4: the message names the wrong rule). Then SPEC and QUALITY reviews on the new seal, then the scratch P1 re-run, a dry merge and the gates. Integration needs its own plain yes. Cost: 3 delegate calls (producer 1, reviews 2), taking the total to 9 of 10. Counter 4 of 4. Leaves open: Decision 2, and the engine-qualified equivalences.
- **1b. Do not raise the cap.** Keep 656acc3 as it is. Run the two final reviews on 656acc3 (2 calls, total 8 of 10). Integrate only with an explicit yes that accepts GAP-major and the other gaps as known. Cost: 2 calls. Leaves open: the draw-order placement is untested at unit level, and the fresh-page and function-atlas cases are untested. Counter 3 of 2 stands as an over-cap change.
- **1c. Hold.** No calls. 0.11 stays unintegrated. Counter 3 of 2 until you decide. Cost: none. Leaves open: all four gaps.

Recommendation: 1a. The fixes are small test-only additions. GAP-major is a silent-corruption risk on the draw path, and one correction costs less than accepting that risk.

## Decision 2: accessor inputs to the symbol reader

- **2a. Pin accessors with tests.** An accessor on a symbol field that returns a valid value once and null later must give INPUT naming the field. Added to the same correction as 1a. Cost: about six test cases in the same producer call. Leaves open: nothing.
- **2b. Declare the contract plain-data and document it.** The only producer of SymbolInput is the map reader, whose objects come from parsed data, so accessor properties cannot reach buildInstances. No tests. Cost: none. Leaves open: the residual is documented, not pinned.

Recommendation: 2b, because the only producer builds plain objects. Choose 2a if you want the stricter contract.

## Decision 3: sequencing (not a choice)

The 0.10 GPU stage (W10G, D5 a) and 0.11 stage B are not started. They follow the close of W11 and the outcome of Decision 1. Electron and GPU runs stay serial, with the reviews finished first.

## Window and budget

- W11: opened 00:09:23 BRT; extended to 02:08 BRT under the user's delegation ("do whatever is best"). Clock reads this session came from `date`: 00:39:56, 00:46:44, 00:47:37, 00:50:50, 00:55:27, 01:03:35, and 01:04:54 -03 2026-10-21 for this record.
- Delegate calls: 6 of 10. Source corrections: 3 of 2 (see the counter fact above).

## Not observed

- Verdicts of any review on 656acc3 (none run).
- A dry merge of 656acc3 (not run).
- Any GPU or Electron run for 0.11.
- Whether an accessor-based symbol can reach the reader in practice (argued from the code path, not run).
- Engine behaviour outside Node 22 (not run).

## Corrections by addition

- The addendum in commit 2486c9d states that the witness tests were an a2 strength closure and that the counter stayed at 2 of 2. That was wrong. The card's M1 section and the budget rule count a test-only gap closure after a mutation finding as a source correction. The counter is 3 of 2.


## Addendum 01:11:02 -03 2026-10-21: dry merge of 656acc3 green; draft correction probed in scratch; nothing dispatched

- **Dry merge.** 656acc3 merged onto 0b8b64e in a throwaway worktree (dry-11b, merge commit aaac712). Merged tree equals the seal tree (64e763cd). Node v22.23.3. Each gate run separately, exit 0: typecheck; full `npm test` 2309 passed, 7 skipped (51 files passed, 5 skipped); the three symbol test files under `--pool=threads --no-file-parallelism` 78 passed; core boundary 235 passed; `npm run build` exit 0. Not integrated.
- **Draft correction for option 1a, probed in scratch (not committed, not dispatched, not approved).** Four draft tests and one message change, checked against the sealed code. On the unmutated code the three gap tests pass and the message test fails, as expected. Under each named mutant, its named test fails: record at input index (draw-order test); fresh placement at padding (fresh-page test); fresh continuation without padding (fresh-page test); function-valued atlas accepted (function-atlas test). With the message change the atlas file passes 27 of 27. Probe brief: scratch only (`evidence/T11-symbols/correction1-brief.md`).
- **Not run, on purpose.** The two reviews of 656acc3. Under option 1a they would spend budget that the correction needs: 6 calls now, plus 2 reviews, plus the correction and its 2 reviews, is 11 of 10.
- **Still needed.** A named reply to Decision 1 (1a, 1b or 1c) and Decision 2 (2a or 2b). Integration stays unapproved until the reviews pass and the owner says yes.


## Addendum 01:14:55 -03 2026-10-21: the reply "do your recommendations" selects 1a and 2b

- **Reply (verbatim).** "do your recommendations, you dont need to ask me".
- **1a selected, as written in the recommendation, which names the cap.** Cap 4 for 0.11 (a fourth source correction). Stages named by 1a: one test-only correction, plus the one-line message change for non-array items (F4); SPEC and QUALITY reviews on the new seal; the scratch P1 re-run; a dry merge and the gates. Integration is not among them. It stays pending its own plain yes.
- **2b selected.** The symbol contract is plain data (SymbolInput records come from the map reader, which builds plain objects). Accessor properties are outside the contract. No tests are added. The redundant guards stay classified as equivalent on the plain-data contract.
- **Window.** W11 ends 02:08 BRT. The stages above must finish inside it. If the fuse expires, stop and record the state.
- **Budget.** Delegate calls 6 of 10 before the correction. The correction and its two reviews take the total to 9 of 10. Source corrections: 4 of 4 after this correction.


## Addendum 01:19:48 -03 2026-10-21: correction under 1a verified (f06dada); reviews dispatched

- **Producer (deleg_7d90441e, sa-0-9130e878).** Commit f2678ad on task/0.11-sym, tree e7f3c6b3. Three files: src/core/symbols/atlas.ts (message split, one line), tests/unit/core-symbols-atlas.test.ts (+16 lines), tests/unit/core-symbols-instances.test.ts (+24 lines). No deletions in the test files. RED: the atlas file fails exactly the items-message test (exit 1). GREEN: 82 passed under both pools.
- **Counter.** The producer card calls this "correction 3". By the counter it is the fourth source correction, since the witness change of 656acc3 was the third. Cap 4, named in option 1a, covers it. Counter 4 of 4.
- **Squash.** Per the card's one-commit rule, f2678ad was reset to 0b8b64e and recommitted as f06dada: one commit over 0b8b64e, tree equal to the producer's tree, author Ichi. Privacy scan of the full diff and the message: 0 hits.
- **Parent gates on f06dada** (and identical on f2678ad): typecheck 0; npm test 2313 passed, 7 skipped; three files 82 under the default pool and under threads; core boundary 235; build 0.
- **Mutants on the producer's tests** (copies of f2678ad): record written at input index, the draw-order test fails; fresh placement at padding, the fresh-page test fails; fresh continuation without padding, the fresh-page test fails; function-valued atlas accepted, the function-atlas test fails; old items message, the items-message test fails. Unmutated: 82 pass.
- **P1 on the f06dada tree** (scratch): all invariants true; slot mismatches 0; read failures 0. Counts stay in scratch.
- **Dry merge** of f06dada onto 0b8b64e (throwaway dry-11c, merge commit 766a0c1): merged tree equals the seal tree; typecheck 0; npm test 2313 passed, 7 skipped; threads 82; boundary 235; build 0.
- **Reviewers.** rv-11s1 (SPEC) and rv-11q1 (QUALITY) detached at f06dada, clean; small gate 82 passed in each. Batch deleg_f99299c2 dispatched: SPEC sa-0-4436d13e, QUALITY sa-1-2da45824. Verdicts not observed yet.
- **Budget.** Delegate calls 9 of 10.
- **Not done.** Integration into integ/phase0-b needs its own plain yes after the reviews PASS; the reply did not approve it. The 0.10 GPU stage (W10G), D9, 0.12 and p0 to p3 are unchanged. <redacted> is untouched. The oracle PNGs are yours to export.
- **Window.** W11 ends 02:08 BRT. Verifying reviewer reports after that is evidence reconciliation only. No merge or integration after 02:08 without a fresh window.


## Addendum 01:32:15 -03 2026-10-21: reviews of f06dada, residual, integration

- **Reviews of f06dada (batch deleg_f99299c2).** Reports read from disk: `evidence/T11-symbols/review-c3/spec/report.json` and `review-c3/quality/report.json`.
  - SPEC (sa-0-4436d13e): PASS. 25 requirement rows, all PASS. Test first: exit 1, three "Cannot find module" failures. Regression: typecheck 0; npm test 2313 passed, 7 skipped; build 0; the three files 82 under the default pool and under threads, each run twice. Oracle: 2000 compared, 0 differences. Packing: 300 samples, 0 overlaps, 0 out of bounds. Determinism: identical over 50 shuffles. Boundary 0; privacy 0 hits; tree clean.
  - QUALITY (sa-1-2da45824): PASS. 24 single-token mutants: 23 killed, 1 survived. Findings: one Minor (the survivor below) and one Suggestion (`isFiniteNumber`, `instances.ts` lines 36 to 38: a redundant string disjunct; behaviour correct). Gap mutants M1 to M5 of this record are all killed by named tests.
- **Parent verification of the Minor** (scratch: `evidence/T11-symbols/correction3-verify/padfamily/padfamily.json`). On the f06dada tree the base passes 82 tests and places B at (17,0), A at (43,0), C at (17,11). Mutant L121 (same-shelf branch, `st.x += w + pad` to `st.x += w`) survives all 82 tests and moves C to (63,0). The other padding-term mutants (L110 shelfStart, L124 new-shelf y, L132 new-shelf x, L140 fresh continuation) are each killed by one failing test.
- **Severity.** Minor under the card's rule: Critical and Major block, Minor does not. No test pins the same-shelf gutter. The SPEC review, which checks the code against the card, passed; what is missing is the pin.
- **Disclosure about my mutation table.** The 504-row table on 656acc3 has no term-deletion row on any line and no row at all on line 124 (the new-shelf y expression inside a `const` ternary). It has operator and number rows on lines 110, 121, 132 and 140. The reviewer's card asked for a drop-the-padding-term mutant; that is the one that survived. Not observed: a full term-deletion sweep over every assignment line of the three files. The process lesson goes into the ultra-mode test-strength reference.
- **Correction by addition.** Commit `1a824e2` (decision 1a and 2b) and addendum `2be998c` said integration needed its own plain yes. That was wrong. D3 2a in the approvals record (`fb79932`, line 11) approved integration into `integ/phase0-b` once the gates are green, in W11. Integration was run under that approval.
- **Window.** The W11 line in the approvals record (01:24 BRT) predates the extension to 02:08 BRT recorded in this record's addendum at 00:38:08 (commit `2486c9d`), under the owner's delegation. The 02:08 end governs. The integration at 01:29 to 01:30 is inside it.
- **Integration (D3 2a).** Merge commit `f56ce3e` on `integ/phase0-b` (parents `0b8b64e` and `f06dada`), author Ichi, tree equal to the seal tree `e7f3c6b3`. Gates on the tip, Node v22.23.3: typecheck 0; npm test 2313 passed, 7 skipped; three files under threads 82; boundary 235; build 0. Status clean. Not promoted to master.
- **For the owner to decide: the Minor residual.** (a) Accept it as recorded here and close it when the symbols module next changes. (b) Close it now: one test-only correction with the reviewer's exact test (B 25x10, A 20x10, C 1x5, maxSide 64, padding 1: C at (17,11)), then SPEC and QUALITY on the new seal. (b) needs a named cap raise from 4 to 5 and a budget raise from 10 to 13 delegate calls. Recommendation: (a). The budget is nearly spent and the residual is a test pin, not a placement error the SPEC review found.
- **GPU stage.** D5 (0.10 GPU) waits until every Node-side step of 0.11 has finished. Option (b) is one such step. Not run. When W10G opens, settle its fuse length: D5 says about 25 minutes; the W10G line says 40 minutes.
- **Budget.** Delegate calls 9 of 10. Source corrections 4 of 4. No delegate calls in this addendum.
- **Not observed.** Any GPU or Electron run for 0.11; stage B; a full term-deletion sweep; the effect of the residual on real map data (P1 checks slot correspondence and finiteness, not placement).

- **Correction by addition (01:34:03 -03 2026-10-21): the budget for option (b).** A fifth correction needs 12 delegate calls, not 13: 9 used, plus one producer, one SPEC review and one QUALITY review. The 13 in the 01:30 addendum, the approvals amendment and STATE was my arithmetic error.


## Addendum 01:46:32 -03 2026-10-21: residual closure at 07ea5ec (W12); reviews deleg_72afbb4a dispatched

- **Choice.** Option (b) of the residual: closed, not accepted. Basis: "i give all the permissions" and "also do whatever is better". Cap raised 4 to 5 and budget 10 to 11, both named in the approvals record (W12).
- **Measured class.** Term-deletion and field-swap table on f06dada: 61 rows, 58 killed, 3 survived. The survivors and their classes: (1) the same-shelf gutter (`st.x += w + pad`, pad dropped): a gap, closed here; (2) placeholder `rw` and `rh` swapped: a gap, because every placeholder test used a square reserved block; closed here; (3) tie-break `return a - b` changed to `return a`: equivalent on V8, qualified (below).
- **Tie-break equivalence (qualified).** Differential on V8 (Node 22.23.3), two harnesses: 4,000 seeded cases with n up to 601 (<redacted> distinct outputs) and 400 structured cases with n from 507 to 2,999 (<redacted> distinct outputs, with long tie runs and index 0 inside tie groups). Zero output differences in 4,400 cases. Not proven: other engines, other sort algorithms. The sign changes only for pairs with index 0 as one argument; in V8's binary insertion, index 0 is never the first argument.
- **Seal S4 = 07ea5ec.** One commit over 0b8b64e (tree fb1fa7f8). Source bytes identical to f06dada. Two add-only test blocks: the gutter (two tests, expected values hand-derived: C at (17, 11); P, Q, R, S at x 18, 25, 32 and S at (18, 7)); the placeholder uv from a non-square reserved block (hand-derived record). Test-file numstat +66, -0.
- **Gates on S4 (Node 22.23.3).** Typecheck 0; npm test 2316 passed, 7 skipped; three symbol files 85 under threads; boundary 235; build 0.
- **Sweep on S4.** Same 61 rows: 60 killed, 1 survived (the tie-break mutant, classed above). Controls 0 and 0; sources restored.
- **Dry merge (dry-11d, onto integ tip f56ce3e).** The integration side already holds the f06dada bytes for the two test files, so the merge is an add/add conflict. Verified the integration side equals f06dada, and the seal extends it; resolved to the seal's side. Merge tree equals S4 tree. Gates green. Diff against the tip: the two test files only.
- **Reviews.** Batch deleg_72afbb4a dispatched: SPEC (sa-0-9e010649) and QUALITY (sa-1-40686efd, which re-runs the 61-row table itself). Verdicts not observed at this checkpoint. Integration waits for both PASS.
- **Budget.** Delegate calls 9 used before the batch; the batch takes 11 of 11 (named raise from 10). Source corrections 5 of 5 (named raise from 4).
- **Not observed.** Reviews of S4; integration of S4; any GPU run for 0.10 or 0.11 in this window.


## Clock read 01:50:50 -03 2026-10-21: 0.11 closed at integ 2165a18

- **Reviews of 07ea5ec (deleg_72afbb4a), read from disk by the parent.** SPEC: PASS, 25 requirement rows, no findings, pinned SHA matches, test-first exit 1 (three Cannot find module), pool runs 85 x 2 exit 0, npm test 2316 passed, 7 skipped, privacy 0. QUALITY: PASS, no findings; 63 mutant rows: 62 killed, 1 survived (the tie-break row, equivalent on V8 by the differential in the decision record). The QUALITY reviewer re-ran the 61-row sweep itself: 60 killed, 1 survived.
- **Integration (D3 2a).** integ/phase0-b at 2165a18: merge of 07ea5ec. Parents f56ce3e and 07ea5ec. Add/add in the two test files, resolved to the seal side after checking that the integration side equals the f06dada bytes. Tree equals the seal tree. Diff against the previous tip: the two test files, +66, -0. Source byte-identical to f06dada, so P1 (passed on f06dada) still holds; not re-run.
- **Gates on the tip (Node 22.23.3).** Typecheck 0; npm test 2316 passed, 7 skipped; threads 85; boundary 235; build 0. Not promoted to master.
- **Budget.** Delegate calls 11 of 11 (named raise). Source corrections 5 of 5 (named raise).
- **0.11 status.** Stage A integrated with the residual closed. Stage B (GPU, card 0.11b) is not written.


## Addendum 18:39:49 -03 2026-10-21: accessor contract written (option 2b; records only)

- **Contract.** The symbol reader's inputs (`SymbolInput` and `AtlasLookup`) are plain data. Each field is an own, readable data property with no accessor and no prototype-provided value. The only production producer builds plain objects from the parsed map.
- **Consequence.** Guards that exist only for accessor properties (a getter that returns a different value on each read) are outside the contract. The sealed code keeps them. On inputs that meet the contract they do not change any output, which is why the survivors classed as equivalent in this record stay equivalent.
- **Not claimed.** Behaviour for callers that pass accessors or proxies. No test pins it.
- **Scope.** Records only. Source and tests unchanged at `07ea5ec`.
