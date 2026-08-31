# Changelog

## 0.2.0

### Patch Changes

- Updated dependencies [[`71e5732`](https://github.com/Embers-of-the-Fire/lambdot/commit/71e57321ad4ec7d1aef3651d104123f8167ec2e7), [`71e5732`](https://github.com/Embers-of-the-Fire/lambdot/commit/71e57321ad4ec7d1aef3651d104123f8167ec2e7)]:
  - @lambdot/core@0.2.0

## 0.1.1

### Patch Changes

- [#10](https://github.com/Embers-of-the-Fire/lambdot/pull/10) [`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Switch inter-package dependency pins from exact versions to `workspace:*` so workspace members always resolve against local sources during development; pnpm rewrites the protocol to exact versions at pack/publish time.
- Updated dependencies [[`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355)]:
  - @lambdot/core@0.1.1

## [0.1.0](https://github.com/Embers-of-the-Fire/lambdot/compare/host-cloudflare-v0.0.1...host-cloudflare-v0.1.0) (2026-08-29)


### Features

* **host-cloudflare:** named KV/D1/R2 binding capabilities with hono+miniflare example ([fe2d527](https://github.com/Embers-of-the-Fire/lambdot/commit/fe2d527f7b40380df4d05ab643814987a004566d))
* **host-cloudflare:** worker environment variables as a typed capability ([7319c5f](https://github.com/Embers-of-the-Fire/lambdot/commit/7319c5f0d656c2dd7e32c33c2be26b384f7e398e))
