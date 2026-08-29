/**
 * A function that undoes a registration or allocation. Collected by the
 * fiber that owns the plugin instance and run on unload/shutdown.
 */
export type Disposer = () => void | Promise<void>;

/**
 * Non-promise effect results. Kept separate from {@link Effect} so the
 * promise variant stays non-recursive and easy for TS to flatten.
 */
export type EffectResult = void | Disposer | Iterable<Disposer> | AsyncIterable<Disposer>;

/**
 * The result of a plugin's `apply`. Everything a plugin contributes is an
 * effect: disposers returned (or yielded) here are collected by the plugin's
 * fiber and run when the plugin unloads. There are no lifecycle hooks.
 */
export type Effect = EffectResult | Promise<EffectResult>;

/** Collect every disposer an effect produces into `sink`. */
export async function collectEffect(
    effect: Effect,
    sink: (disposer: Disposer) => void,
): Promise<void> {
    const result = await effect;
    if (!result) return;
    if (typeof result === "function") {
        sink(result);
        return;
    }
    if (Symbol.asyncIterator in result) {
        for await (const disposer of result) sink(disposer);
        return;
    }
    for (const disposer of result) sink(disposer);
}

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
