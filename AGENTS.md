# AGENTS.md

## Toolchain — use `nub`, never npm/pnpm/yarn

This repo is managed by **nub** (`packageManager: nub@0.8.0`). It comes from
the flake dev shell (`direnv` loads it via `.envrc`); do not substitute other
package managers.

- `nub install` — install deps (lockfile is `nub.lock`)
- `nub run lint` / `nub run fmt` / `nub run fmt:check`
- `nub run -F @lambdot-example/echo-bot start` — run one workspace script
- `nub examples/echo-bot/index.ts` — nub executes TypeScript directly; there is
  **no build step**

## Verification

There is **no test runner and no test suite**. Verification is, in order:

1. `nub run fmt:check`
2. `nub run lint` — oxlint with `typeAware` + `typeCheck` enabled (backed by
   `oxlint-tsgolint`), so it subsumes a root-level `tsc --noEmit`
3. Per-project typecheck, because the root `tsconfig.json` has `"files": []`
   and checks nothing:

    ```sh
    for project in packages/*/* examples/*; do npx tsc -p "$project"; done
    ```

This mirrors `.github/workflows/ci.yml`. Run all three before finishing.

## Releases

Release automation is release-plz-style, built on release-please
(`release-please-config.json` + `.release-please-manifest.json` +
`.github/workflows/release.yml`):

- Pushing conventional commits to `main` maintains a single release PR that
  bumps all `@lambdot/*` packages in lockstep (`linked-versions` plugin) and
  updates their `CHANGELOG.md` files. Pre-1.0 semantics
  (`bump-minor-pre-major`): `feat` and breaking changes bump minor, `fix`
  bumps patch. To cut 1.0.0, set `"release-as": "1.0.0"` in the config for
  one release cycle.
- Merging the release PR tags each package (`<component>-vX.Y.Z`), creates
  the GitHub releases, and publishes to npm with provenance. Publishing
  authenticates via **npm Trusted Publishing** (OIDC): each package needs a
  Trusted Publisher entry on npmjs.com pointing at this repo and
  `release.yml`, and the workflow assumes every package already exists on
  npm. Bootstrap a brand-new package by publishing a placeholder manually
  (`nub publish`) and then adding its Trusted Publisher entry.
- Inter-package pins in publishable packages are exact (`"0.1.0"`, never
  `workspace:*` — nub forwards `workspace:` specs to registries verbatim)
  and are bumped in every release PR by release-please's `node-workspace`
  plugin (`merge: false`, paired with `linked-versions`). Private
  `examples/*` keep `workspace:*` so they always link the local packages.
- A new publishable package must be registered in both release-please files:
  `packages` + the `linked-versions` `components` list in the config (same
  component name in both), and the manifest.

## Repo-specific rules that will bite you

- **Packages ship raw TypeScript source** — `exports` points at
  `./src/index.ts`, `tsconfig.base.json` sets `allowImportingTsExtensions` +
  `noEmit`. Import workspace code with explicit `.ts` extensions; never add
  emit/build config.
- **`verbatimModuleSyntax` is on** — use `import type` for type-only imports or
  lint/tsc will fail. Also strict: `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`.
- **Formatting is oxfmt**: 4-space indent, `sortImports: true` (imports get
  reordered automatically).
- **Inter-package deps under `packages/` are exact pins** (e.g. `"0.1.0"`),
  bumped automatically in release PRs. `workspace:*` is for `examples/*`
  only — never use it in a publishable package.
- **TypeScript is v7** (native/tsgo-era). Do not assume tsc v5 behavior.
- **Node version is pinned** in `.node-version` (provisioned by nub /
  `nubjs/setup-nub` in CI).

## Architecture in one breath

Monorepo: `packages/<category>/*` (`@lambdot/*`) and `examples/*`
(`@lambdot-example/*`). Package categories: `core` (the kernel plus
platform-agnostic behaviors — the `console` reference platform, the
`websocket` transport factories, and `env` for reading `process.env` into a
typed capability), `protocol` (chat-service wire protocols: `qq` serves both
QQ infras — the websocket gateway and the webhook (reversed post) — over one
REST client; discord, ... none yet), `host` (hosting/runtime integrations:
cloudflare — a worker's named KV/D1/R2 bindings and plain environment
variables as typed capabilities, plus a KV-backed `StateBackend` bridge), `state` (`StateBackend`
implementations like `memory`, plus `sqlite` which owns a `node:sqlite`
connection and provides it as a typed capability, D1-style).
Everything is a plugin composed via `createKernel().use(...)`; the generic
fold means
**registration order is enforced at compile time** — inputs/outputs must be
registered before feature plugins that consume them, and typed capabilities
(`TProvides`/`TInjects`, folded as `TCaps`) before plugins that inject them.
Untyped, string-only `inject` (e.g. `"state"`) stays runtime-gated only.
For websocket platforms, prefer the `wsPlatform(capability, spec)` bundle
from `@lambdot/websocket`; reach for the individual
`wsTransport`/`wsInput`/`wsOutput` factories only when a platform needs the
pieces separately.

`examples/echo-bot/type-test.ts` is a compile-time test suite: every
`@ts-expect-error` line must remain a genuine error. Do not "fix" the flagged
expressions; fix the types if they stop erroring.

## Commits

Conventional Commits (`feat:`, `chore:`, `ci:`, ...), matching the existing
history.
