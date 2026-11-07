## What and why

<!-- One concern per pull request. Link the issue, if there is one. -->

## Gates

<!-- Paste the summary line of each command you ran, under Node 22. Delete the lines for commands you did not run. -->

- `npm run typecheck`:
- `npm test`:
- `npm run build`:
- `npm run e2e` (if `electron/`, `src/shared/`, IPC, navigation, preload, protocol or the content-security policy changed):
- `node tests/e2e/boundary.mjs` (after `npm run build`; if the trust boundary changed):
- `npm run e2e:gl` (if render code or shaders changed; name the GPU and driver):
- `npm run e2e:compose` (if the compositor changed):
- `npm run corpus` (if map-reading code changed; say whether `GEORAMA_MAP_DIR` was set):

## Trust boundary and dependencies

<!-- Does this change IPC, file access, the custom protocol, navigation, the preload bridge, permissions or the content-security policy? If yes, say what crosses the boundary and which test checks it. Does it change package.json or the lockfile? If yes, say why, and name any advisory it fixes. -->

## Not observed

<!-- Everything you did not run or could not observe, and why. Write "none" only if that is true. -->

## Screenshots

<!-- For visible changes, attach a screenshot. Otherwise write "not applicable" or "not captured". -->

## Checklist

- [ ] No private data: no map files, map names or sizes, texture or pack names, local paths, credentials, or statistics from a private collection.
- [ ] No Wonderdraft assets, and no decompiled Wonderdraft scripts or shaders.
- [ ] Existing notices in the touched files are kept.
- [ ] `src/core` and `src/shared` still import no Node, Electron or DOM APIs.
- [ ] Each behaviour change has a test that fails without it, and I have shown that it fails.
- [ ] This change adds no non-Linux behaviour, or I have discussed it in an issue first (see the contract, section 3).
