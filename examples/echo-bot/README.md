# echo-bot

The minimal lambdot bot: the console service plus one feature plugin that
echoes each line back. Also home of `type-test.ts`, a compile-time check on
the composition types.

```console
$ printf 'hello world\nsecond line\n' | nub index.ts
echo: hello world
echo: second line
```

From the repo root, `nub run -F @lambdot-example/echo-bot start` gives an
interactive session instead (Ctrl-C to quit).

## What it demonstrates

1. **The minimal composition.** `consoleIo()` (from `@lambdot/console`) is
   one plugin whose item map is the console service — `onLine(listener)` to
   subscribe to stdin lines, `print(text)` to write back. One feature
   plugin on top makes a bot.
2. **A plugin is a processor of its context.** `echo` declares its input as
   a record — `{ console: ConsoleIo }` — and its `apply` subscribes to
   lines, printing each one back. There is no dispatch machinery to hook
   into: the service is an ordinary value in the context.
3. **`use` vs. `with`.** The console is `with`-ed: it is hermetic, granted
   a blank context — a terminal observes nothing of its surroundings. The
   feature is `use`d: it reads the accumulated context, which by then
   carries the `console` namespace. Identity wiring needs no options: the
   feature's input keys already match what is visible. Wiring out of order
   is a compile error, because the mapping's parameter is typed as exactly
   what is visible at that point in the composition.
4. **The caller owns the scope.** The script originates the application:
   `createScope()` + `app.apply(...)`, and `scope.dispose()` on SIGINT
   closes the readline interface and unsubscribes the listener. There is no
   running thing to stop — only resources held open by the scope.
5. **Stateless by default.** No state plugin is composed, so no `state`
   namespace exists. State is opt-in; see
   [`counter-bot`](../counter-bot/README.md) for the same console service
   with a store added.

## The composition

```ts
import { consoleIo, type ConsoleIo } from "@lambdot/console";
import { createScope, definePlugin } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { console: ConsoleIo }, scope) {
        scope.onDispose(input.console.onLine((line) => input.console.print(`echo: ${line}`)));
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo);

const scope = createScope();
await app.apply(undefined, scope, undefined);
```

`definePlugin({ name, apply })` declares what the feature consumes (its
input record type) and what it emits (the `apply` return type). The name
becomes the namespace key the item map is injected under once composed.

## type-test.ts

`type-test.ts` is a compile-time check on the composition types: it
composes the console service with the echo plugin exactly like `index.ts`
does, then asserts how the namespaces are wired — identity wiring only
compiles when the declared input is already visible (otherwise the
`mapping` becomes a required argument), mappings are checked against the
namespaces visible at that point in the composition with compatible types,
`with` rejects dependencies that declare required input and accepts no
mapping, `option` is required exactly when the config type is non-void,
duplicate namespaces are rejected, and a composed plugin nests whole under
one namespace of a parent. The file is in this package's `tsconfig.json`,
so the root `nub run lint` — oxlint is type-aware (`typeCheck`) and
subsumes `tsc --noEmit` — checks it along with everything else.
[`websocket-bot/type-test.ts`](../websocket-bot/type-test.ts) mirrors these
assertions through `@lambdot/websocket`'s connection plugin, plus two
connections side by side.

## File layout

| File           | Role                                                      |
| -------------- | --------------------------------------------------------- |
| `index.ts`     | The bot: one echo feature on the console service.         |
| `type-test.ts` | Compile-time assertions on namespace wiring in the chain. |

## See also

- [`counter-bot`](../counter-bot/README.md) — the pluggable-state
  walkthrough on the same console service.
- [`websocket-bot`](../websocket-bot/README.md) — the same echo shape over
  a real websocket, and the mapping-wiring walkthrough.
