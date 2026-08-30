# @lambdot/host-cloudflare

A Cloudflare host integration: it embeds a composition into a worker by
turning the worker's `env` — named KV namespaces, D1 databases, R2 buckets,
Durable Object namespaces, and plain environment variables — into typed
namespace values that feature plugins consume through the composition's
visible context, plus state bridges that serve a `StateBackend` from a KV
namespace or a Durable Object's own storage, and a server-side websocket hub
for Durable Objects. The package is dependency-free (only
`@lambdot/core`): the binding types are structural subsets of
`@cloudflare/workers-types`, so real bindings from a worker's `env` are
assignable as-is, and anything Cloudflare adds beyond them stays available
through the consumer's own types.

## Bindings as namespaces

Cloudflare bindings are named — a worker binds several KV namespaces, D1
databases, R2 buckets, and Durable Object namespaces under distinct names —
so each provider factory takes its name as a parameter and instances
multiply: compose `kvNamespace("sessions")` and `kvNamespace("cache")` side
by side, exactly like `wsTransport` in `@lambdot/websocket`. Wiring a
consumer before the provider it consumes is a compile error (the `mapping`
parameter is typed as the namespaces visible so far), and `ctx.<name>` reads
back typed with no casts. The config is just the binding as it arrives on
the fetch handler's `env` argument, passed via `option`:
`{ binding: env.SESSIONS }`.

`envVars` is the Cloudflare counterpart of `envVars` in `@lambdot/env` —
workers have no `process.env`, so plain vars and secrets arrive on `env`
next to the resource bindings. Its config is `{ source: env }`; it reads
the listed keys and emits them as a `Readonly<Record<TKey, string>>` under
the name. A missing, empty, or non-string variable throws at start, so a
misconfigured deployment surfaces before any consumer activates.

## The KV state bridge

`kvState(name)` bridges a KV namespace provided by `kvNamespace` into the
framework's pluggable state shape: it consumes `{ kv: KVNamespace }` (wire
it through a `mapping` from the `kvNamespace` namespace), wraps the
namespace in a `StateBackend`, and emits it — typically under `"state"`, so
feature plugins reach it by declaring `{ state: StateBackend }` in their
input and building a typed view with `createStateAccessor(backend, name)`.
Values are stored as JSON under `<plugin-namespace>:<key>`. KV expiries are
whole seconds with a 60-second minimum, so a plugin's `ttlMs` is rounded up
and clamped to that floor.

## Durable Objects

Three pieces cover Durable Objects, one per place the runtime surfaces
them:

- `durableObjectNamespace(name)` is the binding provider for the worker
  side: `{ binding: env.ROOM }` via `option`, emitted under `name` exactly
  like the KV/D1/R2 providers. Routing to an instance stays in the fetch
  handler — `ctx.rooms.get(ctx.rooms.idFromName(name)).fetch(request)`.
- `doState()` is the per-instance counterpart of `kvState`: a Durable
  Object's transactional storage arrives on its constructor state rather
  than on `env` (and each instance has exactly one), so it is passed to the
  composition as config — `.bind(doState(), { option: { storage } })` — and
  emitted under `"state"`, so feature plugins reach it by declaring
  `{ state: StateBackend }` in their input (identity wiring). Values are
  structured-cloneable (no JSON round trip) and there is no TTL, since
  Durable Object storage has no expiry mechanism.
- `wsHub(name)` is the server-side mirror of `wsTransport` in
  `@lambdot/websocket`: instead of dialing out, the Durable Object accepts
  incoming sockets. It returns a bundle — the hub the fetch handler accepts
  `WebSocketPair` server ends into, and the plugin emitting that hub under
  `name` — with the exact `WsConnection` shape, so the generic
  `wsInput`/`wsOutput` halves (a `wsPlatform` bundle minus its transport)
  drive it unchanged, wired by `mapping: (ctx) => ({ connection: ctx.room })`.
  Where the transport owns one client socket, the hub
  fans out: `send` broadcasts to every accepted socket, `onMessage`
  receives from any of them. Create the hub per Durable Object instance,
  never at module level — it keeps sockets and listeners in closures, and
  co-resident instances share the isolate's module scope, so module-level
  instances would cross-wire two rooms. Hold the hub in instance state and
  boot the composition lazily in `fetch()` with `request.url`.

