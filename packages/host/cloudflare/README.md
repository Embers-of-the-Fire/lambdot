# @lambdot/host-cloudflare

A Cloudflare host integration: it embeds a kernel into a worker by turning
the worker's `env` — named KV namespaces, D1 databases, R2 buckets, and
plain environment variables — into typed capabilities that feature plugins
inject through the kernel's capability fold, plus a bridge that serves
`ctx.state` from a KV namespace. The package is dependency-free (only
`@lambdot/core`): the binding types are structural subsets of
`@cloudflare/workers-types`, so real bindings from a worker's `env` are
assignable as-is, and anything Cloudflare adds beyond them stays available
through the consumer's own types.

## Bindings as capabilities

Cloudflare bindings are named — a worker binds several KV namespaces, D1
databases, and R2 buckets under distinct names — so each provider factory
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

| Export                | Plugin name       | Capability                  | Config              |
| --------------------- | ----------------- | --------------------------- | ------------------- |
| `kvNamespace(name)`   | `kv:<name>`       | `KVCapability<TCap>`        | `KVNamespaceConfig` |
| `d1Database(name)`    | `d1:<name>`       | `D1Capability<TCap>`        | `D1DatabaseConfig`  |
| `r2Bucket(name)`      | `r2:<name>`       | `R2Capability<TCap>`        | `R2BucketConfig`    |
| `envVars(name, keys)` | `env:<name>`      | `EnvCapability<TCap, TKey>` | `EnvVarsConfig`     |
| `kvState(name)`       | `state-kv:<name>` | provides `"state"`          | none                |

Binding types (`KVNamespace`, `D1Database`, `R2Bucket` and their
result/option types) are re-exported from `src/bindings.ts`; `EnvCapability`
is structurally identical to the one in `@lambdot/env`, so a consumer typed
against either accepts both providers.

See [examples/cloudflare-bot](../../../examples/cloudflare-bot) for a
complete worker: hono + a KV-backed counter running under miniflare.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
