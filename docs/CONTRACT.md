# Contributor contract

Version 1, 2026-10-26. This contract applies to every change merged into `main`. It states what a change must do, how it is checked, and who decides what. [FEATURE-PLANS.md](FEATURE-PLANS.md) says what to build.

## 1. What the project is, and where it stands

Ge'orama is a Linux-native map editor for fantasy maps. Its goals are to open and display Wonderdraft `.wonderdraft_map` files faithfully, to edit maps, and to save them in a form Wonderdraft can read.

The public tree contains the format reader and writer, the asset reader, the renderer foundations, and the Electron shell. Editing tools and the full Wonderdraft-matching renderer are planned, not finished.

A statement about a feature must match the code in `main`. A plan is not a feature.

## 2. Who decides

- **The owner** is the maintainer. The owner merges pull requests, decides scope, and decides anything that changes a trust boundary, a dependency, the platform, or a file format.
- **Contributors** propose changes by pull request. A contributor does not merge.
- A decision the owner has not made is open. Work that depends on an open decision waits, or is proposed as an issue first.

## 3. Scope

- **Platform:** Linux, on Wayland. Non-Linux work (Windows, macOS) is held until the owner decides. Such pull requests may stay open for discussion. They are not merged, and nothing runs them automatically, because the repository has no CI.
- **Stack:** TypeScript (strict) on Electron 44 (pinned), Vite, Vitest, Preact, and hand-written WebGL2. Node 22 runs the gates.
- **Formats:** reading and writing `.wonderdraft_map` format version 15 follows [FORMAT-wonderdraft-map-v15.md](FORMAT-wonderdraft-map-v15.md). A new file format needs an issue first.
- **Dependencies:** no new runtime dependency without an issue that says why. See section 7.

## 4. Non-negotiable rules

A change that breaks one of these is not merged.

1. **No private data.** No map files; no map names, sizes or dimensions; no texture or pack names; no local paths; no credentials; no statistics computed from a private map collection. Fixtures are synthetic. Write `<redacted>` where a real name would appear.
2. **No Wonderdraft assets.** The repository does not bundle, copy or require Wonderdraft art, textures, shaders, scripts or packs. The app reads the user's own data at runtime. Tests that need real data skip without it.
3. **Clean room.** Do not decompile Wonderdraft's compiled scripts or shaders, and do not copy code from them. Do not derive how theme values map to rendered output from Wonderdraft's internals. Calibrate against reference exports that the owner supplies, and say in the pull request which reference a value came from.
4. **Portable core.** `src/core` and `src/shared` import no Node, Electron or DOM APIs and declare no ambient environment types. `npm test` enforces this with positive and negative fixtures.
5. **Electron boundary.** The window keeps `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false` and `webviewTag: false`. Permission requests are denied, `window.open` is denied, navigation is restricted to the app, and the custom protocol serves only the renderer build under its content-security policy. Changing any of these needs a recorded decision in the pull request, a test that fails without the change, and an entry under "Changing the boundary" in [SECURITY.md](SECURITY.md).
6. **Hidden windows only in tests.** Every end-to-end harness runs with `GEORAMA_E2E=1` and never shows a window. Do not remove that flag to take a screenshot. `npm run app` is for manual checks.
7. **Node 22.** The gate scripts refuse any other major. If you ran a gate under another version, say so in the pull request.
8. **Notices and history.** Keep copyright and licence notices. Do not force-push `main`. A correction is a new commit that names the commit it corrects.

## 5. How a change moves to a merge

