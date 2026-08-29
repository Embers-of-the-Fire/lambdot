# @lambdot/state-sqlite

Opens a SQLite database via `node:sqlite` (`DatabaseSync` — built into
Node, no native dependencies) and provides the connection as a typed
capability, D1-style: the same pattern as `d1Database` in
`@lambdot/host-cloudflare`, except the plugin owns the connection instead
of receiving a binding from the platform. Despite living under
`packages/state/`, this is **not** a `StateBackend` — consumers get the
raw `DatabaseSync`, not `ctx.state`.

## What it provides

`sqliteDatabase(capability)` provides `SqliteCapability<TCap>` — a mapped
type tying the capability name to `DatabaseSync`. Instances multiply by
capability name: register `sqliteDatabase("db")` and
`sqliteDatabase("cache")` side by side, and each consumer injects its own
(`SqliteCapability<"db"> & SqliteCapability<"cache">`).

Connection lifecycle:

- The connection **opens when the plugin activates** and is owned by it.
- On unload, disposers run in reverse: the capability is unprovided first
  (deactivating this capability's consumers), then the connection closes.
- Config is `{ path }` — a file path, or `":memory:"` for an ephemeral
  database.

Because the capability is typed, consumers declare it as `TInjects` and the
kernel fold enforces registration order at compile time: registering a
consumer before its provider is a compile error, and the injected value
shows up typed on the plugin's context.

## Usage

```ts
import { createKernel, definePlugin } from "@lambdot/core";
import { sqliteDatabase } from "@lambdot/state-sqlite";
import type { SqliteCapability } from "@lambdot/state-sqlite";

const visits = definePlugin<{}, {}, undefined, void, "visits", {}, SqliteCapability<"db">>({
    name: "visits",
    inject: ["db"],
    apply(ctx) {
        // ctx.db: DatabaseSync
        ctx.db.exec("CREATE TABLE IF NOT EXISTS visits (n INTEGER)");
    },
});

const kernel = createKernel().use(sqliteDatabase("db"), { path: "bot.db" }).use(visits);
```

With typed `TInjects` declared, `inject` is restricted to exactly the
declared names — the runtime gate and the type-level gate cannot drift
apart.

## API

```ts
function sqliteDatabase<TCap extends string>(
    capability: TCap,
): FeaturePlugin<{}, {}, undefined, SqliteDatabaseConfig, `sqlite:${TCap}`, SqliteCapability<TCap>>;

type SqliteCapability<TCap extends string> = { readonly [K in TCap]: DatabaseSync };

interface SqliteDatabaseConfig {
    readonly path: string; // file path, or ":memory:"
}
```

The package also re-exports `DatabaseSync` from `node:sqlite`, so consumers
can name the connection type without importing `node:sqlite` themselves.

## See also

- [`@lambdot/state-memory`](../memory) — the reference `StateBackend`, for
  plugins that want `ctx.state` rather than a raw connection.
- `@lambdot/host-cloudflare` — `d1Database`, the binding-provided
  counterpart of this plugin's owned connection.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
