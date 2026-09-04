import { DatabaseSync } from "node:sqlite";

import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

export type { DatabaseSync } from "node:sqlite";

/** Config for {@link sqliteDatabase}: where the database lives. */
export interface SqliteDatabaseConfig {
    /** File path, or `":memory:"` for an ephemeral database. */
    readonly path: string;
}

/**
 * Open a SQLite database (via `node:sqlite`, no native dependencies) and
 * emit the connection as the plugin's item map. Instances multiply by
 * name — compose `sqliteDatabase("db")` and `sqliteDatabase("cache")` side
 * by side and each consumer wires its own through its mapping. Unlike a
 * Cloudflare binding the connection is owned by the plugin: it opens at
 * application time and closes when the owning scope disposes.
 *
 * ```ts
 * app.with(sqliteDatabase("db"), { option: { path: "bot.db" } })
 *    .use(myFeature, { mapping: (ctx) => ({ db: ctx.db }) });
 * ```
 */
export function sqliteDatabase<const TCap extends string>(
    capability: TCap,
): Plugin<void, DatabaseSync, SqliteDatabaseConfig, TCap> {
    return definePlugin({
        name: capability,
        apply(_input, scope, config) {
            const db = new DatabaseSync(config.path);
            scope.onDispose(() => {
                db.close();
            });
            return db;
        },
    });
}
