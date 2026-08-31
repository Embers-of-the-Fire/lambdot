# Changelog

## 0.2.0

### Minor Changes

- [#12](https://github.com/Embers-of-the-Fire/lambdot/pull/12) [`71e5732`](https://github.com/Embers-of-the-Fire/lambdot/commit/71e57321ad4ec7d1aef3651d104123f8167ec2e7) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Add `Composite.expose(name)`: seal a kernel chain into a final, named `Engine` artifact. The engine preserves the chain's external input requirement, erases `bind`-encapsulated internals from its type, drops the composition methods (`use`/`bind` throw at runtime once exposed), and wires into a supervisor kernel under its new name.

### Patch Changes

- [#12](https://github.com/Embers-of-the-Fire/lambdot/pull/12) [`71e5732`](https://github.com/Embers-of-the-Fire/lambdot/commit/71e57321ad4ec7d1aef3651d104123f8167ec2e7) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Implement `Engine.apply` on the runtime behind `Composite.expose`: the sealed engine now delegates to its inner composition, so calling `engine.apply(input, scope, config)` directly works instead of throwing `TypeError: engine.apply is not a function`.

## 0.1.1

### Patch Changes

- [#10](https://github.com/Embers-of-the-Fire/lambdot/pull/10) [`19d37e4`](https://github.com/Embers-of-the-Fire/lambdot/commit/19d37e42c7a5514fb62c8f31c65e1aa01916d355) Thanks [@Embers-of-the-Fire](https://github.com/Embers-of-the-Fire)! - Switch inter-package dependency pins from exact versions to `workspace:*` so workspace members always resolve against local sources during development; pnpm rewrites the protocol to exact versions at pack/publish time.

## [0.1.0](https://github.com/Embers-of-the-Fire/lambdot/compare/core-v0.0.1...core-v0.1.0) (2026-08-29)


### Miscellaneous Chores

* **core:** Synchronize lambdot versions
