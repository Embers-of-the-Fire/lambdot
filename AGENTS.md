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
    for project in packages/* examples/*; do npx tsc -p "$project"; done
    ```

This mirrors `.github/workflows/ci.yml`. Run all three before finishing.

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
- **TypeScript is v7** (native/tsgo-era). Do not assume tsc v5 behavior.
- **Node version is pinned** in `.node-version` (provisioned by nub /
  `nubjs/setup-nub` in CI).

## Architecture in one breath

Monorepo: `packages/*` (`@lambdot/*` — `core` kernel plus reference
input/output/state plugins and the `websocket` transport factories) and
`examples/*` (`@lambdot-example/*`). Everything
is a plugin composed via `createKernel().use(...)`; the generic fold means
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
