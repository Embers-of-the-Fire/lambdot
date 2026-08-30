/**
 * Pluggable state. The framework core is stateless; a state plugin is an
 * ordinary plugin emitting a backend as its namespace value. Stateful
 * features declare the backend in their input and build a typed accessor
 * namespaced to their own plugin name via {@link createStateAccessor}.
 */
export interface StateBackend {
    get(namespace: string, key: string): Promise<unknown>;
    set(namespace: string, key: string, value: unknown, ttlMs?: number): Promise<void>;
    delete(namespace: string, key: string): Promise<void>;
}

/** Typed view of one plugin's state, bound to its namespace. */
export interface StateAccessor<TSchema> {
    get<TKey extends keyof TSchema & string>(key: TKey): Promise<TSchema[TKey] | undefined>;
    set<TKey extends keyof TSchema & string>(
        key: TKey,
        value: TSchema[TKey],
        ttlMs?: number,
    ): Promise<void>;
    delete(key: keyof TSchema & string): Promise<void>;
}

export function createStateAccessor<TSchema>(
    backend: StateBackend,
    namespace: string,
): StateAccessor<TSchema> {
    return {
        async get(key) {
            return (await backend.get(namespace, key)) as TSchema[typeof key] | undefined;
        },
        async set(key, value, ttlMs) {
            await backend.set(namespace, key, value, ttlMs);
        },
        async delete(key) {
            await backend.delete(namespace, key);
        },
    };
}
