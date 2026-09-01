# @lambdot/core

A composition model for dataflow dependencies, in the same spirit that Nix
is a definition model for systems: **a system is described by an immutable,
stateless definition, and the description itself is composable.**

The model recognizes exactly one concept — the **plugin** — and exactly one
mechanism — **context injection**, available in two forms, `use` and
`with`. There is no kernel, engine, composite, or system object. Composing
two plugins yields a plugin; the dependency tree of an application _is_ a
plugin.

## Plugin

A plugin is a processor of a given context: it reads a **context** (a
record from string keys — namespaces — to arbitrary values) and produces an
**item map** (an arbitrary map). It is a **definition, not a process**:
immutable, stateless, composable.

```ts
import { definePlugin } from "@lambdot/core";

const greet = definePlugin({
    name: "greet",
    apply: () => ({ greeting: "hello" }),
});
```

Call `definePlugin` without explicit type arguments: the name infers as a
literal (it becomes the default namespace once composed), and the input,
output, and config types infer from `apply`'s annotations and the `Config`
schema.

A plugin's declared input is its **full context view**: what the caller
seeds plus the namespaces of the dependencies it composes. A plugin whose
logic reads `ctx.inner.greeting` declares `{ inner: { greeting: string } }`
— whether `inner` comes from the caller or from `.use(inner)`.

