# lambdot

A composition model for dataflow dependencies, in the same spirit that Nix
is a definition model for systems: **a system is described by an immutable,
stateless definition, and the description itself is composable.** The model
recognizes exactly one concept — the **plugin** — and exactly one mechanism —
**context injection**, in two forms, `use` and `with`. Composing two plugins
yields a plugin; the dependency tree of an application _is_ a plugin.

## Quickstart

```console
$ nub install
$ nub examples/echo-bot/index.ts     # the echo bot: type a line, get it echoed
```

## Concepts

- **A plugin is a processor of a given context.** `apply(input, scope,
config)` reads a context — a record from namespaces to arbitrary values —
  and produces an **item map**. It is a definition, not a process:
  immutable, stateless, composable.
- **Context injection is the only composition mechanism.** `A.use(B)` grants
  B the context A has accumulated (declaration order is observable);
  `A.with(B)` grants B a blank context (hermetic). Both inject B's item map
  into A's context under a namespace and return a new plugin, leaving A
  unchanged. Wiring — `mapping`, `option`, `as` — is declared at the
  composition site, never inside the dependency, and is checked by the type
  system (see `examples/echo-bot/type-test.ts` and
  `examples/websocket-bot/type-test.ts`).
- **Item maps are plain services.** A console is `{ onLine, print }`; a
  websocket connection is `{ push, listen }`; a store is a `Map`, a
  `DatabaseSync`, or a KV namespace. Features declare what they read as
  their input type and call methods directly — there is no envelope, no
  stream machinery, no framework state contract.
- **Execution is application; the caller owns the scope.** There is no
  running instance, no start, no stop: `createScope()` +
  `plugin.apply(ctx, scope, config)`. Plugins register disposers on the
  scope (run LIFO on `scope.dispose()`) and report background errors to it.
- **Concerns are plugins.** Logging, error routing, state backends,
  transports — ordinary plugins; the core reserves no hooks for them.
  Diagnostics follow the abstract/handler pattern: a plugin declares an
  optional sink in its input contract and emits only when one is wired in.

## Writing a plugin

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
    .with(consoleIo(), { option: {} }) // hermetic: a terminal observes nothing
    .use(echo); // identity wiring: the input keys already match

const scope = createScope();
await app.apply(undefined, scope, undefined);
// ... later: await scope.dispose();
```

## Repository layout

Packages live at `packages/<category>/<name>`, grouped by the role they play
in the plugin ecosystem:

- **`core/`** — the model and the platform-agnostic services shipped with
  the framework. The `console` package is stdin/stdout processing (a
  terminal needs no external service); `websocket` re-exports a socket
  connection to the context (`push`/`listen`) and owns its lifecycle;
  `http` is the structural HTTP-server contract consumers register routes
  against; `env` reads
  variables from `process.env` into a typed namespace; `logging` supplies
  the `Logger` hook and plain-function sinks.
- **`protocol/`** — wire protocols riding the core services. `qq` is a
  webhook post handler composed on `@lambdot/http`, plus the QQ REST
  client. (Not `schema/`: "schema" in this codebase means Standard-Schema
  config validation.)
- **`host/`** — hosting/runtime integrations: packages that embed a
  composition into the environment it runs in. `cloudflare` provides a
  worker's named bindings (KV namespaces, D1 databases, R2 buckets, Durable
  Object namespaces) as typed item-map values, plus `doStorage` and
  `wsHub`, the server-side (Durable Object) mirror of `wsConnection`;
  `hono` hands a hono app into the composition as the HTTP surface.
- **`state/`** — state providers: a plain per-application `Map`, a
  `node:sqlite` connection.

Published package names stay self-describing (`@lambdot/state-memory`,
`@lambdot/host-cloudflare`, future `@lambdot/protocol-discord`); npm
has no category directories. Only core members keep framework-level names.

| Path                          | Package                    | Role                                                       |
| ----------------------------- | -------------------------- | ---------------------------------------------------------- |
| `packages/core/core`          | `@lambdot/core`            | the model: plugins, `use`/`with`, scopes, config schemas   |
| `packages/core/console`       | `@lambdot/console`         | stdin/stdout service (`consoleIo`)                         |
| `packages/core/websocket`     | `@lambdot/websocket`       | websocket connection as a service (`wsConnection`)         |
| `packages/core/http`          | `@lambdot/http`            | structural `HttpServer` contract for hosts and protocols   |
| `packages/core/env`           | `@lambdot/env`             | `process.env` variables as a typed namespace               |
| `packages/core/logging`       | `@lambdot/logging`         | `Logger` hook + plain-function sinks                       |
| `packages/protocol/qq`        | `@lambdot/protocol-qq`     | qq webhook protocol + REST api                             |
| `packages/state/memory`       | `@lambdot/state-memory`    | a plain `Map`, fresh per application                       |
| `packages/state/sqlite`       | `@lambdot/state-sqlite`    | `node:sqlite` connection as an item-map value              |
| `packages/host/cloudflare`    | `@lambdot/host-cloudflare` | worker bindings: KV/D1/R2/DO namespaces + storage + hub    |
| `packages/host/hono`          | `@lambdot/host-hono`       | a hono app as the composition's HTTP surface               |
| `examples/echo-bot`           | —                          | echo bot and compile-time type tests                       |
| `examples/counter-bot`        | —                          | counting bot: the pluggable-state walkthrough              |
| `examples/websocket-bot`      | —                          | websocket bot: the connection-wiring walkthrough           |
| `examples/dual-websocket-bot` | —                          | two websocket connections in one composition               |
| `examples/multi-bot`          | —                          | one bot definition composed twice, an explicit bridge      |
| `examples/cloudflare-bot`     | —                          | worker bot: hono + KV bindings under miniflare             |
| `examples/durable-object-bot` | —                          | DO bot: websocket rooms + instance storage under miniflare |
| `examples/multi-echo-bot`     | —                          | one echo feature serving console + websocket               |
| `examples/qq-webhook-bot`     | —                          | qq bot over hono-served webhooks (fake platform)           |

## Scripts

| Command                                      | Action                                                               |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `nub run lint`                               | lint with oxlint — type-aware, subsumes `tsc --noEmit` (`typeCheck`) |
| `nub run fmt`                                | format with oxfmt (`fmt:check` to verify)                            |
| `nub run test`                               | run every package's `node --test` suite                              |
| `nub run -F @lambdot-example/echo-bot start` | run the echo bot                                                     |

## License

Dual-licensed under [Apache-2.0](LICENSE-APACHE) and [MIT](LICENSE-MIT).
