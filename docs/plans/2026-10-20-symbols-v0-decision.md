# 0.11 stage A decision record: open items, evidence and the cost of each option

Written 23:05:23 -03, 2026-10-20 (from `date`). 0.11 stage A is not complete. This record states each open item, its evidence and the cost of each option. It approves nothing.

## Facts on the record

- Seal: 92846721867cdbe0a8df487886d44497c14ed3f8, one commit over 0b8b64e, author Ichi. Its tree is ef9d2544dfe721c4a1e716ac4e7a1bf4a44bb9c4. Six paths added: three source files and three test files. Change since the last reviewed seal: no review has run on any seal yet. The producer's commit 046f530 had no correction tests. Correction 1 added 25 test-only tests in 3c0f89f. A squash to one commit (card A8) gives the seal, which has the same tree as 3c0f89f.
- Reviews on the seal: none. The batch is not dispatched. The correction child's completion notice reports an implementation, not a review.
- Parent gates on the seal (logs in scratch): A1 RED on an archive of the seal with the three sources removed: exit 1, three suites fail with Cannot find module. A2: 68 of 68, default pool, exit 0. A3: 68 of 68, threads, exit 0. A4: typecheck exit 0. A5: npm test 2299 passed, 7 skipped, exit 0; the baseline at 0b8b64e was 2231 passed, 7 skipped. A6: core-boundary 235 passed, exit 0. A7: build exit 0. A8: worktree clean; one commit over the base; the diff lists six paths.
- Measurement on the seal: a mutation table of 431 generated mutants (370 operator, 61 disjunct). 374 killed by assertion. 53 survivors, each classed equivalent on this evidence: zero output differences in 6,000 seeded trials per mutant, and a separate sort check over 1,680 inputs for the comparator rows. Four hangs (a loop step set to zero), reported as hangs, not kills. Controls pass. Equivalence on this evidence is not a proof.
- Dry merge: not run; there is no dry tree yet. Integration tip: 0b8b64e on integ/phase0-b, clean, not promoted to master. Neither 0.10 nor 0.11 is integrated.
- Budget: delegate calls 3 of 10; correction counter 1 of 2; cap changes: none.
- Node: the kernel, a login shell and both reviewer worktrees resolve Node v26.7.0. The environment notes list 22.23.x, and the producer reported 22.23.3. The review card pins no version. Unreconciled.
- Privacy: the full diff from 0b8b64e to the seal has zero hits; the commit message has zero hits; controls pass 14 of 14.

## Decision 1: Open a window for the stage A close-out? (card 0.11 sections 6 and 7)

- 1a. Open a window for SPEC and QUALITY reviews on 92846721867c, then the dry merge onto 0b8b64e, then the P1 real-data scratch proof. Cost: 2 delegate calls (7 remain); about 30 minutes, an estimate and not measured (the last two-review batch took 231 seconds; the rest is gates and P1). Leaves open: integration (Decision 2); stage B; one source correction if a review finds a Critical or Major item (1 of 2 remains); the Node question before dispatch.
- 1b. Open a window for the two reviews only, then stop. Cost: 2 delegate calls; about 15 minutes, an estimate. Leaves open: the dry merge and P1, so card acceptance A9 and the merge gate stay unmet until a later window.
- 1c. Hold. Cost: none. Leaves open: stage A is unreviewed and unmerged; integration is blocked; any change to the branch needs a new seal and new reviews.

Evidence: the seal and its gates above; review card rev 2 at dba7dc4, whose filled copy passes the placeholder regex; reviewer worktrees rv-11s1 and rv-11q1 detached at the seal, clean, with node_modules linked.

Recommendation: 1a. The seal is green, the reviewers are prepared, and the rest fits in one window.

## Decision 2: When is stage A integrated? (card 0.11 section 0, item 1)

- 2a. Integrate in the same window as 1a, once the reviews are clean, the dry merge is green and P1 is done. Cost: about 5 minutes of gates (estimate); no delegate calls. Leaves open: the order with 0.10. The path lists are disjoint, so neither order conflicts; the later one needs its dry merge re-run on the new tip.
- 2b. Integrate after 0.10 is integrated. Cost: none now; the seal waits on the branch. Leaves open: 0.11 integration waits on 0.10's decisions.
- 2c. Hold. Cost: none. Leaves open: stage A stays out of the integration tip, so the card's acceptance cannot close.

