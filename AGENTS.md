# AGENTS.md

## Toolchain

- Local development uses **nub**, provided by the flake dev shell
  (`nix develop`, auto-loaded via `.envrc`/direnv). Use `nub install`,
  `nub run <script>`, `nub <file>.ts`.
- CI uses plain **pnpm**, provisioned by `pnpm/setup@v2`. Do not add
  `nubjs/setup-nub` or `actions/setup-node` to workflows.
- The Node.js pin lives in `devEngines.runtime` in the root `package.json`
  (currently node 26.8.1). It is the single source of truth: nub reads it
  locally, `pnpm/setup` reads it in CI. There is no `.node-version` file.
- The pnpm pin lives in `packageManager` / `devEngines.packageManager`
  (currently pnpm 11.22.0); the lockfile is `pnpm-lock.yaml`.

## Validation

After any change, run the formatter and the linter:

| Command        | Action                                                               |
| -------------- | -------------------------------------------------------------------- |
| `nub run fmt`  | format with oxfmt (`fmt:check` to verify)                            |
| `nub run lint` | lint with oxlint — type-aware, subsumes `tsc --noEmit` (`typeCheck`) |
| `nub run test` | run every package's `node --test` suite (tests live next to `src/`)  |

oxlint is the only typechecker. Do not add `tsc` invocations anywhere;
`typescript` is a devDependency only to support oxlint's type-aware linting.

## Releases

Releases are driven by [Changesets](https://changesets.dev) (`.changeset/`,
`@changesets/cli` v3), automated by the `changesets/action` v2 sub-actions in
`.github/workflows/release.yml`:

- Any releasable change must include a committed `.changeset/*.md` file
  (create one with `nub exec changeset` / `pnpm changeset`). Bump types
  (patch/minor/major) are declared per changeset, not inferred from commit
  messages.
- On pushes to `main`, the release workflow either opens/refreshes the
  "Version Packages" PR (manifests, CHANGELOG.md files, and `pnpm-lock.yaml`
  are updated in the same commit — the lockfile cannot drift) or, when that
  PR is merged, publishes to npm via OIDC trusted publishing (no npm tokens).
- Tags and GitHub releases use the `@lambdot/core@0.2.0` format. (Old
  `core-v0.1.0`-style tags from the release-please era remain as history.)
- All eleven `@lambdot/*` packages are in one `linked` group: they share the
  highest current version and highest bump type, but only packages with
  changesets — or that depend on a bumped package — are versioned and
  published. Everything depends on `@lambdot/core`, so a core change
  cascades to all packages; a leaf change (e.g. `state-memory`) bumps only
  that leaf.
- Inter-package dependencies use `workspace:*` (in both `packages/` and
  `examples/`), so local development always resolves against workspace
  sources instead of stale registry copies. Changesets leaves the specifier
  untouched when versioning; pnpm rewrites it to the exact workspace
  version during `pnpm pack`/`publish`, so published manifests stay exact.
  Never publish with `nub publish` — nub does not recognize the `workspace:`
  protocol and forwards such specifiers verbatim, which would ship broken
  manifests. Releases must go through the pnpm-based release workflow.

## Commits

Commit messages follow conventional-commit style (`feat(core): ...`) for
history readability. They no longer drive releases — only changesets do.
