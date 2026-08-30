import type { Plugin, StateBackend } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

import type { D1Database, KVNamespace, KVPutOptions, R2Bucket } from "./bindings.ts";

export type {
    D1Database,
    D1ExecResult,
    D1PreparedStatement,
    D1Result,
    DurableObjectId,
    DurableObjectNamespace,
    DurableObjectState,
    DurableObjectStorage,
    DurableObjectStub,
    KVListKey,
    KVListOptions,
    KVListResult,
    KVNamespace,
    KVPutOptions,
    R2Bucket,
    R2ListOptions,
    R2Object,
    R2ObjectBody,
    R2Objects,
    R2PutOptions,
    R2PutValue,
} from "./bindings.ts";
export type {
    DoStorageConfig,
    DurableObjectNamespaceConfig,
    WebSocketHub,
    WebSocketHubControl,
    WsHub,
    WsHubConfig,
} from "./durable-object.ts";
export { doState, durableObjectNamespace, wsHub } from "./durable-object.ts";

/** Config for {@link kvNamespace}: the binding as it arrives on the worker's `env`. */
export interface KVNamespaceConfig {
    readonly binding: KVNamespace;
}

/** Config for {@link d1Database}: the binding as it arrives on the worker's `env`. */
export interface D1DatabaseConfig {
    readonly binding: D1Database;
}

/** Config for {@link r2Bucket}: the binding as it arrives on the worker's `env`. */
export interface R2BucketConfig {
    readonly binding: R2Bucket;
}

/**
 * Config for {@link envVars}: the worker's bindings object as it arrives on
 * the fetch handler's `env` argument, carrying plain vars and secrets next
 * to the resource bindings.
 */
export interface EnvVarsConfig {
    readonly source: Record<string, unknown>;
}

/**
 * Emit one named Workers KV namespace as the plugin's namespace value.
 * Instances multiply by name: compose `kvNamespace("sessions")` and
 * `kvNamespace("cache")` side by side, and each consumer wires its own
 * through its mapping.
 *
 * ```ts
 * createKernel()
 *     .use(kvNamespace("sessions"), { option: { binding: env.SESSIONS } })
 *     .use(kvNamespace("cache"), { option: { binding: env.CACHE } });
 * // ctx.sessions: KVNamespace, ctx.cache: KVNamespace
 * ```
 */
export function kvNamespace<const TCap extends string>(
    capability: TCap,
): Plugin<void, KVNamespace, KVNamespaceConfig, TCap> {
    return definePlugin({
        name: capability,
        apply(_input, _scope, config) {
            return config.binding;
        },
    });
}

/**
 * Emit one named D1 database as the plugin's namespace value. Instances
 * multiply by name, exactly like {@link kvNamespace}.
 *
 * ```ts
 * createKernel().use(d1Database("db"), { option: { binding: env.DB } });
 * // ctx.db: D1Database
 * ```
 */
export function d1Database<const TCap extends string>(
    capability: TCap,
): Plugin<void, D1Database, D1DatabaseConfig, TCap> {
    return definePlugin({
        name: capability,
        apply(_input, _scope, config) {
            return config.binding;
        },
    });
}

/**
 * Emit one named R2 bucket as the plugin's namespace value. Instances
 * multiply by name, exactly like {@link kvNamespace}.
 *
 * ```ts
 * createKernel().use(r2Bucket("uploads"), { option: { binding: env.UPLOADS } });
 * // ctx.uploads: R2Bucket
 * ```
 */
export function r2Bucket<const TCap extends string>(
    capability: TCap,
): Plugin<void, R2Bucket, R2BucketConfig, TCap> {
    return definePlugin({
        name: capability,
        apply(_input, _scope, config) {
            return config.binding;
        },
    });
}

/**
 * Read variables from a worker's bindings object and emit them as the
 * plugin's namespace value — the Cloudflare counterpart of `envVars` in
 * `@lambdot/env`: workers have no `process.env`, so plain vars and secrets
 * arrive on `env` next to the resource bindings. A missing, empty, or
 * non-string variable fails activation loudly at start, so a misconfigured
 * deployment surfaces before any consumer activates.
 *
 * ```ts
 * createKernel().use(envVars("bot-env", ["BOT_TOKEN"]), { option: { source: env } });
 * // ctx["bot-env"].BOT_TOKEN: string
 * ```
 */
export function envVars<const TCap extends string, const TKey extends string>(
    capability: TCap,
    keys: readonly TKey[],
): Plugin<void, Readonly<Record<TKey, string>>, EnvVarsConfig, TCap> {
    return definePlugin({
        name: capability,
        apply(_input, _scope, config) {
            const values: Record<string, string> = {};
            for (const key of keys) {
                const value = config.source[key];
                if (typeof value !== "string" || value === "")
                    throw new Error(
                        `${capability}: required environment variable "${key}" is not set`,
                    );
                values[key] = value;
            }
            return values as Readonly<Record<TKey, string>>;
        },
    });
}

/**
 * Bridge a Workers KV namespace into a pluggable `StateBackend`, so stateful
 * features can build typed accessors with `createStateAccessor`. Wire the KV
 * binding through the mapping:
 *
 * ```ts
 * createKernel()
 *     .bind(kvNamespace("pings"), { option: { binding: env.PINGS } })
 *     .use(kvState("state"), { mapping: (ctx) => ({ kv: ctx.pings }) })
 *     .use(myStatefulFeature); // declares { state: StateBackend } — identity wiring
 * ```
 *
 * Values are stored as JSON under `<plugin-namespace>:<key>`. KV expiries
 * are whole seconds with a 60-second minimum, so `ttlMs` is rounded up and
 * clamped to that floor.
 */
export function kvState<const TCap extends string>(
    capability: TCap,
): Plugin<{ kv: KVNamespace }, StateBackend, void, TCap> {
    return definePlugin({
        name: capability,
        apply(input) {
            const { kv } = input;
            const backend: StateBackend = {
                async get(ns, key) {
                    const value = await kv.get(`${ns}:${key}`, { type: "json" });
                    return value === null ? undefined : value;
                },
                async set(ns, key, value, ttlMs) {
                    const options: KVPutOptions =
                        ttlMs === undefined
                            ? {}
                            : { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) };
                    await kv.put(`${ns}:${key}`, JSON.stringify(value), options);
                },
                async delete(ns, key) {
                    await kv.delete(`${ns}:${key}`);
                },
            };
            return backend;
        },
    });
}
