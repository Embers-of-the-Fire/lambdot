# @lambdot/host-cloudflare

A Cloudflare host integration: it embeds a composition into a worker by
turning the worker's `env` — named KV namespaces, D1 databases, R2 buckets,
Durable Object namespaces, and plain environment variables — into typed
item-map values that feature plugins consume through the composition's
visible context, plus a Durable Object storage provider and a server-side
websocket hub for Durable Objects. The package is dependency-free (only
`@lambdot/core`): the binding types are structural subsets of
`@cloudflare/workers-types`, so real bindings from a worker's `env` are
assignable as-is, and anything Cloudflare adds beyond them stays available
through the consumer's own types.

## Bindings as item maps

Cloudflare bindings are named — a worker binds several KV namespaces, D1
databases, R2 buckets, and Durable Object namespaces under distinct names —
so each provider factory takes its name as a parameter and instances
multiply: compose `kvNamespace("sessions")` and `kvNamespace("cache")` side
by side. Wiring a consumer before the provider it consumes is a compile
error (the `mapping` parameter is typed as the namespaces visible so far),
and the injected value reads back typed with no casts. The config is just
the binding as it arrives on the fetch handler's `env` argument, passed via
`option`: `{ binding: env.SESSIONS }`.

`envVars` is the Cloudflare counterpart of `envVars` in `@lambdot/env` —
workers have no `process.env`, so plain vars and secrets arrive on `env`
next to the resource bindings. Its config is `{ source: env }`; it reads
the listed keys and emits them as a `Readonly<Record<TKey, string>>` under
the name. A missing, empty, or non-string variable throws at application
time, so a misconfigured deployment surfaces before any consumer applies.

State has no framework contract: a feature that needs storage declares the
binding itself in its input (`{ kv: KVNamespace }`, `{ db: D1Database }`)
and reads/writes it directly.

## Durable Objects

Three pieces cover Durable Objects, one per place the runtime surfaces
them:

- `durableObjectNamespace(name)` is the binding provider for the worker
  side: `{ binding: env.ROOM }` via `option`, emitted under `name` exactly
  like the KV/D1/R2 providers. Routing to an instance stays in the fetch
  handler — `items.rooms.get(items.rooms.idFromName(name)).fetch(request)`.
- `doStorage()` emits a Durable Object's own transactional storage as-is.
  The storage arrives on the Durable Object's constructor state rather than
  on `env` (and each instance has exactly one), so it is passed to the
  composition as config — `.with(doStorage(), { option: { storage } })` —
  and emitted under `"storage"`, so feature plugins reach it by declaring
  `{ storage: DurableObjectStorage }` in their input. Values are
  structured-cloneable (no JSON round trip) and there is no TTL, since
  Durable Object storage has no expiry mechanism.
- `wsHub(name)` is the server-side mirror of `wsConnection` in
  `@lambdot/websocket`: instead of dialing out, the Durable Object accepts
  incoming sockets. It returns a bundle — the hub the fetch handler accepts
  `WebSocketPair` server ends into, and the plugin emitting that hub under
  `name` — with the same connection shape (`push` broadcasts to every
  accepted socket, `listen` receives from any of them and returns a
  disposer). Create the hub per Durable Object instance, never at module
  level — it keeps sockets and listeners in closures, and co-resident
  instances share the isolate's module scope, so module-level instances
  would cross-wire two rooms. Hold the hub in instance state and apply the
  composition lazily in `fetch()` with `request.url`.

## Usage

From a worker's fetch handler — the worker originates the application: it
owns the scope, applies the composition once per isolate, and reads the
returned item map:

```ts
import { createScope, definePlugin } from "@lambdot/core";
import type { KVNamespace } from "@lambdot/host-cloudflare";
import { envVars, kvNamespace } from "@lambdot/host-cloudflare";

// Declared as a `type` (not an `interface`) so the whole object stays
// assignable to EnvVarsConfig["source"] — interfaces get no implicit
// index signature.
type Env = {
    readonly PING_DEFAULT_MESSAGE: string;
    readonly PINGS: KVNamespace;
};

const pingPong = definePlugin({
    name: "ping-pong",
    apply(input: { pings: KVNamespace }) {
        // read/write input.pings directly — no backend contract
        // ...
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) }).with(pingPong);

export default {
    async fetch(request: Request, env: Env) {
        const scope = createScope();
        const items = await app
            .with(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { option: { source: env } })
            .with(kvNamespace("pings"), { option: { binding: env.PINGS } })
            .apply({}, scope, undefined);
        // items["ping-pong"]: the feature's own item map
        // ...
    },
};
```

## API

Providers — each emits the binding (or snapshot) as its item map:

| Export                         | Config                         | Emits                                    |
| ------------------------------ | ------------------------------ | ---------------------------------------- |
| `kvNamespace(name)`            | `KVNamespaceConfig`            | `KVNamespace` under `name`               |
| `d1Database(name)`             | `D1DatabaseConfig`             | `D1Database` under `name`                |
| `r2Bucket(name)`               | `R2BucketConfig`               | `R2Bucket` under `name`                  |
| `envVars(name, keys)`          | `EnvVarsConfig`                | `Readonly<Record<TKey, string>>`         |
| `durableObjectNamespace(name)` | `DurableObjectNamespaceConfig` | `DurableObjectNamespace` under `name`    |
| `doStorage()`                  | `DoStorageConfig`              | `DurableObjectStorage` under `"storage"` |
| `wsHub(name)`                  | `WsHubConfig`                  | `WebSocketHub` under `name`              |

All configs are `{ binding: env.X }`-style (`EnvVarsConfig` is
`{ source: env }`, `DoStorageConfig` is `{ storage }`) and are passed via
`option`, which is required since the config types are non-void. `wsHub`
additionally returns the `hub` control face the fetch handler accepts
sockets into.

Binding types (`KVNamespace`, `D1Database`, `R2Bucket`,
`DurableObjectNamespace`, `DurableObjectState` and their result/option
types) are re-exported from `src/bindings.ts`.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
