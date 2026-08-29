import type { Disposer, FeaturePlugin, StateBackend, StatePlugin } from "@lambdot/core";

import type { D1Database, KVNamespace, KVPutOptions, R2Bucket } from "./bindings.ts";

export type {
    D1Database,
    D1ExecResult,
    D1PreparedStatement,
    D1Result,
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

/**
 * The typed capability contracts shared by a binding provider and its
 * consumers, parameterized by capability name: the provider declares it as
 * `TProvides`, consumers as `TInjects`. Cloudflare bindings are named — a
 * worker binds several KV namespaces, D1 databases, and R2 buckets under
 * distinct names — so each provider instance takes its own capability name
 * and distinct names fold side by side
 * (`KVCapability<"sessions"> & KVCapability<"cache">`), exactly like
 * `WsCapability` in `@lambdot/websocket`.
 */
export type KVCapability<TCap extends string> = { readonly [K in TCap]: KVNamespace };
export type D1Capability<TCap extends string> = { readonly [K in TCap]: D1Database };
export type R2Capability<TCap extends string> = { readonly [K in TCap]: R2Bucket };

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
 * Provide one named Workers KV namespace as a typed capability. Instances
 * multiply by capability name: register `kvNamespace("sessions")` and
 * `kvNamespace("cache")` side by side, and each consumer injects its own.
 *
 * ```ts
 * createKernel()
 *     .use(kvNamespace("sessions"), { binding: env.SESSIONS })
 *     .use(kvNamespace("cache"), { binding: env.CACHE });
 * // ctx.sessions: KVNamespace, ctx.cache: KVNamespace
 * ```
 */
export function kvNamespace<TCap extends string>(
    capability: TCap,
): FeaturePlugin<{}, {}, undefined, KVNamespaceConfig, `kv:${TCap}`, KVCapability<TCap>> {
    return {
        name: `kv:${capability}`,
        apply(ctx, config) {
            // The kernel's `provide` keeps its value parameter behind a
            // conditional type that stays deferred for a generic capability
            // name; `KVCapability<TCap>` already ties this name to
            // `KVNamespace`, so pin the call down here.
            return (ctx.provide as (name: TCap, value: KVNamespace) => Disposer).call(
                ctx,
                capability,
                config.binding,
            );
        },
    };
}

/**
 * Provide one named D1 database as a typed capability. Instances multiply
 * by capability name, exactly like {@link kvNamespace}.
 *
 * ```ts
 * createKernel().use(d1Database("db"), { binding: env.DB });
 * // ctx.db: D1Database
 * ```
 */
export function d1Database<TCap extends string>(
    capability: TCap,
): FeaturePlugin<{}, {}, undefined, D1DatabaseConfig, `d1:${TCap}`, D1Capability<TCap>> {
    return {
        name: `d1:${capability}`,
        apply(ctx, config) {
            // See `kvNamespace` for why `provide` is pinned here.
            return (ctx.provide as (name: TCap, value: D1Database) => Disposer).call(
                ctx,
                capability,
                config.binding,
            );
        },
    };
}

/**
 * Provide one named R2 bucket as a typed capability. Instances multiply by
 * capability name, exactly like {@link kvNamespace}.
 *
 * ```ts
 * createKernel().use(r2Bucket("uploads"), { binding: env.UPLOADS });
 * // ctx.uploads: R2Bucket
 * ```
 */
export function r2Bucket<TCap extends string>(
    capability: TCap,
): FeaturePlugin<{}, {}, undefined, R2BucketConfig, `r2:${TCap}`, R2Capability<TCap>> {
    return {
        name: `r2:${capability}`,
        apply(ctx, config) {
            // See `kvNamespace` for why `provide` is pinned here.
            return (ctx.provide as (name: TCap, value: R2Bucket) => Disposer).call(
                ctx,
                capability,
                config.binding,
            );
        },
    };
}

/**
 * Bridge a named Workers KV namespace into the framework's pluggable state
 * slot, so feature plugins reach it through `ctx.state`. Consumes the
 * capability provided by {@link kvNamespace} — register the namespace
 * first:
 *
 * ```ts
 * createKernel()
 *     .use(kvNamespace("kv"), { binding: env.BOT_KV })
 *     .use(kvState("kv"))
 *     .use(myStatefulFeature);
 * ```
 *
 * Values are stored as JSON under `<plugin-namespace>:<key>`. KV expiries
 * are whole seconds with a 60-second minimum, so `ttlMs` is rounded up and
 * clamped to that floor.
 */
export function kvState<TCap extends string>(
    capability: TCap,
): StatePlugin<void, `state-kv:${TCap}`> {
    let binding: KVNamespace | undefined;
    const namespace = (): KVNamespace => {
        if (!binding)
            throw new Error(
                `state backend "state-kv:${capability}" is not active — register kvNamespace("${capability}") first`,
            );
        return binding;
    };

    const backend: StateBackend = {
        async get(ns, key) {
            const value = await namespace().get(`${ns}:${key}`, { type: "json" });
            return value === null ? undefined : value;
        },
        async set(ns, key, value, ttlMs) {
            const options: KVPutOptions =
                ttlMs === undefined ? {} : { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) };
            await namespace().put(`${ns}:${key}`, JSON.stringify(value), options);
        },
        async delete(ns, key) {
            await namespace().delete(`${ns}:${key}`);
        },
    };

    return {
        role: "state",
        name: `state-kv:${capability}`,
        inject: [capability],
        backend,
        apply(ctx) {
            // State plugins keep string-only `inject` (runtime-gated), so the
            // typed capability fold never reaches this context;
            // `KVCapability<TCap>` already ties the name to `KVNamespace`, so
            // pin the read down here.
            binding = (ctx as unknown as KVCapability<TCap>)[capability];
            return () => {
                binding = undefined;
            };
        },
    };
}
