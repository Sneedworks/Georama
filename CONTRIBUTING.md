# Contributing to Ge'orama

Ge'orama is a Linux-native map editor for fantasy maps, with Wonderdraft compatibility as a goal. It is in early development. The code is TypeScript (strict) on Electron 44, with Vite, Vitest, Preact and hand-written WebGL2. It is MIT-licensed.

Start with these documents:

- [docs/CONTRACT.md](docs/CONTRACT.md): the rules a change must meet, and the steps from an idea to a merged pull request. This is the reference for contributors.
- [docs/FEATURE-PLANS.md](docs/FEATURE-PLANS.md): the planned work, with the files, the tests and the done criteria for each item.
- [docs/DEV.md](docs/DEV.md): setup, commands, layout and code conventions.
- [docs/SECURITY.md](docs/SECURITY.md): the threat model and the boundary checks.
- [README.md](README.md): what the project is, and its status.

If a document and the code disagree, the code is right, and the disagreement is worth reporting.

## Ground rules in brief

- **No private data.** Never commit map files, map names or sizes, texture or pack names, local paths, credentials, or statistics from a private map collection. Write `<redacted>` where a name would otherwise appear.
- **No Wonderdraft assets, code or scripts.** Work from the documented format in [docs/FORMAT-wonderdraft-map-v15.md](docs/FORMAT-wonderdraft-map-v15.md), from observed behaviour, and from your own code. Do not decompile Wonderdraft.
- **Keep the core portable.** `src/core` and `src/shared` import no Node, Electron or DOM APIs. `npm test` enforces this.
- **Keep the Electron boundary.** Do not weaken the window, navigation, permission, protocol or content-security settings. See [docs/SECURITY.md](docs/SECURITY.md).
- **Keep notices.** Keep the copyright and licence notices in the files they cover.

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
| `npm test` | Unit tests, including the portable-core rules |
| `npm run build` | Typecheck, then the main and preload bundles, then the renderer bundle |

Also run the ones that match your change. The rule for each kind of change is in [docs/CONTRACT.md section 6](docs/CONTRACT.md#6-gates).

| Command | When | Notes |
| --- | --- | --- |
| `npm run e2e` | `electron/`, `src/shared/`, IPC, navigation | Real Electron smoke test. The window stays hidden. |
| `node tests/e2e/boundary.mjs` | the same, after `npm run build` | Runs the boundary probes against the built app. The window stays hidden. |
| `npm run e2e:gl` | render code, shaders, GPU paths | Needs a WebGL2 GPU. The window stays hidden. |
| `npm run e2e:compose` | the compositor | The window stays hidden. |
| `node tests/e2e/cleanup.mjs` | after the hidden runs | Cleanup check. |
| `npm run corpus` | code that reads maps | Reads folders of maps you own. Set `GEORAMA_MAP_DIR` to them. Without it the corpus tests skip. |

`npm run app` opens a visible window. Use it for manual checks only.

## Pull requests

Follow the steps in [docs/CONTRACT.md section 5](docs/CONTRACT.md#5-how-a-change-moves-to-a-merge). In short: branch from `main`, keep one concern per pull request, write a failing test first, fill in the pull request template with the gate summary lines and a "Not observed" list, and add commits rather than force-pushing once review has started.

The owner reviews and merges pull requests. Platform scope and trust-boundary changes are decided by the owner first.

## License

Contributions are accepted under the MIT license in [LICENSE](LICENSE). Copyright is held by the Georama authors.
