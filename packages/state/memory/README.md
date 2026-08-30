# @lambdot/state-memory

The reference `StateBackend`: an in-memory store with optional per-key TTL,
packaged as an ordinary plugin. lambdot's core is stateless — state is a
plugin — and this is the simplest backend that fills the slot.

## What it provides

`memoryState()` emits its backend as the `"state"` namespace value, so
stateful features declare `{ state: StateBackend }` in their input (identity
wiring when the plugin is composed under its own name). The backend conforms
to `StateBackend` from `@lambdot/core` (`get`/`set`/`delete`); feature
plugins build a typed, namespaced view of it with
`createStateAccessor(backend, name)` from `@lambdot/core`.

Semantics and limitations:

- **Per-activation, non-persistent.** The store is a `Map` created in
  `apply()`, so each kernel activation starts from an empty store: two
  kernels built from the same `memoryState()` value do not see each
  other's writes, and state is gone when the composition stops.
- **Lazy TTL.** `set(namespace, key, value, ttlMs)` records an absolute
  expiry; an expired key is evicted on read (`get` deletes it and returns
  `undefined`). There is no background sweeper.

## Usage

```ts
import { consolePlatform, type ConsoleLine } from "@lambdot/console";
import type { StateBackend, Stream } from "@lambdot/core";
import { createKernel, createStateAccessor, definePlugin, mapStream } from "@lambdot/core";
import { memoryState } from "@lambdot/state-memory";

interface CounterSchema {
    count: number;
}

const counter = definePlugin({
    name: "counter",
    apply(input: { "console/lines": Stream<ConsoleLine>; state: StateBackend }) {
        const state = createStateAccessor<CounterSchema>(input.state, "counter");
        return mapStream(input["console/lines"], async (event) => {
            const count = ((await state.get("count")) ?? 0) + 1;
            await state.set("count", count);
            return { address: event.address, content: `#${count}: ${event.payload}` };
        });
    },
});

const cli = consolePlatform();

const kernel = createKernel()
    .use(cli.lines)
    .use(memoryState())
    // identity wiring: counter's inputs match the visible ctx
    .use(counter)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.counter }) });
```

Wire `memoryState()` before the feature: a consumer wired before its
provider is a compile error, because the declared input keys must be visible
in the composition's context. Swap `memoryState()` for another backend
plugin (one emitting a `StateBackend` under `"state"`) and the feature
doesn't change.

## API

```ts
function memoryState(): Plugin<void, StateBackend, void, "state">;
```

The only export. Takes no config; the returned plugin is named `"state"`.

## See also

- [`examples/counter-bot`](../../../examples/counter-bot) — the
  pluggable-state walkthrough this backend serves.
- [`@lambdot/state-sqlite`](../sqlite) — a `node:sqlite` connection as a
  namespace value (not a `StateBackend`).
- `@lambdot/host-cloudflare` — `kvState`, bridging a Workers KV namespace
  into the same `StateBackend` shape.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
