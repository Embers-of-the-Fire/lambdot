# echo-bot

The minimal lambdot bot: the console platform plus one feature plugin that
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

1. **The minimal plugin chain.** `consolePlatform()` (from
   `@lambdot/console`) is a bundle of two plugins — `lines`, which emits
   each stdin line as a `Stream<ConsoleLine>`, and `printer`, which consumes
   a stream of reply commands and writes them to the terminal. One feature
   plugin on top makes a bot.
2. **A plugin is a function.** `echo` declares its input as a record —
   `{ "console/lines": Stream<ConsoleLine> }` — and its `apply` maps that
   input to an output value: a stream of reply commands built with
   `mapStream`. There is no dispatch machinery to hook into: messages are
   streams, and each envelope carries its own return `address`.
3. **Identity wiring vs. mapping.** `.use(echo)` needs no wiring options:
   its input keys already match the namespaces visible in the chain. The
   printer's declared input key is `replies`, so it gets a `mapping` —
   `(ctx) => ({ replies: ctx.echo })` — a function from the namespaces
   visible so far to the plugin's declared input. Wiring out of order is a
   compile error, because the mapping's parameter is typed as exactly what
   is visible at that point in the chain.
4. **`use` vs. `bind`.** The printer is `bind`ed: its (void) output is
   internal wiring, hidden from the final `ctx`. The message and reply
   streams are `use`d, so they are exposed under their plugin names —
   `kernel.ctx["console/lines"]`, `kernel.ctx.echo`.
5. **Stateless by default.** No state plugin is composed, so no `state`
   namespace exists. State is opt-in; see
   [`counter-bot`](../counter-bot/README.md) for the same console platform
   with a state backend added.

## The plugin chain

```ts
import { consolePlatform, type ConsoleLine } from "@lambdot/console";
import type { Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { "console/lines": Stream<ConsoleLine> }) {
        return mapStream(input["console/lines"], (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

const cli = consolePlatform();

const kernel = createKernel()
    .use(cli.lines)
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });

await kernel.start();
```

`definePlugin({ name, apply })` declares what the feature consumes (its
input record type) and what it emits (the `apply` return type). The name
becomes the namespace key the output is exposed under once composed.

## type-test.ts

`type-test.ts` is a compile-time check on the composition types: it
composes the console platform with the echo plugin exactly like
`index.ts` does, then asserts how the namespaces are wired — the exposed
namespaces read back with their declared stream types on `kernel.ctx`,
a `bind`ed plugin is hidden from the final ctx, identity wiring only
compiles when the declared input is already visible (otherwise the
`mapping` becomes a required argument), mappings are checked against
the namespaces visible at that point in the chain with compatible
types, and duplicate namespaces are rejected. The file is in this
package's `tsconfig.json`, so it runs with the per-project typecheck
(`npx tsc -p examples/echo-bot`), and the root `nub run lint` is
type-aware as well.
[`websocket-bot/type-test.ts`](../websocket-bot/type-test.ts) mirrors
these assertions through the generic `@lambdot/websocket` factories,
plus required options and two platforms side by side.

## File layout

| File           | Role                                                      |
| -------------- | --------------------------------------------------------- |
| `index.ts`     | The bot: one echo feature on the console platform.        |
| `type-test.ts` | Compile-time assertions on namespace wiring in the chain. |

## See also

- [`counter-bot`](../counter-bot/README.md) — the pluggable-state
  walkthrough on the same console platform.
- [`websocket-bot`](../websocket-bot/README.md) — the same echo shape over
  a real websocket, and the mapping-wiring walkthrough.
