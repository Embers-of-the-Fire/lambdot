import { DatabaseSync } from "node:sqlite";

import type { Disposer, FeaturePlugin } from "@lambdot/core";

export type { DatabaseSync } from "node:sqlite";

/**
 * The typed capability contract shared by a SQLite provider and its
 * consumers, parameterized by capability name: the provider declares it as
 * `TProvides`, consumers as `TInjects`. Instances multiply by capability
 * name — register `sqliteDatabase("db")` and `sqliteDatabase("cache")` side
 * by side, and each consumer injects its own
 * (`SqliteCapability<"db"> & SqliteCapability<"cache">`), exactly like
 * `D1Capability` in `@lambdot/host-cloudflare`.
 */
export type SqliteCapability<TCap extends string> = { readonly [K in TCap]: DatabaseSync };

/** Config for {@link sqliteDatabase}: where the database lives. */
export interface SqliteDatabaseConfig {
    /** File path, or `":memory:"` for an ephemeral database. */
    readonly path: string;
}

/**
 * Open a SQLite database (via `node:sqlite`, no native dependencies) and
 * provide the connection as a typed capability. Unlike a Cloudflare binding
 * the connection is owned by the plugin: it opens when the plugin activates
 * and closes after its consumers deactivate on unload.
 *
 * ```ts
 * createKernel()
 *     .use(sqliteDatabase("db"), { path: "bot.db" })
 *     .use(myFeature); // declares TInjects: SqliteCapability<"db">
 * // ctx.db: DatabaseSync
 * ```
 */
export function sqliteDatabase<TCap extends string>(
    capability: TCap,
): FeaturePlugin<
    {},
    {},
    undefined,
    SqliteDatabaseConfig,
    `sqlite:${TCap}`,
    SqliteCapability<TCap>
> {
    return {
        name: `sqlite:${capability}`,
        apply(ctx, config) {
            const db = new DatabaseSync(config.path);
            // The kernel's `provide` keeps its value parameter behind a
            // conditional type that stays deferred for a generic capability
            // name; `SqliteCapability<TCap>` already ties this name to
            // `DatabaseSync`, so pin the call down here (same trick as
            // `d1Database` in `@lambdot/host-cloudflare`).
            const unprovide = (ctx.provide as (name: TCap, value: DatabaseSync) => Disposer).call(
                ctx,
                capability,
                db,
            );
            // Disposers run in reverse: unprovide first (deactivating this
            // capability's consumers), then close the connection.
            return [() => db.close(), unprovide];
        },
    };
}
