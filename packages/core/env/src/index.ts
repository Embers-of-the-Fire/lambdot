import type { Disposer, FeaturePlugin } from "@lambdot/core";

/**
 * The typed capability contract shared by an environment provider and its
 * consumers, parameterized by capability name: the provider declares it as
 * `TProvides`, consumers as `TInjects`. The value is a snapshot of the
 * requested variables, keyed by variable name. Distinct names fold side by
 * side (`EnvCapability<"qq-env"> & EnvCapability<"discord-env">`), exactly
 * like `WsCapability` in `@lambdot/websocket`.
 */
export type EnvCapability<TCap extends string, TKey extends string> = {
    readonly [K in TCap]: Readonly<Record<TKey, string>>;
};

/**
 * Read variables from `process.env` and provide them as a typed capability.
 * A missing or empty variable fails activation loudly at kernel start, so a
 * misconfigured deployment surfaces before any consumer activates.
 *
 * ```ts
 * createKernel().use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]));
 * // ctx["qq-env"].QQ_BOT_APP_ID: string
 * ```
 */
export function envVars<TCap extends string, TKey extends string>(
    capability: TCap,
    keys: readonly TKey[],
): FeaturePlugin<{}, {}, undefined, void, `env:${TCap}`, EnvCapability<TCap, TKey>> {
    return {
        name: `env:${capability}`,
        apply(ctx) {
            const values: Record<string, string> = {};
            for (const key of keys) {
                const value = process.env[key];
                if (value === undefined || value === "")
                    throw new Error(
                        `env:${capability}: required environment variable "${key}" is not set`,
                    );
                values[key] = value;
            }
            // The kernel's `provide` keeps its value parameter behind a
            // conditional type that stays deferred for a generic capability
            // name; `EnvCapability<TCap, TKey>` already ties this name to the
            // record, so pin the call down here (same trick as `wsTransport`).
            return (
                ctx.provide as (name: TCap, value: Readonly<Record<TKey, string>>) => Disposer
            ).call(ctx, capability, values as Readonly<Record<TKey, string>>);
        },
    };
}
