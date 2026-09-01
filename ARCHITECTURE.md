# Architecture

This document describes the high-level design of lambdot core. It is the
meta view — the _why_ and the shape of the whole; `spec.md` is the
normative contract, and `packages/core/core` is its realization.

## The idea

lambdot core is a composition model for dataflow dependencies, in the same
spirit that Nix is a definition model for systems: **a system is described
by an immutable, stateless definition, and the description itself is
composable.**

The design achieves that with radical subtraction. There is exactly one
concept — the **plugin** — and exactly one mechanism — **context
injection**, available in two forms, `use` and `with`. There is no kernel,
engine, composite, container, registry, or lifecycle manager. Anything that
can be defined can be composed; anything composed can be further composed.
Composing two plugins yields a plugin, so the dependency tree of an
application _is_ a plugin, and the model is fractal: the same rules apply
at every scale, from a leaf to the whole system.

## The four moving parts

```
                 definition time                 application time
                 ---------------                 ----------------

   plugin A ──┐                                  caller-owned scope
              │  A.use(B, { as, mapping,          (dispose + error sink)
   plugin B ──┘         option })                        │
              ▼                                          ▼
        a new plugin ───────────── apply(ctx, scope, config) ────▶ item map
        (immutable,                seeds the accumulated context   (the plugin's
         stateless,                from ctx, applies dependencies   own output —
         composable)               in declaration order, injects    never part of
                                   each item map under a            its own
                                   namespace, then runs A's own     context)
                                   logic last
```

1. **Context** — a record from string keys (namespaces) to values. It is
   the only input a plugin ever sees: the caller-seeded context, enriched
   with the item maps of the plugin's declared dependencies. There is no
   ambient state and no framework-owned mutable cell. Contexts are
   tree-shaped exactly as the dependency declaration is tree-shaped.

2. **Plugin** — a processor of context, and a _definition, not a process_.
   Immutable (composition produces a new plugin, never mutates), stateless
   (two applications are fully independent), composable (the result of
   `use` / `with` is again a plugin). A plugin reads its accumulated
   context and produces its **own item map** — which never enters its own
   context; it is visible only to its caller. A plugin may declare a config
   schema (any Standard Schema validator) that guards every use site.

3. **Scope** — the channel for the impure remainder. Application is not
   mathematically pure: real plugins acquire resources and fail
   asynchronously. At application time the caller hands in a scope, through
   which the plugin registers **disposers** (teardown for what this
   application acquired) and reports **errors** (failures outside the
   direct call). Disposal is LIFO, mirroring acquisition order. The caller
   that originates an application owns the scope and decides when to
   dispose it.

4. **`use` and `with`** — context injection, the only composition
   mechanism. Both declare _A depends on B_ and inject B's item map into
   the context A will process, under a namespace; they differ in exactly
   one thing: the context B itself processes. `use` grants B the
   accumulated context (order is observable: B reads everything declared
   before it); `with` grants B a blank context (B is hermetic — its item
   map depends only on its own subtree and its config). All wiring —
   namespace, input adaptation (`mapping`, `use` only), config (`option`)
   — is declared at the composition site; a plugin never knows how it is
   wired, so it is reusable under any name, wiring, or config.

## Execution is application

There is deliberately **no running thing**: no start, no stop, no instance.
A plugin is to its applications what a Nix derivation is to its
realisations — the definition is immutable and shareable, each application
is isolated and disposable. Execution is `apply(ctx, scope, config)`; the
caller decides how to execute and when to dispose.

Applying a composition proceeds uniformly: seed the accumulated context
from the given context; apply each dependency in declaration order —
`use` entries to the accumulated context (through the site's mapping, if
any), `with` entries to a blank context — injecting each item map under
its namespace; then run the plugin's own logic over the final accumulated
context and return its item map. The accumulated context is input-side
scaffolding; it does not propagate to the caller.

This makes resource safety structural rather than managerial:

- **On success**, every application's teardown is registered onto the
  caller's scope in application order — dependencies in declaration order,
  then the plugin's own logic — and the scope's LIFO discipline unwinds
  the whole dependency tree in reverse dependency order.
- **On failure** (validation error, throw, rejection), the application
  aborts: everything already applied is disposed in reverse, the failure
  propagates, and no partial resources are left behind — because nothing
  is registered on the caller's scope until the application fully
  succeeds.

## Where concerns live

Cross-cutting concerns — logging, error routing, state backends,
transports — are **ordinary plugins**, not framework hooks. The core
reserves no extension points for them; they inject services into contexts
or observe scopes like any other plugin. This keeps the core closed for
modification while the ecosystem stays open for extension.

Diagnostics are the canonical example, expressed with the abstract/handler
pattern: an emitting plugin declares an **optional sink** in its input
contract and emits only when one is present (absence means drop); a handler
is an ordinary, usually hermetic, plugin whose item map satisfies the sink
interface; the composition site connects them — or doesn't. Diagnostics
never propagate implicitly: each intermediate layer re-declares the sink
and forwards it through its own mapping, and there is no interposition —
tracing is what plugins _emit_, never what the framework intercepts.

Likewise, **host adapters** (an HTTP server, a serverless runtime, a CLI)
live outside the core. They are the callers that originate applications:
they own a scope, apply a plugin, and decide when to dispose. The core
defines what application means; hosts define when and why it happens.

## Static where possible, dynamic where necessary

The same rules are enforced twice:

- **Statically** — the shape of contexts, the validity of wiring, whether
  a mapping is required (an optional declared input never forces one),
  whether a config is required, whether a dependency is hermetic enough
  for `with`, and namespace freshness are all type-level properties of
  `use` and `with`, checked at compile time for code the type system can
  see.
- **Dynamically** — namespace uniqueness is re-checked at application time
  and config values are validated against their schemas before any plugin
  logic runs, so dynamically-constructed compositions fail loudly rather
  than silently.

The type system is not an ornament on top of the model; it is the static
projection of the same invariants the runtime enforces.

## Consequences

- **The dependency tree is fractal.** Leaf, chain, and system are one
  thing; reuse and nesting need no special cases.
- **Testing is application.** Apply a plugin with a fresh scope, assert on
  the item map, dispose. No harness, no framework runtime.
- **Composition is non-destructive.** `A.use(B)` / `A.with(B)` leave `A`
  reusable; branching a system costs nothing and shares nothing mutable.
- **Failure has one story.** Abort-and-unwind in reverse, always, at every
  level of the tree.
- **The core stays minimal.** Everything not in this document is someone
  else's plugin.
