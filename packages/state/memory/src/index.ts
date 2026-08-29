import type { StateBackend, StatePlugin } from "@lambdot/core";

interface Entry {
    value: unknown;
    expiresAt?: number;
}

/** Reference state backend: in-memory, with optional per-key TTL. */
export function memoryState(): StatePlugin<void, "state-memory"> {
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

    return {
        role: "state",
        name: "state-memory",
        backend,
    };
}