1. **Choose the work.** Take an item from [FEATURE-PLANS.md](FEATURE-PLANS.md), or report a bug. For an item marked *owner decision*, wait for the decision. For a change larger than a few hundred lines, or any change inside the Electron boundary, open an issue first so the approach can be agreed.
2. **Branch.** Branch from current `main`. Name the branch for the task: `fix/<topic>`, `feat/<topic>`, `test/<topic>`, `docs/<topic>` or `perf/<topic>`.
3. **Write the failing test first.** Add the test that describes the behaviour, run it, and confirm that it fails for the reason its name gives. Record the failing output's summary line. A test that passes before the change proves nothing.
4. **Make it pass.** Write the smallest change that passes. Keep unrelated edits out of the branch; open a second pull request for them.
5. **Run the gates** that section 6 requires for your change, under Node 22.
6. **Open the pull request** with the template. Paste each gate's summary line. List what you did not run, or could not observe, under "Not observed". For a visible change, attach a screenshot or say it was not captured. For a change inside the Electron boundary, say what crosses the boundary and which test checks it.
7. **Review.** The owner reads the whole diff. Answer review comments with new commits. Once review has started, do not force-push the branch.
8. **Merge.** Only the owner merges. Before merging, the owner checks the merged result, not only the branch, and merges with the head commit pinned to its full 40-character SHA.
9. **After the merge.** If you find a defect in merged work, open a new pull request that names the commit it corrects.

## 6. Gates

| Gate | Command | Required when | What it proves |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | every change | strict types in the core, renderer and node projects |
| Unit tests | `npm test` | every change | unit behaviour and the portable-core rules |
| Build | `npm run build` | every change | the main, preload and renderer bundles build |
| Hidden smoke | `npm run e2e` | `electron/`, `src/shared/`, IPC, navigation, preload, protocol, content-security policy | the built app starts hardened, with its window hidden |
| Boundary | `node tests/e2e/boundary.mjs`, after `npm run build` | the same as the smoke test | the built app passes the boundary probes (network and navigation) with its window hidden |
| Cleanup | `node tests/e2e/cleanup.mjs` | after any hidden run | the launcher's process group is gone after each signal |
| GPU | `npm run e2e:gl` | render code, shaders, GPU paths | the GPU cases pass; needs a WebGL2 GPU, and name the GPU and driver in the pull request |
| Compositor | `npm run e2e:compose` | the compositor | the compositor cases pass |
| Corpus | `npm run corpus` | map-reading code | maps the user supplies parse and re-encode; set `GEORAMA_MAP_DIR`, otherwise the tests skip |
| Benchmark | `scripts/benchmark-core.ts`, method in [BENCHMARKS.md](BENCHMARKS.md) | any performance claim | the measured times, with the method and the machine |

- A gate you did not run goes under "Not observed". "Not run" is an honest answer. An unverified claim is not.
- A change that cannot reach the GPU or the window does not need those gates. Say so in the pull request.
- Shader changes are not yet checked offline before a GPU run. Until the offline check exists (item A6 in [FEATURE-PLANS.md](FEATURE-PLANS.md)), say in the pull request that the shader was not compiled offline.

## 7. Electron and dependencies

- Electron is pinned in `package.json` and `package-lock.json`. Electron supports its latest three stable major lines, and only the latest patch of each line receives fixes, so a patch update that fixes an advisory is a priority. A new major line is a planned item with its own checklist (item A2).
- A pull request that changes `package.json` or the lockfile says why, names any advisory it fixes, and changes nothing else. Regenerate the lockfile with npm. Edit it by hand only for a documented security pin.
- Do not add a runtime dependency to `src/core`. Do not add a dependency that runs code at install time without an issue that justifies it.

## 8. Security reports

- Do not open a public issue or pull request that contains exploit details for a problem that is not fixed.
- Private vulnerability reporting is not enabled on this repository at the time of this version. Until it is, open a public issue that says only that you have a security report and asks for a private channel, without the details.
- Read [SECURITY.md](SECURITY.md) first. It states what the shell guarantees, and which layer provides each guarantee.

## 9. What a reviewer checks

- The test fails without the change, and fails for the reason its name gives.
- The change does what the pull request says, and nothing more.
- Every trust-boundary change names what crosses the boundary and has a probe that fails without the limit.
- Performance claims have numbers, a method and a machine.
- Error paths are tested, not only the success path.
- The gates were run on the merged result.
- The "Not observed" list is honest.

## 10. Names and corrections

- In this documentation the maintainer is called "the owner". Commit authors keep their own names.
- A correction to merged work is a new commit that names the commit it corrects. History is not rewritten.

## 11. Licence

Contributions are accepted under the MIT licence in [LICENSE](../LICENSE). Copyright is held by the Georama authors. Keep the existing notices in the files you touch.
