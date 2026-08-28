# lambdot

A stateless, serverless, non-context-aware chatbot framework. For chatbots like
Discord bots and Twitter bots — not LLM agents. The core is a pure event
pipeline that owns nothing conversational; everything else — inputs, outputs,
state backends, features — is a plugin, composed through TypeScript's type
system.

## Quickstart

```console
$ nub install
$ nub examples/echo-bot/index.ts     # the echo bot: type a line, get it echoed
```

## Concepts

```
┌────────────┐   BotEvent    ┌───────────────────────────────────────┐
│  BotInput  │──────────────▶│  bot/ingress waterfall (middleware)   │
│ (console)  │               │   → per-kind dispatch                 │
└────────────┘               │   → plugin handlers                   │
                             │        ctx.state (typed, opt-in)      │
┌────────────┐  ctx.send()   │        ctx.send(event.address, ...)   │
│ BotOutput  │◀──────────────│                                       │
│ (console)  │               └───────────────────────────────────────┘
└────────────┘                 Kernel — stateless, owns nothing
```

- **Plugins are effects, no lifecycle hooks.** `apply(ctx, config)` returns
  disposers; the plugin's fiber runs them on unload. Config is validated
  through any Standard Schema validator.
- **`inject`, not boot order.** A plugin listing `inject: ["state"]` stays
  pending until something provides `state`, and unloads if it goes away.
  Declaring the need as a typed capability (`TInjects`) additionally makes
  registration order a compile-time concern and types the injected value on
  the plugin's context (see `examples/websocket-bot`).
- **The event bus is the only message-flow primitive.** `emit` / `parallel` /
  `serial` for observation, `waterfall` for middleware — authentication,
  logging, and filtering are ordinary waterfall listeners on `bot/ingress`.
- **Outputs are fully typed contracts.** The core envelope carries no platform
  semantics (no `inReplyTo`). Each output platform declares its own
  address/content pair; `ctx.send(address, content)` only compiles when the
  content matches the platform that owns the address.
- **State is a plugin.** Backends implement `StateBackend`; plugins declare a
  schema and get a typed, namespaced accessor via `ctx.state.for(name)`.
  With no schema declared, `ctx.state` doesn't typecheck.
- **Generic folding.** `createKernel().use(...)` accumulates event kinds,
  output contracts, typed capabilities (`TProvides`/`TInjects`, folded as
  `TCaps`), and state schemas into the kernel's type parameters. Registering
  a plugin before the inputs/outputs it needs or the capabilities it injects
  is a compile error (see `examples/echo-bot/type-test.ts` and
  `examples/websocket-bot/type-test.ts`). Untyped, string-only `inject` stays
  runtime-gated.

## Writing a plugin

```ts
import { definePlugin } from "@lambdot/core";
import type { ConsoleEvents } from "@lambdot/input-console";
import type { ConsoleOutputs } from "@lambdot/output-console";

const echo = definePlugin<ConsoleEvents, ConsoleOutputs>({
    name: "echo",
    apply(ctx) {
        return ctx.on("console.line", (event) => ctx.send(event.address, `echo: ${event.payload}`));
    },
});
```

Events are processed sequentially in ingestion order, so read-modify-write
against plugin state within an event handler is race-free.

## Repository layout

| Path                      | Package                   | Role                                            |
| ------------------------- | ------------------------- | ----------------------------------------------- |
| `packages/core`           | `@lambdot/core`           | kernel: effects, event bus, fibers, fold types  |
| `packages/input-console`  | `@lambdot/input-console`  | stdin `BotInput` (reference input)              |
| `packages/output-console` | `@lambdot/output-console` | stdout `BotOutput` (reference output)           |
| `packages/state-memory`   | `@lambdot/state-memory`   | in-memory `StateBackend` (reference backend)    |
| `examples/echo-bot`       | —                         | echo bot and compile-time type tests            |
| `examples/counter-bot`    | —                         | counting bot: the pluggable-state walkthrough   |
| `examples/websocket-bot`  | —                         | websocket bot: the typed-capability walkthrough |

## Scripts

| Command                                      | Action                                                               |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `nub run lint`                               | lint with oxlint — type-aware, subsumes `tsc --noEmit` (`typeCheck`) |
| `nub run fmt`                                | format with oxfmt (`fmt:check` to verify)                            |
| `nub run -F @lambdot-example/echo-bot start` | run the echo bot                                                     |

## License

Dual-licensed under [Apache-2.0](LICENSE-APACHE) and [MIT](LICENSE-MIT).
