---
"@lambdot/console": patch
"@lambdot/core": patch
"@lambdot/env": patch
"@lambdot/host-cloudflare": patch
"@lambdot/logging": patch
"@lambdot/protocol-qq": patch
"@lambdot/state-memory": patch
"@lambdot/state-sqlite": patch
"@lambdot/websocket": patch
---

Switch inter-package dependency pins from exact versions to `workspace:*` so workspace members always resolve against local sources during development; pnpm rewrites the protocol to exact versions at pack/publish time.
