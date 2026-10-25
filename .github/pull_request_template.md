## What and why

<!-- One concern per pull request. Link the issue, if there is one. -->

## Gates

<!-- Paste the summary line of each command you ran. Delete the lines for commands you did not run. -->

- `npm run typecheck`:
- `npm test`:
- `npm run build`:
- `npm run e2e` (if `electron/`, `src/shared/`, IPC or navigation changed):
- `npm run e2e:gl` (if render code or shaders changed; name the GPU and driver):
- `npm run e2e:compose` (if the compositor changed):

## Not observed

<!-- Everything you did not run or could not observe, and why. Write "none" only if that is true. -->

## Screenshots

<!-- For visible changes, attach a screenshot. Otherwise write "not applicable" or "not captured". -->

## Checklist

- [ ] No private data: no map files, map names or sizes, texture or pack names, local paths, credentials, or statistics from a private collection.
- [ ] No Wonderdraft assets, and no decompiled Wonderdraft scripts or shaders.
- [ ] Existing notices in the touched files are kept.
- [ ] `src/core` and `src/shared` still import no Node, Electron or DOM APIs.
- [ ] Each behaviour change has a test that fails without it.
