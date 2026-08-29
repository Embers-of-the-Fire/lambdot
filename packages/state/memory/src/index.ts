import type { FeaturePlugin, StateBackend } from "@lambdot/core";

interface Entry {
    value: unknown;
    expiresAt?: number;
}

/**
 * Reference state backend: in-memory, with optional per-key TTL. An
 * ordinary feature plugin — it provides its backend as the runtime-gated
 * `"state"` capability, so stateful features (`inject: ["state"]`) activate
 * only while it is active. At most one state provider may be active.
 */
export function memoryState(): FeaturePlugin<{}, {}, undefined, void, "state-memory"> {
    const store = new Map<string, Entry>();

    return {
        name: "state-memory",
        apply(ctx) {
            const backend: StateBackend = {
                async get(namespace, key) {
                    const entry = store.get(`${namespace}:${key}`);
                    if (!entry) return undefined;
                    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
                        store.delete(`${namespace}:${key}`);
                        return undefined;
                    }
                    return entry.value;
                },
                async set(namespace, key, value, ttlMs) {
                    const entry: Entry = { value };
                    if (ttlMs !== undefined) entry.expiresAt = Date.now() + ttlMs;
                    store.set(`${namespace}:${key}`, entry);
                },
                async delete(namespace, key) {
                    store.delete(`${namespace}:${key}`);
                },
            };
            return ctx.provide("state", backend);
        },
    };
}