A plugin may declare a **config schema** (any
[Standard Schema](https://standardschema.dev) validator). Every use site
that declares the plugin as a dependency must then supply a config value,
validated against the schema before the plugin's logic runs:

```ts
const greet = definePlugin({
    name: "greet",
    Config: schema, // StandardSchemaV1<unknown, { loud: boolean }>
    apply: (_ctx, _scope, config) => ({ greeting: config.loud ? "HELLO" : "hello" }),
});
```

## Composition: `use` and `with`

Context injection is the only composition mechanism. Both forms declare
that **A depends on B**, and both inject B's item map into the context A
will process, under a namespace. They differ in exactly one thing: the
context B itself processes.

```ts
A.use(B); // B is granted the context A already has
A.with(B); // B is granted a blank context
```

- **`use`** — B is a _contextual_ dependency. B is applied to the context
  accumulated so far: A's given context, enriched with the item maps of all
  dependencies declared before B. Declaration order is observable.
- **`with`** — B is a _hermetic_ dependency. B is applied to an empty
  context: its item map depends only on its own subtree and its config.
  Declaration order is irrelevant.

Composition is non-destructive: both forms return a new plugin and leave
`A` unchanged and reusable.

```ts
const state = definePlugin({ name: "state", apply: () => ({ get, set }) });
const counter = definePlugin({
    name: "counter",
    apply: (ctx: { "counter-source": { get(): number; set(n: number): void } }) => ({
        increment: () => {
            /* ... */
        },
        value: () => ctx["counter-source"].get(),
    }),
});

const app = definePlugin({
    name: "app",
    apply: (ctx: { counter: { value(): number } }) => ({ run: () => ctx.counter.value() }),
})
    .with(state)
    .use(counter, { mapping: (ctx) => ({ "counter-source": ctx.state }) });
```

At each composition site, the wiring parameterizes the dependency — a
plugin never knows how it is wired:

- `mapping` (`use` only) — derives the dependency's input context from the
  accumulated context. Required (statically) when identity wiring cannot
  satisfy the dependency's declared input. `with` has no mapping: the
  granted context is always blank, so there is nothing to adapt.
- `option` (both forms) — the dependency's config value, validated against
  its declared config schema.
- `as` (both forms) — overrides the namespace (default: the dependency's
  name).

Applying a composed plugin seeds the accumulated context from the given
context, applies each dependency in declaration order, injecting each item
map under its namespace, then runs the plugin's **own logic last**, over
the final accumulated context, and returns **its own item map**. A plugin's
own item map never enters its own context — it is visible only to its
caller. The accumulated context is input-side scaffolding; it does not
propagate to the caller.

Because a composed plugin is a plugin, nesting is uniform: used as a
dependency, its whole item map nests under one namespace of the parent's
context, so contexts are tree-shaped exactly as the declaration is. Within
one plugin's dependency list a namespace may be introduced at most once —
duplicates are rejected statically where the type system can see them, and
as a thrown error at application time otherwise.

## Diagnostics: abstract plugins and handlers

Logging and tracing are expressed with the abstract/handler pattern — a
plugin declares an **optional sink** in its input contract and emits
through it only when one is present. Absence means drop: no buffering, no
fallback, no default handler.

```ts
const logToConsole = definePlugin({
    name: "logToConsole",
    apply: () => ({ write: (rec) => console.log(rec) }),
});
const foo = definePlugin({
    name: "foo",
    apply: (ctx: { sink?: { write(rec: unknown): void } }) => ({
        work: () => ctx.sink?.write({ level: "info", msg: "working" }),
    }),
});

// downstream decides to handle:
app.with(logToConsole).use(foo, { mapping: (ctx) => ({ sink: ctx.logToConsole }) });
// or not — foo's logs are dropped:
app.use(foo);
```

An optional declared input never forces a mapping — identity wiring remains
valid. Diagnostics do not propagate implicitly: if `foo` is nested inside
`bar`, `bar` must re-declare the optional sink and forward it through its
own mapping. The handler is swappable (console, file, test recorder)
without touching `foo` or any intermediate layer's logic.

## Application and scope

Execution is _application_; there is no running instance, no start, no
stop. The caller that originates an application provides the initial
context (empty or seeded) and owns a **scope**, deciding when to dispose
it:

```ts
import { createScope } from "@lambdot/core";

const scope = createScope({ onError: (error) => console.error(error) });
const items = await app.apply({ env: "prod" }, scope, undefined);
// ... later, when the application's resources should be released:
await scope.dispose();
```

At application time a plugin receives the scope and may:

- register **disposers** — teardown actions for the resources this
  application acquired. They run in reverse registration order (LIFO) when
  the owning scope is disposed, unwinding the dependency tree in reverse
  dependency order: the plugin's own logic first, then its dependencies in
  reverse.
- report **errors** — failures that occur outside the direct application
  call (background tasks, subscriptions, disposer failures). The framework
  installs no error policy; an unhandled report falls through to the
  caller's sink.

If any part of an application fails — validation error, thrown exception,
rejected promise — the application aborts: every dependency already applied
is disposed in reverse order, and the failure propagates to the caller. A
failed application leaves no partial resources behind.

## API

| Export                                                    | Kind     | Purpose                                                              |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `definePlugin(spec)`                                      | function | Author a plugin (`name`, optional `Config`, `apply`).                |
| `plugin.use(dep, options?)`                               | method   | Declare a contextual dependency; returns a new plugin.               |
| `plugin.with(dep, options?)`                              | method   | Declare a hermetic dependency (blank context); returns a new plugin. |
| `plugin.apply(ctx, scope, config)`                        | method   | Apply the definition to a context under a caller-owned scope.        |
| `createScope(options?)`                                   | function | Create an owned scope; `dispose()` unwinds it LIFO.                  |
| `ConfigValidationError`                                   | class    | Thrown when a config value fails schema validation.                  |
| `Plugin`, `PluginSpec`, `Scope`, `OwnedScope`, `Disposer` | types    | The model's vocabulary.                                              |
| `InOf`, `OutOf`, `ConfigOf`, `NameOf`                     | types    | Structural inference helpers.                                        |
| `WireArgs`, `WithArgs`, `AnyPlugin`                       | types    | Wiring helper types.                                                 |
| `StandardSchemaV1`                                        | type     | Structural copy of the Standard Schema interface.                    |

## Design principles

- **One concept, one mechanism.** Anything that can be defined can be
  composed; anything composed can be further composed. The dependency tree
  is fractal.
- **Definitions, not instances.** Each application is isolated and
  disposable; the caller decides how to execute and when to dispose.
- **Context flows top-down only.** A plugin sees exactly what its caller
  gave it, enriched solely by its declared dependencies. No ambient state,
  no registry, no upward or sideways flow.
- **Composition is explicit at the use site.** Dependencies, namespaces,
  input adaptation, and config are all declared where a dependency is used.
  `use` shares the world; `with` seals it.
- **Concerns are plugins.** Logging, error routing, state backends,
  transports, behavior behind abstract interfaces — ordinary plugins; the
  core reserves no hooks for them.
- **Static where possible, dynamic where necessary.** Context shapes,
  wiring validity, mapping and config requirements, and namespace freshness
  are enforced by the type system, and again at application time so
  dynamically-constructed compositions fail loudly.
