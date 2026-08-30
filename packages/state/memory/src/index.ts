import type { Plugin, StateBackend } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

interface Entry {
    value: unknown;
    expiresAt?: number;
}

/**
 * Reference state backend: in-memory, with optional per-key TTL. An ordinary
 * plugin emitting the backend as its namespace value — stateful features
 * declare it in their input and build a typed accessor with
 * `createStateAccessor(backend, name)`.
 *
 * The store is created at activation: each kernel activation starts from an
 * empty `Map`, writes are not shared between kernels built from the same
 * plugin value, and state is gone when the composition stops.
 */
export function memoryState(): Plugin<void, StateBackend, void, "state"> {
    return definePlugin({
        name: "state",
        apply() {
            const store = new Map<string, Entry>();
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
            return backend;
        },
    });
}
