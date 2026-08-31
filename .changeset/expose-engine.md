---
"@lambdot/core": minor
---

Add `Composite.expose(name)`: seal a kernel chain into a final, named `Engine` artifact. The engine preserves the chain's external input requirement, erases `bind`-encapsulated internals from its type, drops the composition methods (`use`/`bind` throw at runtime once exposed), and wires into a supervisor kernel under its new name.
