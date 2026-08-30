/**
 * A function that undoes a registration or allocation. Collected through
 * `scope.onDispose` and run when the owning plugin unloads.
 */
export type Disposer = () => void | Promise<void>;

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
