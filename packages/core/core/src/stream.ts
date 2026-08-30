import type { Disposer } from "./effect.ts";

/**
 * The one thing plugins exchange: an async iterable. Streams broadcast like
 * an event bus — every consumer sees every item, in order, at its own pace —
 * so a namespace value can feed several downstream plugins (a reply stream
 * consumed by two outputs; a message stream consumed by a feature and a
 * logger). Sequential per consumer: the per-item `await` in a `mapStream`
 * mapper or `pumpStream` consumer is the processing-order guarantee.
 */
export type Stream<T> = AsyncIterable<T>;

/**
 * The primitive underneath {@link shareStream}: a pushable buffer bridging
 * callbacks (sockets, readline, HTTP handlers) into the pull world. Package
 * authors pushing from callbacks create one channel, wrap `stream` with
 * `shareStream`, and emit the shared view.
 */
export interface Channel<T> {
    /** Single-consumer stream view of the buffer; wrap with `shareStream` to broadcast. */
    readonly stream: Stream<T>;
    /** Buffer an item (or hand it to a waiting consumer). No-op once closed. */
    push(item: T): void;
    /** End the stream: consumers finish after draining the buffer. */
    close(): void;
}

export function channel<T>(): Channel<T> {
    const buffer: T[] = [];
    let waiting: ((result: IteratorResult<T>) => void) | null = null;
    let closed = false;
    return {
        stream: {
            [Symbol.asyncIterator]() {
                return {
                    next(): Promise<IteratorResult<T>> {
                        if (buffer.length > 0)
                            return Promise.resolve({ value: buffer.shift() as T, done: false });
                        if (closed) return Promise.resolve({ value: undefined, done: true });
                        return new Promise((resolve) => {
                            waiting = resolve;
                        });
                    },
                };
            },
        },
        push(item) {
            if (closed) return;
            if (waiting) {
                const resolve = waiting;
                waiting = null;
                resolve({ value: item, done: false });
            } else {
                buffer.push(item);
            }
        },
        close() {
            closed = true;
            if (waiting) {
                const resolve = waiting;
                waiting = null;
                resolve({ value: undefined, done: true });
            }
        },
    };
}

/**
 * Multicast a stream: every consumer gets every item, in order, at its own
 * pace. Pulling starts when the first consumer attaches, pauses when the
 * last one detaches (the source buffers), and resumes on the next attach.
 * Consumers attaching mid-stream see items from that point on —
 * subscription semantics, like an event bus listener. A source error ends
 * the stream: waiting and future reads reject with it (after draining
 * what was already buffered), so consumers like `pumpStream` can forward
 * it instead of hanging.
 */
