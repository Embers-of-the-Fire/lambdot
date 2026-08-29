/**
 * Pluggable state. The framework core is stateless; state is an ordinary
 * feature plugin providing its backend as the `"state"` capability (at most
 * one may be active). Plugins declare their schema at the type level and
 * receive a typed accessor namespaced to their plugin name.
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

/**
 * Marker type for `ctx.state` when no plugin declared a state schema —
 * "stateless by default" is enforced at compile time. Any access errors with
 * this type's name in the message.
 */
export interface NoStateDeclared {
    readonly "no state schema declared": "register a feature plugin with a TStateSchema to enable ctx.state";
}

/**
 * `ctx.state`. Folds to {@link NoStateDeclared} when no plugin declared a
 * state schema.
 */
export type StateView<TState extends object> = keyof TState extends never
    ? NoStateDeclared
    : {
          for<TName extends keyof TState & string>(plugin: TName): StateAccessor<TState[TName]>;
      };

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
