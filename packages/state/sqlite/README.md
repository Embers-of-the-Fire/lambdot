# @lambdot/state-sqlite

Opens a SQLite database via `node:sqlite` (`DatabaseSync` — built into
Node, no native dependencies) and emits the connection as the plugin's
namespace value, D1-style: the same pattern as `d1Database` in
`@lambdot/host-cloudflare`, except the plugin owns the connection instead
of receiving a binding from the platform. Despite living under
`packages/state/`, this is **not** a `StateBackend` — consumers get the
raw `DatabaseSync`, not a `createStateAccessor` view.

## What it provides

`sqliteDatabase(name)` emits a `DatabaseSync` under `name`. Instances
multiply by name: compose `sqliteDatabase("db")` and
`sqliteDatabase("cache")` side by side, and each consumer wires its own
through its `mapping`.

Connection lifecycle:

- The connection **opens when the plugin activates** and is owned by it.
- On stop, disposers run in reverse: consumers dispose first, then the
  connection closes.
- Config is `{ path }` — a file path, or `":memory:"` for an ephemeral
  database — passed via `option` (required, since the config type is
  non-void).

Because the value is typed, consumers declare the namespace in their input
and the composition enforces wiring order at compile time: a consumer wired
before its provider is a compile error, and the input value shows up typed
with no casts.

## Usage

```ts
import { createKernel, definePlugin } from "@lambdot/core";
import type { DatabaseSync } from "@lambdot/state-sqlite";
import { sqliteDatabase } from "@lambdot/state-sqlite";

const visits = definePlugin({
    name: "visits",
    apply(input: { db: DatabaseSync }) {
        input.db.exec("CREATE TABLE IF NOT EXISTS visits (n INTEGER)");
    },
});

const kernel = createKernel()
    .use(sqliteDatabase("db"), { option: { path: "bot.db" } })
    .use(visits); // identity wiring: visits's input keys match the visible ctx
```

## API

```ts
function sqliteDatabase<const TName extends string>(
    name: TName,
): Plugin<void, DatabaseSync, SqliteDatabaseConfig, TName>;

interface SqliteDatabaseConfig {
    readonly path: string; // file path, or ":memory:"
}
```

The package also re-exports `DatabaseSync` from `node:sqlite`, so consumers
can name the connection type without importing `node:sqlite` themselves.

## See also

- [`@lambdot/state-memory`](../memory) — the reference `StateBackend`, for
  plugins that want a typed `createStateAccessor` view rather than a raw
  connection.
- `@lambdot/host-cloudflare` — `d1Database`, the binding-provided
  counterpart of this plugin's owned connection.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
