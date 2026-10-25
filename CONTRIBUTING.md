# Contributing to Ge'orama

Ge'orama is a Linux-native map editor for fantasy maps, with Wonderdraft compatibility as a goal. It is in early development: Phase 0 (foundation and first light) is in progress. The code is TypeScript (strict) on Electron 44, with Vite, Vitest, Preact and hand-written WebGL2.

Read these first:

- [README.md](README.md): what the project is, and its status.
- [docs/DEV.md](docs/DEV.md): setup, gates, layout and code conventions. The gate table below summarises it; DEV.md is the reference.
- [docs/SECURITY.md](docs/SECURITY.md): the threat model and the boundary checks.

If this note and the code disagree, the code is right and the disagreement is worth reporting.

## Ground rules

- **No private data.** Never commit map files, map names or sizes, texture or pack names, local paths, credentials, or statistics taken from a private map collection. Use `<redacted>` where a name would otherwise appear.
- **No Wonderdraft assets.** The repository does not bundle, copy or require Wonderdraft art, textures, shaders or scripts. The app reads user-owned data at runtime, and tests that need real data skip without it.
- **Clean room.** Do not decompile Wonderdraft's compiled scripts or shaders, and do not copy code from them. Work from the documented format in [docs/FORMAT-wonderdraft-map-v15.md](docs/FORMAT-wonderdraft-map-v15.md), from observed behaviour, and from your own code.
- **Keep notices.** Keep the existing copyright and licence notices in the files they cover, for example `src/core/formats/gcpf.ts`.
- **Keep the core portable.** `src/core` and `src/shared` must not import Node, Electron or DOM APIs. `npm test` enforces this; see the code conventions in DEV.md.
- **Keep the repository clean.** Do not commit scratch files, build output (`dist/`, `dist-electron/`) or local configuration.

## Set up

Use Node 22. `.nvmrc` pins the version, and the gate scripts refuse any other major version (`scripts/require-node-22.mjs`).

```sh
npm ci
```

## Gates

The repository has no CI, so the gates are your responsibility. Run these before you open a pull request:

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Strict TypeScript for the core, renderer and node projects |
| `npm test` | Unit tests, including the portable-core gates |
| `npm run build` | Typecheck, then the main and preload bundles, then the renderer bundle |

Also run the ones that match your change:

| Command | When | Notes |
| --- | --- | --- |
| `npm run e2e` | `electron/`, `src/shared/`, IPC, navigation | Real Electron smoke test. The window stays hidden. |
| `npm run e2e:gl` | render code, shaders, GPU paths | Needs a WebGL2 GPU. The window stays hidden. |
| `npm run e2e:compose` | the compositor | The window stays hidden. |
| `node tests/e2e/cleanup.mjs` | after the hidden runs | Cleanup check. |
| `npm run corpus` | code that reads maps | Reads folders of maps you own. Set `GEORAMA_MAP_DIR` to them. Without it the corpus tests skip. |

`npm run app` opens a visible window. Use it for manual checks only.

## Pull requests

1. Branch from `main`. Name the branch for the task, for example `fix/<topic>` or `task/<topic>`.
2. Keep one concern per pull request. A behaviour change needs a test that fails without the change, and the test must fail for the reason its name gives.
3. Write commit subjects as `type(scope): summary`, for example `docs(contributing): explain the pull request template`.
4. Fill in the pull request template. List the gates you ran with their summary lines, and list what you did not run under "Not observed". Attach screenshots for visible changes, or say they were not captured.
5. Resolve conflicts with `main` before review starts. Say in the pull request what you changed.
6. Once review has started, add commits instead of force-pushing the branch.

## Recommendations

- Prefer a small, reviewable diff.
- Say what you did not observe. "Not run" is an honest answer. An unverified claim is not.
- If a change crosses a trust boundary (IPC, file access, the custom protocol, navigation), say what crosses it and how it is checked. See [docs/SECURITY.md](docs/SECURITY.md).
- If the spec and the code disagree, say so in the pull request instead of working around it.
- Test the failure paths as well as the happy path.

## Maintainers

- Read the whole diff before running anything from a pull request. Run untrusted code only in a throwaway worktree, with an empty environment (`env -i PATH=/usr/bin:/bin HOME=$HOME`).
- Check a merge before you call it clean: run the gates on the merged result, not only on the branch.
- Merge with the head commit pinned to its full 40-character SHA: `gh pr merge <N> --merge --match-head-commit <sha>`. Short SHAs are refused.
- Do not force-push `main`. A correction is a new commit that names the record it corrects.
- Every merge, close or comment on a public pull request is a public action. Keep a record of it.

## License

Contributions are accepted under the MIT license in [LICENSE](LICENSE). Copyright is held by the Georama authors.
