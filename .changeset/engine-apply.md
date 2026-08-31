---
"@lambdot/core": patch
---

Implement `Engine.apply` on the runtime behind `Composite.expose`: the sealed engine now delegates to its inner composition, so calling `engine.apply(input, scope, config)` directly works instead of throwing `TypeError: engine.apply is not a function`.
