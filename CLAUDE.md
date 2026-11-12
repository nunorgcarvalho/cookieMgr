# cookieMgr — notes for Claude

Developer docs: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (build, tests, project structure, releasing).

## Versions are written after the merge — never in a pull request

Several pull requests are open at once; the version is set by the **Release** workflow when each one merges, so
none of them clash over it.

- **Do** add a changelog fragment: `changes/<feature>.md` (`sim/changes/<feature>.md` for the simulator) with
  front matter `bump: major | minor | patch` and the CHANGELOG bullets as the body. See
  [changes/README.md](changes/README.md).
- **Don't** change the version (`package.json`, `package-lock.json`, `SIM_VERSION` in `sim/sim.mjs`),
  `CHANGELOG.md`, `sim/CHANGELOG.md`, or commit `dist/` (build it to test; `git checkout origin/main -- dist`
  before committing).
- **Name things after the feature, not a version:** PR titles, `tests/e2e/<feature>.test.mjs`, screenshots in
  `docs/pr/<feature>/`, comments in code and CSS.
- Bringing a branch up to date with `main` is a plain merge/rebase: nothing to re-bump or rename.
- Don't push tags: the workflow tags `vX.Y.Z` / `sim-vX.Y.Z` and publishes the GitHub release.

CI enforces this (`node scripts/changes.mjs check origin/main`); `npm run changes` previews the next release.

## Testing: what you touched locally, everything in CI

CI runs the full suite on every push (four shards, ~1.5 min). Locally, run `npm run lint` and
`npm test -- contract <feature words>` (e.g. `npm test -- contract garden`), not the whole suite, before each push.
Run everything (`npm test`) only for changes to `src/core/`, `tests/harness/` or `build.mjs`, or to chase a CI
failure; don't re-run it after merging `main`. Keep new tests quick: `waitFor` instead of long sleeps, and close
the menu around loops that fire hundreds of events. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Simulator analyses: the computed golden cookie model by default

For golden cookie income in `sim/` (curves, garden scores, any new experiment), use the computed model
(`sim/models/goldenExpected.mjs`: `expectedAt`, `expectedIncome`): seconds, a few tenths of a percent. Play the
game (`sim/models/goldenIncome.mjs`, `--play`) only to check a result, or for what the chain leaves out.
