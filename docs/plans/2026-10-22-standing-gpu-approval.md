# Standing GPU approval (01:16:34 -03 2026-10-22)

Recorded verbatim from the owner's reply:

> Standing GPU yes for Ge'orama: hidden runs (e2e:gl, e2e, cleanup) on the dry and integration trees of any card I've approved, one 40-minute window per card. Stop on any FAIL, timeout, or visible window. Maps stay on this machine.

## Scope as recorded
- Runs: `e2e:gl`, `e2e`, `cleanup`. Hidden only (`GEORAMA_E2E=1`). No `npm run app`.
- Trees: the dry tree and the integration tree of any approved card.
- Window: one 40-minute window per card. The fuse starts from a clock read taken before the first run.
- Stops: any FAIL, any timeout, or any visible window stops the GPU section. No retry loop.
- Maps stay on this machine: no map data in any delegate or model context, and no vision tool on map renders. Pictures go to the owner by local path only.
- Revocation: The owner says "GPU stop".

## Reading recorded for card 0.12 (flagged)
The owner's "sounds good" approved the first-light scope. His "do whatever you feel like and get this done" let the assistant pick option 1 for the ungated stages. The option-1 card therefore counts as an approved card for this standing yes. The owner can object before its window opens.
