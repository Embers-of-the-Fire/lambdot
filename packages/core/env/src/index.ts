import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

/**
 * Read variables from `process.env` and emit them as the plugin's item
 * map: a snapshot of the requested variables, keyed by variable name. A
 * missing or empty variable fails the application loudly, so a
 * misconfigured deployment surfaces before any consumer applies.
 *
 * ```ts
 * app.with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]));
 * // ctx["qq-env"].QQ_BOT_APP_ID: string
 * ```
 */
export function envVars<const TCap extends string, const TKey extends string>(
    capability: TCap,
    keys: readonly TKey[],
): Plugin<void, Readonly<Record<TKey, string>>, void, TCap> {
    return definePlugin({
        name: capability,
        apply() {
            const values: Record<string, string> = {};
            for (const key of keys) {
                const value = process.env[key];
                if (value === undefined || value === "")
                    throw new Error(
                        `${capability}: required environment variable "${key}" is not set`,
                    );
                values[key] = value;
            }
            return values as Readonly<Record<TKey, string>>;
        },
    });
}
