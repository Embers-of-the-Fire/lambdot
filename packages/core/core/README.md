# @lambdot/core

The lambdot kernel: a stateless, serverless, non-context-aware event pipeline
for chatbots. It owns no conversational data and no platform semantics —
inputs, outputs, state backends, and features are all plugins, composed
through TypeScript's type system. Every `kernel.use(...)` folds the plugin's
contribution (event kinds, output contracts, typed capabilities, state
schemas) into the kernel's type parameters, so the context your plugins see
is computed from what you registered, and registering a plugin before its
dependencies is a compile error. Published on npm as `@lambdot/core`.

## Concepts

- **Plugins are effects.** `apply(ctx, config)` returns an `Effect` — a
  disposer, an iterable of disposers, or a promise of either. The plugin's
  fiber collects them and runs them on unload; there are no lifecycle hooks.
  Config is validated through any Standard Schema validator (`Config`), with
  failures surfacing as `ConfigValidationError`.
- **Plugins have three roles.** Input plugins produce events (only they get
  `ctx.ingest`), output plugins own a platform and its `send`, and feature
  plugins (`definePlugin`) are everything else — handlers, middleware, state,
  capability providers.
- **`inject`, not boot order.** A plugin listing `inject: ["state"]` stays
  `pending` until the capability is provided and unloads back to `pending`
  if it is withdrawn — activation order is derived from `inject`, never from
  boot sequencing. Typed capabilities (`TProvides`/`TInjects`) additionally
  make registration order a compile-time gate and type the injected value on
  the plugin's context; the runtime `inject` array is then restricted to
  exactly the declared names, so the two gates cannot drift apart.
- **The event bus is the only message-flow primitive.** `emit` is
  fire-and-forget, `parallel` awaits all listeners, `serial` awaits in order
  until one bails with a non-undefined value, and `waterfall` is
  around-middleware — each listener must call `next()` to delegate, and
  returning without it short-circuits the chain. Every ingested event passes
  through the reserved `INGRESS` (`"bot/ingress"`) waterfall first, so
  authentication, logging, and filtering are ordinary listeners.
- **Events are processed sequentially, in ingestion order.** One failing
  event rejects its own `ingest` caller but never jams the queue, so
  read-modify-write against plugin state inside a handler is race-free.
- **Outputs are fully typed contracts.** The core envelope (`BotEvent`) is
  deliberately free of platform semantics — no reply references, no channel
  vocabulary; `address` is opaque to the core and meaningful only to the
  output whose platform produced it. `ctx.send(address, content)` compiles
  only when the content matches the contract of the platform that owns the
  address, and is uncallable with no outputs registered.
- **State is a plugin.** The core is stateless; a state plugin is an
  ordinary feature plugin providing a `StateBackend` as the runtime-gated
  `"state"` capability (at most one active). A feature declares its schema
  as `TStateSchema` and gets a typed accessor namespaced to its plugin name
  via `ctx.state.for(name)`. With no schema declared anywhere, `ctx.state`
  folds to `NoStateDeclared` and does not typecheck.

## Usage

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
process.on("SIGINT", () => void kernel.stop().then(() => process.exit(0)));
```

`use(cli.input)` folds `ConsoleEvents` into the kernel, `use(cli.output)`
folds the console output contract, and only then does `use(echo)` typecheck
— `echo` declares it handles `console.line` and sends through the console
platform, and the fold must already satisfy both. `start()` activates every
plugin whose `inject` requirements are met (warning about ones left
pending); `stop()` disposes every active fiber in reverse registration
order.

## API overview

Runtime values:

| Export                   | What it is                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| `createKernel(options?)` | Creates an empty `Kernel`; `options.onError` sinks fire-and-forget errors. |
| `Kernel`                 | `ctx` (the typed fold), `use(plugin, config?)`, `start()`, `stop()`.       |
| `definePlugin(...)`      | Identity helper for authoring feature plugins with precise generics.       |
| `INGRESS`                | The reserved `"bot/ingress"` waterfall kind every ingested event crosses.  |
| `ConfigValidationError`  | Thrown when a plugin's `Config` schema rejects its config.                 |

Types, grouped by theme:

- **Events** — `BotEvent` (the envelope: `kind`, `payload`, `address`, `id`,
  `at`), `AnyBotEvent`, `EventDef`, `EventMap`, `Listener`, `NextFn`,
  `IngressListener`, `OnOptions` (`prepend` to run before ordinary
  registrations).
- **Contexts and contracts** — `ContextView` (the typed surface every plugin
  sees: `on`/`emit`/`parallel`/`serial`/`waterfall`, `send`, `state`,
  `provide`), `InputContext` (adds `ingest`), `Address`,
  `OutputContract`/`OutputContractMap`, `ContentFor`.
- **Plugins** — `PluginMeta` (shared `name`/`inject`/`provide`/`Config`),
  `InputPlugin`, `OutputPlugin`, `FeaturePlugin`, `AnyPlugin`.
- **The type-level fold** — `EventsOf`, `OutputsOf`, `StateOf`, `CapsOf`,
  `InjectsOf`, `ConfigOf`, `Spread`, `Validate` (the `use()` gate:
  `"unregistered event kinds"`, `"unregistered output platforms"`,
  `"unprovided capabilities"`, `"mismatched capability types"`).
- **Effects and fibers** — `Effect`, `EffectResult`, `Disposer`,
  `FiberState` (`"pending" | "activating" | "active" | "disposed"`).
- **Config** — `StandardSchemaV1` (structural copy of the Standard Schema v1
  interface; zod, valibot, arktype, … plug in with no runtime dependency).
- **State** — `StateBackend` (`get`/`set`/`delete` over namespace + key,
  optional `ttlMs`), `StateAccessor` (the typed, namespaced view),
  `StateView`.
- **Kernel options** — `KernelOptions`.

## Examples

The worked walkthroughs live in the repository's `examples/` directory:
`echo-bot` (the minimal bot above, plus compile-time fold tests in
`type-test.ts`), `counter-bot` (the pluggable-state walkthrough), and
`websocket-bot` (the typed-capability walkthrough).

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
