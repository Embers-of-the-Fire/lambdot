# @lambdot/state-memory

The reference `StateBackend`: an in-memory store with optional per-key TTL,
packaged as an ordinary feature plugin. lambdot's core is stateless — state
is a plugin — and this is the simplest backend that fills the slot.

## What it provides

`memoryState()` provides its backend as the runtime-gated `"state"`
capability, so stateful features (`inject: ["state"]`) activate only while
it is active, and unload if it goes away. At most one state provider may be
active. The backend conforms to `StateBackend` from `@lambdot/core`
(`get`/`set`/`delete`); feature plugins never see it directly — they declare
a schema and get a typed, namespaced `StateAccessor` via `ctx.state.for(name)`.

Semantics and limitations:

- **Per-process, non-persistent.** The store is a `Map` created inside
  `memoryState()`; it lives and dies with the process and is shared by
  every kernel instance built from the same plugin value.
- **Lazy TTL.** `set(key, value, ttlMs)` records an absolute expiry; an
  expired key is evicted on read (`get` deletes it and returns `undefined`).
  There is no background sweeper.

## Usage

```ts
import { consolePlatform, type ConsoleEvents, type ConsoleOutputs } from "@lambdot/console";
import { createKernel, definePlugin } from "@lambdot/core";
import { memoryState } from "@lambdot/state-memory";

interface CounterSchema {
    count: number;
}

const counter = definePlugin<ConsoleEvents, ConsoleOutputs, CounterSchema>({
    name: "counter",
    inject: ["state"],
    apply(ctx) {
        return ctx.on("console.line", async (event) => {
            const state = ctx.state.for("counter");
            const count = ((await state.get("count")) ?? 0) + 1;
            await state.set("count", count);
            await ctx.send(event.address, `#${count}: ${event.payload}`);
        });
    },
});

const cli = consolePlatform();

const kernel = createKernel().use(cli.input).use(cli.output).use(memoryState()).use(counter);
```

Remove `.use(memoryState())` and the kernel reports `counter` pending
instead of failing at first use; swap `memoryState()` for another backend
plugin and the feature doesn't change.

## API

```ts
function memoryState(): FeaturePlugin<{}, {}, undefined, void, "state-memory">;
```

The only export. Takes no config; the returned plugin is named
`"state-memory"`.

## See also

- [`examples/counter-bot`](../../../examples/counter-bot) — the
  pluggable-state walkthrough this backend serves.
- [`@lambdot/state-sqlite`](../sqlite) — a `node:sqlite` connection as a
  typed capability (not a `StateBackend`).
- `@lambdot/host-cloudflare` — `kvState`, bridging a Workers KV namespace
  into the same `"state"` slot.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
