# @lambdot/host-cloudflare

A Cloudflare host integration: it embeds a kernel into a worker by turning
the worker's `env` — named KV namespaces, D1 databases, R2 buckets, Durable
Object namespaces, and plain environment variables — into typed capabilities
that feature plugins inject through the kernel's capability fold, plus
state bridges that serve `ctx.state` from a KV namespace or a Durable
Object's own storage, and a server-side websocket hub for Durable Objects.
The package is dependency-free (only
`@lambdot/core`): the binding types are structural subsets of
`@cloudflare/workers-types`, so real bindings from a worker's `env` are
assignable as-is, and anything Cloudflare adds beyond them stays available
through the consumer's own types.

## Bindings as capabilities

Cloudflare bindings are named — a worker binds several KV namespaces, D1
databases, R2 buckets, and Durable Object namespaces under distinct names —
so each provider factory
takes its capability name as a parameter and instances multiply: register
`kvNamespace("sessions")` and `kvNamespace("cache")` side by side and the
two fold as `KVCapability<"sessions"> & KVCapability<"cache">`, exactly like
`WsCapability` in `@lambdot/websocket`. Each provider declares its contract
as `TProvides`, so registering a consumer before the provider it injects is
a compile error, and `ctx.<name>` reads back typed with no casts. The
config is just the binding as it arrives on the fetch handler's `env`
argument: `{ binding: env.SESSIONS }`.

`envVars` is the Cloudflare counterpart of `envVars` in `@lambdot/env` —
workers have no `process.env`, so plain vars and secrets arrive on `env`
next to the resource bindings. It reads the listed keys and provides them
as a `Readonly<Record<TKey, string>>` under the capability name; a missing,
empty, or non-string variable throws at kernel start, so a misconfigured
deployment surfaces before any consumer activates.

## The KV state bridge

`kvState(capability)` bridges a KV capability provided by `kvNamespace`
into the framework's pluggable state slot: it injects the capability
(compile-time gated through the fold, runtime-gated via `inject`), wraps
the namespace in a `StateBackend`, and provides it as `"state"`, so feature
plugins reach it through `ctx.state.for(name)`. Values are stored as JSON
under `<plugin-namespace>:<key>`. KV expiries are whole seconds with a
60-second minimum, so a plugin's `ttlMs` is rounded up and clamped to that
floor.

## Durable Objects

Three pieces cover Durable Objects, one per place the runtime surfaces
them:

- `durableObjectNamespace(name)` is the binding provider for the worker
  side: `{ binding: env.ROOM }`, provided as `DoCapability<TCap>` exactly
  like the KV/D1/R2 providers. Routing to an instance stays in the fetch
  handler — `ctx.rooms.get(ctx.rooms.idFromName(name)).fetch(request)`.
- `doState()` is the per-instance counterpart of `kvState`: a Durable
  Object's transactional storage arrives on its constructor state rather
  than on `env` (and each instance has exactly one), so it is passed to
  the kernel factory and straight on as config — `.use(doState(), { storage })` —
  and provided as the framework's `"state"` slot. Values are
  structured-cloneable (no JSON round trip) and there is no TTL, since
  Durable Object storage has no expiry mechanism.
- `wsHub(name)` is the server-side mirror of `wsTransport` in
  `@lambdot/websocket`: instead of dialing out, the Durable Object accepts
  incoming sockets. It returns a bundle — the hub the fetch handler accepts
  `WebSocketPair` server ends into, and the plugin providing that hub under
  the capability name — with the exact `WsConnection` shape, so the generic
  `wsInput`/`wsOutput` halves (a `wsPlatform` bundle minus its transport)
  drive it unchanged. Where the transport owns one client socket, the hub
  fans out: `send` broadcasts to every accepted socket, `onMessage`
  receives from any of them. Create the hub (and the `wsPlatform` bundle)
  per Durable Object instance, never at module level — both keep sockets,
  listeners, and transport state in closures, and co-resident instances
  share the isolate's module scope, so module-level instances would
  cross-wire two rooms. Hold the hub in instance state and boot the kernel
  lazily in `fetch()` with `request.url`.

## Usage

From a worker's fetch handler — boot the kernel once per isolate and reuse
it (`start` is idempotent):

```ts
import { createKernel } from "@lambdot/core";
import type { KVNamespace } from "@lambdot/host-cloudflare";
import { envVars, kvNamespace, kvState } from "@lambdot/host-cloudflare";

// Declared as a `type` (not an `interface`) so the whole object stays
// assignable to EnvVarsConfig["source"] — interfaces get no implicit
// index signature.
type Env = {
    readonly PING_DEFAULT_MESSAGE: string;
    readonly PINGS: KVNamespace;
};

function createBot(env: Env) {
    return createKernel()
        .use(pingInput())
        .use(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { source: env })
        .use(kvNamespace("pings"), { binding: env.PINGS })
        .use(kvState("pings"))
        .use(pingPong); // injects "state"; ctx.state served from PINGS
}
```

Consumers read `bot.ctx["bot-env"].PING_DEFAULT_MESSAGE` and
`ctx.pings` typed through the fold; stateful plugins use `ctx.state`.

## API

Providers — each is a `FeaturePlugin` whose `apply` provides the binding
under its capability name:

| Export                         | Plugin name       | Capability                  | Config                         |
| ------------------------------ | ----------------- | --------------------------- | ------------------------------ |
| `kvNamespace(name)`            | `kv:<name>`       | `KVCapability<TCap>`        | `KVNamespaceConfig`            |
| `d1Database(name)`             | `d1:<name>`       | `D1Capability<TCap>`        | `D1DatabaseConfig`             |
| `r2Bucket(name)`               | `r2:<name>`       | `R2Capability<TCap>`        | `R2BucketConfig`               |
| `envVars(name, keys)`          | `env:<name>`      | `EnvCapability<TCap, TKey>` | `EnvVarsConfig`                |
| `durableObjectNamespace(name)` | `do:<name>`       | `DoCapability<TCap>`        | `DurableObjectNamespaceConfig` |
| `kvState(name)`                | `state-kv:<name>` | provides `"state"`          | none                           |
| `doState()`                    | `state-do`        | provides `"state"`          | `DoStorageConfig`              |
| `wsHub(name)`                  | `ws-hub:<name>`   | `WsHubCapability<TCap>`     | `WsHubConfig`                  |

Binding types (`KVNamespace`, `D1Database`, `R2Bucket`,
`DurableObjectNamespace`, `DurableObjectState` and their result/option
types) are re-exported from `src/bindings.ts`; `EnvCapability`
is structurally identical to the one in `@lambdot/env`, so a consumer typed
against either accepts both providers.

See [examples/cloudflare-bot](../../../examples/cloudflare-bot) for a
complete worker — hono + a KV-backed counter running under miniflare — and
[examples/durable-object-bot](../../../examples/durable-object-bot) for the
Durable Object half: a websocket chat room per DO instance, driven by
`wsHub` + `doState` under miniflare.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
