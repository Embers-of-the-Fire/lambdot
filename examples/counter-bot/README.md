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

1. **The state seam.** State is not built into the framework. `memoryState()`
   is a plugin whose backend provides the `state` capability; swap it for a
   Redis/KV/… backend plugin and this bot doesn't change.
2. **`inject`-driven activation.** The counter declares `inject: ["state"]`,
   so it stays pending until a backend activates — there is no boot order to
   get wrong. Remove `.use(memoryState())` and the kernel reports the plugin
   pending instead of failing at first use.
3. **Typed, namespaced state.** Declaring `CounterSchema` as the plugin's
   third type argument makes `ctx.state.for("counter")` return a
   `StateAccessor<CounterSchema>` — `get("count")` is `number | undefined`,
   and unknown keys don't compile. The framework itself stays stateless;
   the schema (and the data) belong to the plugin.
4. **Sequential event processing.** The kernel processes ingested events one
   at a time in arrival order, so the read-modify-write in the handler
   (`get` → `set`) is race-free without any locking.

## The plugin

```ts
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
```
