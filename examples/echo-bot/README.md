# echo-bot

The minimal lambdot bot: the console platform plus one feature plugin that
echoes each line back. Also home of `type-test.ts`, the compile-time test
suite for the kernel's generic fold.

```console
$ printf 'hello world\nsecond line\n' | nub index.ts
echo: hello world
echo: second line
```

From the repo root, `nub run -F @lambdot-example/echo-bot start` gives an
interactive session instead (Ctrl-C to quit).

## What it demonstrates

1. **The minimal plugin chain.** `consolePlatform()` (from
   `@lambdot/console`) is a bundle of two plugins — an input that ingests
   each stdin line as a `console.line` event and an output that sends
   strings to the terminal. One feature plugin on top makes a bot.
2. **Typed output contracts.** The console output declares its own
   address/content pair (`ConsoleAddress` / `string`), and
   `ctx.send(event.address, ...)` only compiles when the content matches.
   Sending an object, or an address for a platform no output registered
   (say, `"discord"`), is a compile error — see `type-test.ts`.
3. **Registration order is a compile error, not a boot failure.** Each
   `.use(...)` folds event kinds and output contracts into the kernel's
   type parameters, so using `echo` before the console halves — with the
   input missing, or with only the output in place — is rejected by the
   compiler.
4. **Stateless by default.** No plugin here declares a state schema, so
   `ctx.state` doesn't typecheck. State is opt-in; see
   [`counter-bot`](../counter-bot/README.md) for the same console platform
   with a state backend added.

## The plugin chain

```ts
import { consolePlatform, type ConsoleEvents, type ConsoleOutputs } from "@lambdot/console";
import { createKernel, definePlugin } from "@lambdot/core";

const echo = definePlugin<ConsoleEvents, ConsoleOutputs>({
    name: "echo",
    apply(ctx) {
        return ctx.on("console.line", (event) => ctx.send(event.address, `echo: ${event.payload}`));
    },
});

const cli = consolePlatform();

const kernel = createKernel().use(cli.input).use(cli.output).use(echo);

await kernel.start();
```

`definePlugin<ConsoleEvents, ConsoleOutputs>` declares what the feature
consumes: the `console.line` event kind and the console send contract.
`apply` returns the listener's disposer — the plugin's fiber runs it on
unload; there are no lifecycle hooks to implement.

## type-test.ts

`type-test.ts` is the compile-time test suite: a file of expressions that
must typecheck interleaved with `@ts-expect-error` assertions that must
stay genuine errors. If a flagged line stops erroring, the typecheck
passes over a silent hole in the fold — do not "fix" the flagged
expressions; fix the types that stopped rejecting them. The file is in
this package's `tsconfig.json`, so it runs with the per-project typecheck
(`npx tsc -p examples/echo-bot`), and the root `nub run lint` is
type-aware as well.

The assertions mirror the guarantees above:

- `ctx.send` rejects content that doesn't match the platform's contract.
- `ctx.send` rejects addresses of platforms no output registered.
- `ctx.on` rejects event kinds no input registered.
- `ctx.state` is `NoStateDeclared` when no plugin declared a schema.
- `.use(echo)` before the console input — with or without the output —
  fails on the unregistered event kind and output contract.

## File layout

| File           | Role                                                   |
| -------------- | ------------------------------------------------------ |
| `index.ts`     | The bot: one echo feature on the console platform.     |
| `type-test.ts` | Compile-time assertions for the kernel's generic fold. |

## See also

- [`counter-bot`](../counter-bot/README.md) — the pluggable-state
  walkthrough on the same console platform.
- [`websocket-bot`](../websocket-bot/README.md) — the same echo shape
  over a real websocket, and the typed-capability walkthrough.
