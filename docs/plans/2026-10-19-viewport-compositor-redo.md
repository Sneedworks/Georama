# 0.9 narrow redo card: provenance correction of producer A

Branch: task/0.9-viewport (worktree <redacted>/Documents/georama-wt/t0.9-viewport), base 8eb1fea.
Rejected commits 1c7b1ac, 50bc92e and 8eb1fea stay in history as the record. Do not rewrite them.
Source correction 1 of 2 for 0.9. Window fuse 23:45 BRT.

## Why (audit of producer A's trace, 22:17 to 22:20)

- T1 (fitView, oneToOne): the missing-module RED (exit 1) is genuine. The first source body also contained the INPUT and LIMIT guards, and no run ever failed on them. They are not test-first.
- T2 (screenToMap, zoomAt, panBy): the RED run was blocked by the progress guard. The producer then wrote source. There is no RED. This violates the rule: a blocked RED stops the producer, and source is never written to clear the block.
- T3 (classify): the missing-module RED (exit 1) is genuine. The INPUT guards were in the same first source body and were never observed failing.
- Unreachable branches: oneToOne's LIMIT (scale is the constant 1); zoomAt's screenToMap failure branch (the earlier checks make it impossible).
- Guards with no test: zoomAt and panBy invalid view; the y checks of screenToMap and zoomAt; isLand threshold above 255.

## Scope (exactly four files, all already on the branch)

- src/renderer/render/view/viewport.ts
- src/renderer/render/compose/classify.ts
- tests/unit/render-view-viewport.test.ts
- tests/unit/render-compose-classify.test.ts

Forbidden: any other path; GPU or Electron runs; `npm run app`; `npm run e2e`, `npm run e2e:gl`, `cleanup.mjs`; git config; the existing assertions (do not change them).

## Rules

1. Only five test additions are allowed (listed in step R3). Existing assertions stay.
2. Each RED is one direct command. Record its exit code and the first failing test. A RED run blocked by a progress guard stops you: report the block text and the command, and write no source.
3. Each guard and each function gets its own observed RED before it exists.
4. Commit only at GREEN points, one commit per class, with `git -c user.name=Ichi -c user.email=ichi@localhost commit`. Stage explicit paths only.
5. If vitest reports a whole suite as failed to load, that is not per-test evidence. Then add the missing name back as no-guard math first, and re-run to observe the per-test RED.

## Steps

- R1 viewport.ts: delete screenToMap, zoomAt, panBy, viewValid and their uses. In fitView and oneToOne keep only the scale and translation math: remove dimsValid, scaleWithinLimits and oneToOne's LIMIT branch. Keep constants and types. Run `node_modules/.bin/vitest run tests/unit/render-view-viewport.test.ts`. Expect exit 1 with the T2 tests and the fit and oneToOne INPUT and LIMIT tests failing. Do not commit.
- R2 classify.ts: keep only math. thresholdFromWaterLevel returns Math.round(w * 255). isLand returns alpha >= threshold. Remove the INPUT guards. Run `node_modules/.bin/vitest run tests/unit/render-compose-classify.test.ts`. Expect exit 1, with the six INPUT tests failing. Do not commit.
- R3 add exactly five tests, with the guards still absent: (a) zoomAt with a view whose scale is 0 returns INPUT; (b) panBy with a view whose scale is 0 returns INPUT; (c) screenToMap with sy = Infinity returns INPUT; (d) zoomAt with sy = Infinity returns INPUT; (e) isLand(100, 256) returns INPUT. Run both viewport and classify files. Expect exit 1, with the new tests failing. Do not commit.
- G1 screenToMap math only (no guard). Run the viewport file. The valid screenToMap tests turn GREEN; the INPUT tests stay RED. Commit "fix(0.9): screenToMap math (genuine RED observed)".
- G2 add the viewValid guard to screenToMap (scale finite and above 0, tx and ty finite). The zero-scale test turns GREEN. Commit.
- G3 add the finite-point guard to screenToMap for both x and y. The NaN x and Infinity y tests turn GREEN. Commit.
- G4 zoomAt math only, with the map point computed inline (no screenToMap call and no failure branch). The keeps-fixed test turns GREEN; INPUT and LIMIT stay RED. Commit.
- G5 add zoomAt guards one class at a time, each commit confirming its own tests: factor finite and above 0; sx and sy finite (including the new Infinity-y test); view valid (new test); LIMIT on the new scale (MAX and MIN tests).
- G6 panBy math only, then the delta guard (dx and dy finite), then the view guard (new zero-scale test). Commit each.
- G7 fitView: re-add dimsValid to fitView and oneToOne, then the scale LIMIT to fitView. oneToOne gets no LIMIT branch (it is unreachable). Commit each.
- G8 classify: re-add the threshold guard (w finite and 0 to 1), then the byte guard on isLand's two arguments (alpha 256, alpha 155.5, threshold -1, and the new threshold 256 test). Commit each.
- F1 confirm no dead branch remains: `grep -n "if (" viewport.ts` should show only real guards, with no `!m.ok` branch and no oneToOne LIMIT.
- F2 gates, each a direct command, exit recorded: vitest viewport default; vitest viewport `--pool=threads --no-file-parallelism`; vitest classify default; vitest classify threads; `npm run typecheck`; `npm test`; `npm run build`. Expected test counts: viewport 27, classify 12.
- F3 evidence: write <redacted>/.hermes/cache/scratch/evidence/T09-viewport/DELIVERY-REDO.json and NOTES-REDO.md. Do not modify DELIVERY.json or NOTES.md.
- F4 final state: `git status --porcelain` is empty. `git diff --name-status 75b1a95 HEAD` lists exactly the four files as added.

## Output

DELIVERY-REDO.json keys: commit (full SHA of HEAD), parent (75b1a95 full SHA), files {added, modified}, tdd (array of {step, command, exit_code, first_failing_test, newly_green}), gates (name mapped to {exit_code, summary}), deviations (string or none), unseen (array). The final answer contains the same JSON object. NOTES-REDO.md lists every command with exit code and summary, in order.
