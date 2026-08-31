# Changelog

## 0.1.1

### Patch Changes

- [#10](https://github.com/Embers-of-the-Fire/lambdot/pull/10) [`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Switch inter-package dependency pins from exact versions to `workspace:*` so workspace members always resolve against local sources during development; pnpm rewrites the protocol to exact versions at pack/publish time.
- Updated dependencies [[`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355)]:
  - @lambdot/core@0.1.1

## [0.1.0](https://github.com/Embers-of-the-Fire/lambdot/compare/state-sqlite-v0.0.1...state-sqlite-v0.1.0) (2026-08-29)


### Features

* **state-sqlite:** node:sqlite database binding as a typed capability ([e8341d0](https://github.com/Embers-of-the-Fire/lambdot/commit/e8341d06f988dfed968020faaf449b6f14781040))
