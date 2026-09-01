# @lambdot/state-memory

The simplest state a composition can have: a plain `Map`, fresh per
application, packaged as an ordinary plugin. lambdot's core is stateless —
state is a plugin — and this is the zero-dependency instance of that.

## What it provides

`memoryState()` emits a `Map<string, unknown>` as the `"state"` namespace
value, so stateful features declare `{ state: Map<string, unknown> }` in
their input (identity wiring when the plugin is composed under its own
name) and read/write the map directly — no backend contract, no accessor
factory. Features that outgrow a `Map` swap in a host-native store (a
`DatabaseSync`, a KV namespace) by changing the provider plugin and the
declared input type.

Semantics: the store is created in `apply()`, so each application starts
from an empty map — two applications of the same definition do not see each
other's writes, and state is gone when the owning scope disposes.

## Usage

```ts
import { definePlugin } from "@lambdot/core";
import { memoryState } from "@lambdot/state-memory";

const counter = definePlugin({
    name: "counter",
    apply(input: { state: Map<string, unknown> }) {
        const count = ((input.state.get("count") as number | undefined) ?? 0) + 1;
        input.state.set("count", count);
        return { count };
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(memoryState())
    // identity wiring: counter's inputs match the visible ctx
    .use(counter);
```

Wire `memoryState()` before the feature: a consumer wired before its
provider is a compile error, because the declared input keys must be visible
in the composition's context.

## API

```ts
function memoryState(): Plugin<void, Map<string, unknown>, void, "state">;
```

The only export. Takes no config; the returned plugin is named `"state"`.

## See also

- [`@lambdot/state-sqlite`](../sqlite) — a `node:sqlite` connection as a
  namespace value, for state that should outlive an application.
- `@lambdot/host-cloudflare` — `kvNamespace` and `doStorage`, the
  host-native storage bindings of a worker.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