Evidence: the path lists of 0.10 and 0.11 have zero overlap (checked in scratch; no path list is committed here).

## Window and budget

- Fuse: opened 21:14:01 -03, the first clock reading after the continuation (the continuation's own time was not read). It ends 22:44:01 -03, the opening plus 90 minutes. It expired. Close-out ran after expiry and is recorded in STATE at 125586e. No dispatch or merge since 22:22:25 -03.

## Not observed

- The two reviews; the dry merge; the P1 proof; the per-slice assertion RED (producer-reported only); the Node version the reviewers would use; any GPU or Electron run for 0.11; stage B.

## Addendum (clock read 23:07:41 -03, 2026-10-20): a finding from the source, not probed

- Finding: `buildInstances` reads `atlas.reserved` without validating it (`src/core/symbols/instances.ts`, lines 159 to 161, as read from the seal in this session). If `reserved` is null or undefined, the read of `.x` throws a TypeError, even for an empty symbol list. The review card's SPEC checklist (section 2, item 2) says a foreign exception escaping any export is always a finding.
- Not in the gates: no mutant in the campaign targets those lines, and no brief test passes a lookup without `reserved`. The correction's G11 covers null, undefined and 5 as the whole atlas.
- Effect on the options: the SPEC review may raise this. If it does, the fix is one source correction (1 of 2 remaining) plus a test, then a new seal and fresh reviews: up to 5 more delegate calls (2 reviews now, 1 correction, 2 re-reviews), 8 of 10 used at most. Option 1b has the same effect.
- Not observed: a probe. The claim rests on the source lines and JavaScript semantics. A one-line probe in scratch, run inside a window, would confirm or refute it before any change.

## Addendum 2 (clock read 23:09:39 -03, 2026-10-20): option 1a starts with the probe

- Option 1a now starts with the probe of the atlas finding in the addendum above. The probe is a short parent run in scratch, as the earlier probes were: it calls `buildInstances([], {})` and `buildInstances([], { reserved: null })` on the seal. Expected by reading the code: a TypeError. A normal result would refute the finding. It uses no delegate calls and takes a few minutes (estimate).
- If the probe confirms the finding, the window runs one source correction (1 of 2 remaining), with a test, then the SPEC and QUALITY reviews on the new seal. The cost in the addendum applies (up to 5 more delegate calls).
- If the probe refutes it, the window continues as 1a planned, with no correction.
- Options 1b and 1c are unchanged.

## Addendum 3 (clock read 23:11:34 -03, 2026-10-20): a narrower option, 1d

- 1d. Approve the atlas probe alone, with no window. The probe runs as a parent-side scratch script on a git archive copy of the seal, so no tracked file changes. It calls buildInstances with an empty symbol list and with a lookup that has no reserved field, and records the result as an addendum. Cost: no delegate calls; a few minutes (estimate). Leaves open: any correction, the reviews, the dry merge and P1, which all still need a window. If the probe confirms the finding, the correction waits for 1a or 1b.
- 1a, 1b and 1c are unchanged. 1d approves the probe and nothing else.


## Addendum 00:24:15 -03 2026-10-21: answers recorded (`docs/plans/2026-10-21-phase0-approvals.md`)

- **D2 1a: window W11** for the SPEC and QUALITY reviews, the dry merge onto `0b8b64e` and the P1 proof (map 6, scratch only). The atlas probe ran first, on an archive of `9284672` (scratch log `~/.hermes/cache/scratch/evidence/T11-symbols/atlas-probe/probe-run.log`). It confirmed the finding: `buildInstances` throws a TypeError when `reserved` is missing or null, even for an empty symbol list. The fix is source correction 2 (not yet verified).
- **Source correction 2 dispatched**, test first, two files; brief in scratch (`~/.hermes/cache/scratch/evidence/T11-symbols/correction2/brief.md`). Producer `deleg_3f966b40` started 00:12:28 BRT; its manifest reads `completed` 00:13:50 BRT. Its output is not verified. It is the second and last source correction the budget allows. Reviews and gates run only on the new seal.
- **D3 2a: integration** into `integ/phase0-b`, after the gates on the new seal are green, in the same window. Not master.
- **Window W11 fuse amended from 60 to 75 minutes**, by the assistant's decision under "do whatever you find the best", recorded before the old fuse expired. W11 opened at 00:09:23 BRT and ends at 01:24 BRT.
- **Node for every W11 gate:** `/usr/bin/node` v22.23.3, with `PATH=/usr/bin:$PATH` in each command.


## Addendum 00:31:43 -03 2026-10-21: correction 2 verified; test-strength gap measured; reviews dispatched

- **Seal 422ae49** (correction 2; one commit over 0b8b64e; tree 75acc90c; two files changed against 9284672). The parent verified on disk: branch clean; one commit above the seal; author Ichi; no local identity. Gates under /usr/bin/node v22.23.3: A2 75/75 (default pool); A3 75/75 (threads); A4 typecheck exit 0; A5 npm test 2306 passed, 7 skipped; A6 boundary 235 passed; A7 build exit 0.
- **RED replay (supplemental).** Old source (9284672) with the new test file: exit 1, six failures (G-R1a to G-R1e and G-R2); G-R3 passes. This matches the producer's RED.
- **Test-strength check of the new guard (parent, scratch only).** Ten mutants of `isValidReserved` and its call site: seven were killed by failing tests; three survived with exit 0. Dropping the `y` check, the `width` check or the `height` check each survives. The correction 2 tests cover a missing `page`, null, a number and a NaN `x`, but nothing pins `y`, `width` or `height`. The survivors are not equivalent: each changes the result for a reserved block that lacks one of those fields.
- **Witness probe (scratch, not committed).** Three test-only additions, G-R1f (no `y`), G-R1g (no `width`) and G-R1h (no `height`), each expecting INPUT: the file passes 37 of 37 on the current source, and each new test fails under exactly its own mutant. A third source correction would be test-only; the cap of two for 0.11 is used, so it needs a yes.
- **Dry merge onto 0b8b64e** (throwaway worktree `dry-11a`, merge commit d2ac88e, tree 75acc90c): typecheck exit 0; npm test 2306 passed, 7 skipped; the three files under threads 75 passed; build exit 0; tree clean.
- **Reviews dispatched on 422ae49** (batch deleg_c4439fa9; SPEC and QUALITY; reviewer worktrees rv-11s1 and rv-11q1 re-pointed to 422ae49). If a third correction is approved, both reviews run again on the final seal.
- **Not done.** The P1 map-6 proof (it runs on the final seal). Integration into integ/phase0-b (held until the reviews pass, the gap is decided, and P1 is met).


## Addendum 00:38:08 -03 2026-10-21: seal S2 (656acc3), a2 witness closure, window extended

- **Delegation.** The user's message "do whatever is best, you dont need to ask me. and do yourself" delegates the open items that no hard gate covers. It does not raise the source-correction cap, and it does not replace a plain yes where one is required.
- **The three witness tests are a2 strength closure, not an implementer correction.** G-R1f (no `y`), G-R1g (no `width`) and G-R1h (no `height`) were written by the parent under ultra-mode step a2, before the final reviews, in the card-listed test file. Each passes on the current source and fails under exactly its own mutant (measured in scratch). The source-correction counter stays at 2 of 2.
- **New seal S2 = 656acc3** (one commit over 0b8b64e; tree 64e763cd; six card paths; author Ichi). It amends the single commit 422ae49, the previous seal. The change is test-only: nine inserted lines, three `it` blocks. The reviews of 422ae49 (batch deleg_c4439fa9) are parallel reviews of a frozen seal. ultra-mode requires both final reviews on the strengthened seal before promotion, so they run again on S2.
- **Plan on S2, in this order:** (1) gates under /usr/bin/node v22.23.3 (A2 to A7); (2) final SPEC and QUALITY reviews on S2, in new evidence directories; (3) dry merge onto 0b8b64e in a fresh throwaway tree, with gates; (4) P1 real-data scratch proof on map 6; (5) integration into integ/phase0-b (D3 2a), with gates on the actual tip.
- **Window.** W11 is extended under the delegation above, with a 90-minute fuse from the clock read of this record: it ends 02:08 BRT. It covers steps 1 to 5 for 0.11 only. It does not cover the 0.10 GPU stage (W10G), D9, the oracle exports, or the second ext4 volume (<redacted>, untouched).
- **Not observed yet.** The results of batch deleg_c4439fa9 on 422ae49; the reviews of S2; P1; integration; a full re-measure of the M1 table on instances.ts after correction 2 (the earlier table is for 9284672; only the targeted check on the guard was run).