## Usage

From a worker's fetch handler — boot the composition once per isolate and
reuse it (`start` is idempotent):

```ts
import type { StateBackend } from "@lambdot/core";
import { createKernel, createStateAccessor, definePlugin } from "@lambdot/core";
import type { KVNamespace } from "@lambdot/host-cloudflare";
import { envVars, kvNamespace, kvState } from "@lambdot/host-cloudflare";

// Declared as a `type` (not an `interface`) so the whole object stays
// assignable to EnvVarsConfig["source"] — interfaces get no implicit
// index signature.
type Env = {
    readonly PING_DEFAULT_MESSAGE: string;
    readonly PINGS: KVNamespace;
};

const pingPong = definePlugin({
    name: "ping-pong",
    apply(input: { state: StateBackend }) {
        const state = createStateAccessor<{ count: number }>(input.state, "ping-pong");
        // ...
    },
});

function createBot(env: Env) {
    return (
        createKernel()
            .use(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { option: { source: env } })
            .bind(kvNamespace("pings"), { option: { binding: env.PINGS } })
            .bind(kvState("state"), { mapping: (ctx) => ({ kv: ctx.pings }) })
            // identity wiring: the bound "state" namespace feeds ping-pong
            .use(pingPong)
    );
}
```

Consumers read `bot.ctx["bot-env"].PING_DEFAULT_MESSAGE` and
`bot.ctx["ping-pong"]` typed through the composition; `bind` keeps the KV
binding and the state backend internal to the chain (visible to `mapping`s,
absent from the final `ctx`).

## API

Providers — each emits the binding (or snapshot) under its name:

| Export                         | Config                         | Emits                                 |
| ------------------------------ | ------------------------------ | ------------------------------------- |
| `kvNamespace(name)`            | `KVNamespaceConfig`            | `KVNamespace` under `name`            |
| `d1Database(name)`             | `D1DatabaseConfig`             | `D1Database` under `name`             |
| `r2Bucket(name)`               | `R2BucketConfig`               | `R2Bucket` under `name`               |
| `envVars(name, keys)`          | `EnvVarsConfig`                | `Readonly<Record<TKey, string>>`      |
| `durableObjectNamespace(name)` | `DurableObjectNamespaceConfig` | `DurableObjectNamespace` under `name` |
| `kvState(name)`                | none                           | `StateBackend` under `name`           |
| `doState()`                    | `DoStorageConfig`              | `StateBackend` under `"state"`        |
| `wsHub(name)`                  | `WsHubConfig`                  | `WebSocketHub` under `name`           |

All configs are `{ binding: env.X }`-style (`EnvVarsConfig` is
`{ source: env }`, `DoStorageConfig` is `{ storage }`) and are passed via
`option`, which is required since the config types are non-void. `kvState`
takes no config but declares `{ kv: KVNamespace }` as its input — wire it
with a `mapping`. `wsHub` additionally returns the `hub` control face the
fetch handler accepts sockets into.

Binding types (`KVNamespace`, `D1Database`, `R2Bucket`,
`DurableObjectNamespace`, `DurableObjectState` and their result/option
types) are re-exported from `src/bindings.ts`.

See [examples/cloudflare-bot](../../../examples/cloudflare-bot) for a
complete worker — hono + a KV-backed counter running under miniflare — and
[examples/durable-object-bot](../../../examples/durable-object-bot) for the
Durable Object half: a websocket chat room per DO instance, driven by
`wsHub` + `doState` under miniflare.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
