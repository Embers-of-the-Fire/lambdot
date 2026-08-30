# counter-bot

Echoes each line back with a running count — the reference example for
lambdot's **pluggable state** model.

```console
$ printf 'a\nb\nc\n' | nub index.ts
#1: a
#2: b
#3: c
```

## What it demonstrates

1. **The state seam.** State is not built into the framework.
   `memoryState()` is an ordinary plugin whose output value is a
   `StateBackend`, exposed under the `state` namespace; swap it for a
   Redis/KV/… backend plugin and this bot doesn't change.
2. **State as a declared input.** The counter declares
   `{ "console/lines": Stream<ConsoleLine>; state: StateBackend }` as its
   input, so it can only be composed after both namespaces exist — there is
   no boot order to get wrong. Remove `.use(memoryState())` and
   `.use(counter)` stops compiling, because identity wiring can no longer
   satisfy the declared input.
3. **Typed, namespaced state.** Inside `apply`,
   `createStateAccessor<CounterSchema>(input.state, "counter")` returns a
   `StateAccessor<CounterSchema>` namespaced to this plugin —
   `get("count")` is `number | undefined`, and unknown keys don't compile.
   The framework itself stays stateless; the schema (and the data) belong
   to the plugin.
4. **Sequential stream processing.** Each stream consumer processes items
   one at a time in arrival order, so the read-modify-write in the mapper
   (`get` → `set`) is race-free without any locking.

## The plugin

```ts
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
```

The composition is the echo-bot chain with the backend inserted before the
feature — both of the counter's inputs identity-wire once `memoryState()`
is composed:

```ts
const kernel = createKernel()
    .use(cli.lines)
    .use(memoryState())
    // identity wiring: counter's inputs match the visible ctx
    .use(counter)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.counter }) });
```

## File layout

| File       | Role                                                              |
| ---------- | ----------------------------------------------------------------- |
| `index.ts` | The whole bot: counter feature, console platform, memory backend. |

## See also

- [echo-bot](../echo-bot) — the console echo bot this one extends with
  state.
- [@lambdot/state-memory](../../packages/state/memory) — the `StateBackend`
  used here; serves the `state` namespace from a process-local map.
- [@lambdot/state-sqlite](../../packages/state/sqlite) — not a
  `StateBackend`: it owns a `node:sqlite` connection (`DatabaseSync`) and
  emits it as its namespace value, for features to build their own
  persistence on.
