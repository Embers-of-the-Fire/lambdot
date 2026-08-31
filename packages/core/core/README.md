# @lambdot/core

The lambdot kernel: a stateless, serverless, non-context-aware composition
runtime for chatbots. It owns no conversational data and no platform
semantics — inputs, outputs, state backends, and features are all plugins,
composed through TypeScript's type system. A plugin is a function:
`apply(input, scope, config)` maps a declared input record to an output
value. Every `use(...)`/`bind(...)` wires the next plugin's input with a
`mapping` from the namespaces visible so far, so wiring a plugin before its
dependencies is a compile error. Published on npm as `@lambdot/core`.

## Concepts

- **A plugin is a function.** `apply(input, scope, config)` receives exactly
  the input record it declares and returns the output value it emits. There
  are no plugin roles and no lifecycle hooks: `scope.onDispose(d)` collects
  teardown (run in reverse on `stop()`), `scope.onError(e)` sinks background
  errors. Config is validated through any Standard Schema validator
  (`Config`), with failures surfacing as `ConfigValidationError`.
- **Composition is function application.** `use(plugin, { mapping, option,
as })` feeds a plugin from the namespaces visible so far and exposes its
  output on the final `ctx` under its name. `bind(...)` feeds it the same
  way but keeps the output internal to the chain — visible to later
  `mapping`s, absent from `ctx`. `mapping` is omitted when the plugin's
  input keys already match visible namespaces (identity wiring); `option`
  carries config, required exactly when the config type is non-void; `as`
  renames the namespace.
- **Streams are the message-flow primitive.** `Stream<T>` is an
  `AsyncIterable` with broadcast semantics — every consumer sees every item,
  in order, at its own pace. Inputs push from callbacks through `channel()`
  and emit a `shareStream` view; features transform with
  `mapStream`/`filterStream`/`mergeStreams`; outputs consume command streams
  with `pumpStream`. A feature handling two platforms merges their streams;
  a command stream serving two platforms is filtered per output by
  `address.platform` in the wiring `mapping`.
- **The envelope is free of platform semantics.** `Message` is `payload` +
  `address` (+ `id`/`at`, minted by `message()`); `Command` is `address` +
  `content`. `address` is opaque to the core and meaningful only to the
  platform that produced it.
- **Platform-specific services are ordinary namespace values.** A REST
  client, a webhook handler, a database connection — anything a plugin emits
  lands on `ctx` (or stays internal via `bind`) with its type intact.
- **State is a plugin.** The core is stateless; a state plugin emits a
  `StateBackend` as its namespace value, and a stateful feature declares the
  backend in its input and builds a typed accessor namespaced to its own
  name via `createStateAccessor(backend, name)`.
- **Activation order is definition order.** `start()` activates in
  composition order — resolve mapping, validate config, `apply` — and
  `stop()` disposes in reverse. Ordering mistakes are compile errors in the
  mappings, not runtime states.
- **`expose(name)` seals a chain into a final engine.** The engine is the
  chain as an artifact: named, runnable (`start`/`stop`/`ctx`), and wireable
  into a supervisor kernel under its new name — but no longer composable
  (`use`/`bind` are gone from the type and throw at runtime). Its type is
  exactly `Engine<TIn, TVisible, TName>`: the chain's external input
  requirement survives, while the `bind`-encapsulated internals and the
  chain's own name are erased. This is how N instances of one bot stack nest
  into a supervisor without name tags or leaked internals.

## Usage

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
    .use(cli.lines) // exposes ctx["console/lines"]: Stream<ConsoleLine>
    .use(echo) // identity wiring: the input keys already match
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });

await kernel.start();
process.on("SIGINT", () => void kernel.stop().then(() => process.exit(0)));
```

`use(cli.lines)` exposes the line stream under `"console/lines"`. `use(echo)`
needs no `mapping`: its declared input `{ "console/lines": ... }` is already
satisfied by the visible ctx. The printer declares `{ replies: ... }`, which
no namespace provides — so the `mapping` is required, and its `ctx`
parameter is typed as exactly what's visible so far; referencing a
not-yet-composed namespace is a compile error. The printer is `bind`ed, so
`ctx["console/printer"]` does not typecheck.

## API overview

Runtime values:

| Export                               | What it is                                                               |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `createKernel(options?)`             | Creates an empty composition; `options.onError` sinks background errors. |
| `definePlugin(spec)`                 | Authors a plugin from `{ name, Config?, apply }`.                        |
| `message(payload, address)`          | Mints a `Message` envelope with a fresh `id`/`at`.                       |
| `channel()`                          | Push-side bridge from callbacks into the pull world.                     |
| `shareStream(stream)`                | Multicasts a stream to any number of consumers.                          |
| `mapStream`                          | Per-item transform (async mapper allowed; items stay sequential).        |
| `filterStream`                       | Per-item filter; the type-guard form narrows the item type.              |
| `mergeStreams`                       | Interleaves several streams in arrival order.                            |
| `pumpStream`                         | Background sequential consumer; errors go to `onError`.                  |
| `createStateAccessor(backend, name)` | Typed, namespaced view over a `StateBackend`.                            |
| `ConfigValidationError`              | Thrown when a plugin's `Config` schema rejects its config.               |

Types, grouped by theme:

- **Messages** — `Message` (the inbound envelope: `payload`, `address`,
  `id`, `at`), `Command` (the outbound pair: `address`, `content`),
  `Address` (the `platform` routing tag).
- **Streams** — `Stream`, `Channel`.
- **Plugins** — `Plugin` (name, `Config`, `apply`, plus the composition
  methods), `PluginSpec` (the author-facing half), `Scope` (`onDispose` /
  `onError`), `Composite` (a composed chain — itself wireable), `Engine`
  (a chain sealed by `expose`: final, named, internals erased), `AnyUnit`.
- **The composition types** — `InOf`, `OutOf`, `ConfigOf`, `NameOf`,
  `WireArgs` (the `use`/`bind` options: `mapping` required when identity
  wiring fails, `option` required when config is non-void, `as` to rename),
  `StartArgs`, `Kernel` (a `Composite` seeded empty).
- **Config** — `StandardSchemaV1` (structural copy of the Standard Schema v1
  interface; zod, valibot, arktype, … plug in with no runtime dependency).
- **State** — `StateBackend` (`get`/`set`/`delete` over namespace + key,
  optional `ttlMs`), `StateAccessor`.
- **Lifecycle** — `Disposer`.
- **Kernel options** — `KernelOptions`.

## Examples

The worked walkthroughs live in the repository's `examples/` directory:
`echo-bot` (the minimal bot above, plus compile-time composition tests in
`type-test.ts`), `counter-bot` (the pluggable-state walkthrough), and
`websocket-bot` (the transport-wiring walkthrough).

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
