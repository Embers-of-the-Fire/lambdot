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
   `memoryState()` is an ordinary plugin whose item map is a plain
   `Map<string, unknown>`, fresh per application, injected under the
   `state` namespace; swap it for a sqlite/KV/… provider and only the
   declared input type changes.
2. **State as a declared input.** The counter declares
   `{ console: ConsoleIo; state: Map<string, unknown> }` as its input, so
   it can only be composed after both namespaces exist — there is no boot
   order to get wrong. Remove `.with(memoryState())` and `.use(counter)`
   stops compiling, because identity wiring can no longer satisfy the
   declared input.
3. **No backend contract.** The feature reads and writes the map directly,
   exactly as it would any host-native storage API. The framework itself
   stays stateless; the data belongs to the plugin.
4. **The listener is the loop.** Each stdin line is delivered to the
   listener synchronously, so the read-modify-write (`get` → `set`) is
   race-free without any locking.

## The plugin

```ts
const counter = definePlugin({
    name: "counter",
    apply(input: { console: ConsoleIo; state: Map<string, unknown> }, scope) {
        scope.onDispose(
            input.console.onLine((line) => {
                const count = ((input.state.get("count") as number | undefined) ?? 0) + 1;
                input.state.set("count", count);
                input.console.print(`#${count}: ${line}`);
            }),
        );
    },
});
```

The composition is the echo-bot chain with the store inserted before the
feature — both of the counter's inputs identity-wire once `memoryState()`
is composed:

```ts
const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    .with(memoryState())
    // identity wiring: counter's inputs match the visible ctx
    .use(counter);
```

## File layout

| File       | Role                                                         |
| ---------- | ------------------------------------------------------------ |
| `index.ts` | The whole bot: counter feature, console service, memory map. |

## See also

- [echo-bot](../echo-bot) — the console echo bot this one extends with
  state.
- [@lambdot/state-memory](../../packages/state/memory) — the provider used
  here; serves the `state` namespace from a process-local map.
- [@lambdot/state-sqlite](../../packages/state/sqlite) — owns a
  `node:sqlite` connection (`DatabaseSync`) and emits it as its item map,
  for features that want persistence.
