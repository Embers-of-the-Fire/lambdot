/**
 * A function that undoes a registration or allocation. Collected through
 * `scope.onDispose` and run — in reverse registration order (LIFO) — when
 * the owning scope is disposed.
 */
export type Disposer = () => void | Promise<void>;

/**
 * The channel handed to a plugin at application time by its caller: the
 * plugin registers teardown actions for the resources this application
 * acquired (`onDispose`), and reports failures that occur outside the direct
 * application call — background tasks, subscriptions, disposer failures
 * (`onError`). The framework installs no error policy; an unhandled report
 * falls through to the originating caller's sink.
 */
export interface Scope {
    onDispose(disposer: Disposer): void;
    onError(error: unknown): void;
}

/**
 * A scope owned by the caller that originates an application. The owner
 * decides when to `dispose` it; disposal runs every registered disposer in
 * reverse registration order, mirroring the dependency order in which the
 * resources were acquired.
 */
export interface OwnedScope extends Scope {
    dispose(): Promise<void>;
}

export interface ScopeOptions {
    /** Sink for reported errors. Defaults to `console.error`. */
    onError?: (error: unknown) => void;
}

const defaultOnError = (error: unknown): void => console.error("[lambdot]", error);

/** Run disposers in reverse registration order, isolating failures. */
export async function runDisposers(
    disposers: readonly Disposer[],
    onError: (error: unknown) => void,
): Promise<void> {
    for (const dispose of [...disposers].reverse()) {
        try {
            await dispose();
        } catch (error) {
            onError(error);
        }
    }
}

/**
 * Create a scope for originating an application. Pass it to `plugin.apply`;
 * call `dispose` when the application's resources should be released.
 * Disposal is idempotent.
 */
export function createScope(options?: ScopeOptions): OwnedScope {
    const onError = options?.onError ?? defaultOnError;
    const disposers: Disposer[] = [];
    let disposed = false;
    return {
        onDispose: (disposer) => {
            disposers.push(disposer);
        },
        onError,
        dispose: async () => {
            if (disposed) return;
            disposed = true;
            await runDisposers(disposers.splice(0), onError);
        },
    };
}
