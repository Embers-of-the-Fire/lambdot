# lambdot

A stateless, serverless, non-context-aware chatbot framework. For chatbots like
Discord bots and Twitter bots — not LLM agents. The core is a pure composition
runtime that owns nothing conversational; everything else — inputs, outputs,
state backends, features — is a plugin, composed through TypeScript's type
system.

## Quickstart

```console
$ nub install
$ nub examples/echo-bot/index.ts     # the echo bot: type a line, get it echoed
```

## Concepts

```
┌──────────────┐  Stream<Message>  ┌────────────────────────────────────┐
│ input plugin │──────────────────▶│ feature plugins (mapStream/merge)  │
│ (console)    │                   │   state backends as namespaces     │
└──────────────┘                   │        ↓ Stream<Command>           │
┌──────────────┐   pumpStream      │   filtered by address.platform     │
│ output plugin│◀──────────────────│                                    │
│ (console)    │                   └────────────────────────────────────┘
└──────────────┘                    Kernel — stateless, owns nothing
```

- **A plugin is a function.** `apply(input, scope, config)` maps a declared
  input record to an output value. No roles, no lifecycle hooks:
  `scope.onDispose(d)` collects teardown (run in reverse on stop),
  `scope.onError(e)` sinks background errors, and config is validated through
  any Standard Schema validator.
- **Composition is function application.** `use(plugin, { mapping, option,
as })` feeds a plugin from the namespaces visible so far and exposes its
  output on `ctx` under its name; `bind` keeps the output internal to the
  chain (visible to later `mapping`s only). `mapping` is omitted when the
  plugin's input keys already match — identity wiring — and referencing a
  not-yet-composed namespace inside one is a compile error (see
  `examples/echo-bot/type-test.ts` and `examples/websocket-bot/type-test.ts`).
- **Streams are the message-flow primitive.** `Stream<T>` is an
  `AsyncIterable` with broadcast semantics — every consumer sees every item,
  in order, at its own pace. Inputs push from callbacks through `channel()`
  and `shareStream`; features transform with `mapStream` / `filterStream` /
  `mergeStreams`; outputs consume command streams with `pumpStream`.
- **The envelope carries no platform semantics** (no `inReplyTo`). `Message`
  is `payload` + `address`; `Command` is `address` + `content`; each platform
  defines its own address type, and `address.platform` routes replies — a
  command stream serving two platforms is filtered per output in the wiring
  `mapping`.
- **State is a plugin.** Backends implement `StateBackend`; a state plugin
  emits one as its namespace value, and a feature declares the backend in its
  input and builds a typed, namespaced accessor with
  `createStateAccessor(backend, name)`.
- **Platform services are ordinary namespace values.** A REST client, a
  webhook handler, a database connection — anything a plugin emits lands on
  `ctx` (or stays internal via `bind`) with its type intact (see
  `examples/websocket-bot`).

## Writing a plugin

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
    .use(cli.lines) // exposes ctx["console/lines"]
    .use(echo) // identity wiring: the input keys already match
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });

await kernel.start();
```

Each stream consumer processes items sequentially, so read-modify-write
against plugin state inside a `mapStream` mapper is race-free.

## Repository layout

Packages live at `packages/<category>/<name>`, grouped by the role they play
in the plugin ecosystem:

- **`core/`** — the kernel and the platform-agnostic behaviors shipped with
  the framework. The `console` package is the reference chat platform (a
  terminal needs no external service); `websocket` is generic transport
  machinery — it owns the socket lifecycle and defers everything
  chat-specific to a `WsSpec` supplied by its consumers, so it is a core
  behavior, not a chat platform; `env` reads variables from `process.env`
  into a typed namespace.
- **`protocol/`** — chat-service wire protocols (planned: `discord`, ...).
  A protocol package supplies one chat service's address type, stream
  contracts, and frame codec, riding a core transport such as
  `@lambdot/websocket`. `qq` serves both QQ bot infras — the websocket
  gateway and the webhook (reversed post) — over one REST client.
  (Not `schema/`: "schema" in this codebase means
  Standard-Schema config validation.)
- **`host/`** — hosting/runtime integrations: packages that embed a
  composition into the environment it runs in. `cloudflare` provides a
  worker's named bindings (KV namespaces, D1 databases, R2 buckets, Durable
  Object namespaces) as typed namespace values, plus bridges that serve a
  `StateBackend` from a KV namespace or Durable Object storage, and `wsHub`,
  the server-side (Durable Object) mirror of `wsTransport`. (Not
  `platform/`: "platform" in the framework already denotes the chat service
  an address belongs to — `Address.platform`.)
- **`state/`** — `StateBackend` implementations.

Published package names stay self-describing (`@lambdot/state-memory`,
`@lambdot/host-cloudflare`, future `@lambdot/protocol-discord`); npm
has no category directories. Only core members keep framework-level names.

| Path                          | Package                    | Role                                                  |
| ----------------------------- | -------------------------- | ----------------------------------------------------- |
| `packages/core/core`          | `@lambdot/core`            | kernel: plugins, composition, streams, wire types     |
| `packages/core/console`       | `@lambdot/console`         | console platform (`consolePlatform` bundle)           |
| `packages/core/websocket`     | `@lambdot/websocket`       | websocket transport (`wsPlatform` bundle)             |
| `packages/core/env`           | `@lambdot/env`             | `process.env` variables as a typed namespace          |
| `packages/protocol/qq`        | `@lambdot/protocol-qq`     | qq protocol: gateway + webhook infras, REST api       |
| `packages/state/memory`       | `@lambdot/state-memory`    | in-memory `StateBackend` (reference backend)          |
| `packages/state/sqlite`       | `@lambdot/state-sqlite`    | `node:sqlite` connection as a namespace value         |
| `packages/host/cloudflare`    | `@lambdot/host-cloudflare` | worker bindings: KV/D1/R2/DO namespaces + state + hub |
| `examples/echo-bot`           | —                          | echo bot and compile-time type tests                  |
| `examples/counter-bot`        | —                          | counting bot: the pluggable-state walkthrough         |
| `examples/websocket-bot`      | —                          | websocket bot: the transport-wiring walkthrough       |
| `examples/dual-websocket-bot` | —                          | two tagged websocket platforms in one composition     |
| `examples/multi-kernel-bot`   | —                          | two compositions, one supervisor, an explicit bridge  |
| `examples/cloudflare-bot`     | —                          | worker bot: hono + KV bindings under miniflare        |
| `examples/durable-object-bot` | —                          | DO bot: websocket rooms + DO state under miniflare    |
| `examples/multi-echo-bot`     | —                          | one echo feature serving console + websocket          |
| `examples/qq-gateway-bot`     | —                          | qq bot over the websocket gateway (fake platform)     |
| `examples/qq-webhook-bot`     | —                          | qq bot over hono-served webhooks (fake platform)      |

## Scripts

| Command                                      | Action                                                               |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `nub run lint`                               | lint with oxlint — type-aware, subsumes `tsc --noEmit` (`typeCheck`) |
| `nub run fmt`                                | format with oxfmt (`fmt:check` to verify)                            |
| `nub run -F @lambdot-example/echo-bot start` | run the echo bot                                                     |

## License

Dual-licensed under [Apache-2.0](LICENSE-APACHE) and [MIT](LICENSE-MIT).