export function shareStream<T>(stream: Stream<T>): Stream<T> {
    interface Consumer {
        buffer: T[];
        waiting: {
            resolve: (result: IteratorResult<T>) => void;
            reject: (error: unknown) => void;
        } | null;
    }
    const consumers = new Set<Consumer>();
    let closed = false;
    let failed = false;
    let failure: unknown;
    let pulling = false;
    let iterator: AsyncIterator<T> | undefined;
    let held: { value: T } | undefined;

    const push = (item: T): void => {
        for (const consumer of consumers) {
            if (consumer.waiting) {
                const { resolve } = consumer.waiting;
                consumer.waiting = null;
                resolve({ value: item, done: false });
            } else {
                consumer.buffer.push(item);
            }
        }
    };

    const pull = (): void => {
        if (pulling || closed) return;
        pulling = true;
        void (async () => {
            try {
                // One iterator for the stream's lifetime: pausing via `break`
                // out of `for await` would finish generator-backed sources
                // permanently, so they could never resume.
                iterator ??= stream[Symbol.asyncIterator]();
                const source = iterator;
                // Deliver an item pulled while the last consumer detached.
                if (held) {
                    push(held.value);
                    held = undefined;
                }
                let sourceDone = false;
                // Check before pulling: with nobody listening, pause (the
                // source buffers) without consuming an item; the next attach
                // resumes this same iterator.
                while (consumers.size > 0) {
                    const result = await source.next();
                    if (result.done) {
                        sourceDone = true;
                        break;
                    }
                    // The last consumer detached while this pull was in
                    // flight: hold the item instead of dropping it.
                    if (consumers.size === 0) {
                        held = { value: result.value };
                        break;
                    }
                    push(result.value);
                }
                if (!sourceDone) return;
                closed = true;
                for (const consumer of consumers) {
                    if (consumer.waiting) {
                        const { resolve } = consumer.waiting;
                        consumer.waiting = null;
                        resolve({ value: undefined, done: true });
                    }
                }
            } catch (error) {
                // A source error ends the stream: settle waiting consumers
                // with the rejection and fail future next() calls (after
                // they drain what was already buffered), so consumers like
                // pumpStream see the error instead of hanging forever.
                failed = true;
                failure = error;
                closed = true;
                for (const consumer of consumers) {
                    if (consumer.waiting) {
                        const { reject } = consumer.waiting;
                        consumer.waiting = null;
                        reject(error);
                    }
                }
            } finally {
                pulling = false;
            }
        })();
    };

    return {
        [Symbol.asyncIterator]() {
            const consumer: Consumer = { buffer: [], waiting: null };
            consumers.add(consumer);
            pull();
            return {
                next(): Promise<IteratorResult<T>> {
                    if (consumer.buffer.length > 0)
                        return Promise.resolve({
                            value: consumer.buffer.shift() as T,
                            done: false,
                        });
                    if (failed) return Promise.reject(failure);
                    if (closed) return Promise.resolve({ value: undefined, done: true });
                    return new Promise((resolve, reject) => {
                        consumer.waiting = { resolve, reject };
                    });
                },
                return(): Promise<IteratorResult<T>> {
                    consumers.delete(consumer);
                    if (consumer.waiting) {
                        const { resolve } = consumer.waiting;
                        consumer.waiting = null;
                        resolve({ value: undefined, done: true });
                    }
                    return Promise.resolve({ value: undefined, done: true });
                },
            };
        },
    };
}

/** Transform each item; the mapper may be async (items stay sequential). */
export function mapStream<T, U>(stream: Stream<T>, map: (item: T) => U | Promise<U>): Stream<U> {
    async function* mapped(): AsyncGenerator<U> {
        for await (const item of stream) yield await map(item);
    }
    return shareStream(mapped());
}

/** Keep only matching items. The type-guard form narrows the item type. */
export function filterStream<T, U extends T>(
    stream: Stream<T>,
    predicate: (item: T) => item is U,
): Stream<U>;
export function filterStream<T>(
    stream: Stream<T>,
    predicate: (item: T) => boolean | Promise<boolean>,
): Stream<T>;
export function filterStream<T>(
    stream: Stream<T>,
    predicate: (item: T) => boolean | Promise<boolean>,
): Stream<T> {
    async function* filtered(): AsyncGenerator<T> {
        for await (const item of stream) if (await predicate(item)) yield item;
    }
    return shareStream(filtered());
}

/** Interleave several streams into one, in arrival order. */
export function mergeStreams<T>(...streams: readonly Stream<T>[]): Stream<T> {
    async function* merged(): AsyncGenerator<T> {
        interface Indexed {
            index: number;
            result: IteratorResult<T>;
        }
        const iterators = streams.map((stream) => stream[Symbol.asyncIterator]());
        const pending = new Map<number, Promise<Indexed>>();
        const arm = (index: number): void => {
            const iterator = iterators[index];
            if (!iterator) return;
            pending.set(
                index,
                iterator.next().then((result) => ({ index, result })),
            );
        };
        for (let index = 0; index < iterators.length; index++) arm(index);
        while (pending.size > 0) {
            const { index, result } = await Promise.race(pending.values());
            pending.delete(index);
            if (result.done) continue;
            arm(index);
            yield result.value;
        }
    }
    return shareStream(merged());
}

/**
 * Consume a stream in the background, sequentially. Errors go to `onError`.
 * The returned disposer detaches after the in-flight item; with every
 * consumer detached, the stream pauses until one attaches again.
 */
export function pumpStream<T>(
    stream: Stream<T>,
    consume: (item: T) => void | Promise<void>,
    onError: (error: unknown) => void,
): Disposer {
    let stopped = false;
    void (async () => {
        try {
            for await (const item of stream) {
                if (stopped) return;
                await consume(item);
            }
        } catch (error) {
            if (!stopped) onError(error);
        }
    })();
    return () => {
        stopped = true;
    };
}
