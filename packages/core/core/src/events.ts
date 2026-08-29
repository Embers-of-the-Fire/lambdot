/**
 * An event kind's contract: the payload an input produces and the typed
 * return address that routes replies back through a matching output.
 */
export interface EventDef<TPayload = unknown, TAddress = unknown> {
    payload: TPayload;
    address: TAddress;
}

/** kind → contract. Folded across all registered input plugins. */
export type EventMap = Record<string, EventDef<any, any>>;

/**
 * The single unit that flows through the framework. The core envelope is
 * deliberately free of platform semantics: no reply references, no channel
 * vocabulary — `address` is opaque to the core and meaningful only to the
 * output whose platform produced it.
 */
export interface BotEvent<TKind extends string = string, TPayload = unknown, TAddress = unknown> {
    readonly kind: TKind;
    readonly payload: TPayload;
    readonly address: TAddress;
    /** Unique id for dedup and tracing. */
    readonly id: string;
    /** Unix epoch milliseconds. */
    readonly at: number;
}

/** Union over every registered event kind, narrowing `payload`/`address` per kind. */
export type AnyBotEvent<TEvents extends EventMap> = {
    [K in keyof TEvents & string]: BotEvent<K, TEvents[K]["payload"], TEvents[K]["address"]>;
}[keyof TEvents & string];

/** Reserved kind: every ingested event passes through this waterfall first. */
export const INGRESS = "bot/ingress" as const;

/** Continue a waterfall chain. Call with no argument to pass the event through unchanged. */
export type NextFn<TEvent> = (event?: TEvent) => Promise<unknown>;

/**
 * A listener. Plain observation listeners simply ignore `next`; waterfall
 * (middleware) listeners MUST call `next()` to delegate — returning without
 * calling it short-circuits the chain.
 */
export type Listener<TEvent> = (event: TEvent, next: NextFn<TEvent>) => unknown;

/** Listener for the ingress waterfall; receives the union of all registered event kinds. */
export type IngressListener<TEvents extends EventMap> = Listener<AnyBotEvent<TEvents>>;

export interface OnOptions {
    /** Run before ordinary (non-prepended) registrations. */
    prepend?: boolean;
}

interface Registration {
    listener: Listener<any>;
}

const noopNext: NextFn<any> = () => Promise.resolve(undefined);

/**
 * The runtime event bus. Untyped internally; the typed surface is layered on
 * by the kernel's context view. Modes:
 *
 * - `emit`      fire-and-forget observation
 * - `parallel`  await all listeners (rejects with AggregateError)
 * - `serial`    await in order until a listener returns a non-undefined bail value
 * - `waterfall` around-middleware: each listener receives `next`
 */
export class EventBus {
    private readonly listeners = new Map<string, Registration[]>();

    constructor(private readonly onError: (error: unknown) => void) {}

    on(kind: string, listener: Listener<any>, options?: OnOptions): () => void {
        const regs = this.listeners.get(kind) ?? [];
        const reg: Registration = { listener };
        if (options?.prepend) regs.unshift(reg);
        else regs.push(reg);
        this.listeners.set(kind, regs);
        return () => {
            const current = this.listeners.get(kind);
            if (!current) return;
            const index = current.indexOf(reg);
            if (index >= 0) current.splice(index, 1);
            if (current.length === 0) this.listeners.delete(kind);
        };
    }

    emit(kind: string, event: unknown): void {
        const regs = this.listeners.get(kind);
        if (!regs) return;
        // snapshot: listeners may unregister themselves during dispatch
        for (const reg of regs.slice()) {
            try {
                const result = reg.listener(event, noopNext);
                if (result instanceof Promise) result.catch(this.onError);
            } catch (error) {
                this.onError(error);
            }
        }
    }

    async parallel(kind: string, event: unknown): Promise<void> {
        const regs = this.listeners.get(kind);
        if (!regs) return;
        const results = await Promise.allSettled(
            [...regs].map((reg) => reg.listener(event, noopNext)),
        );
        const errors = results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
        if (errors.length > 0)
            throw new AggregateError(errors, `parallel dispatch of "${kind}" failed`);
    }

    async serial(kind: string, event: unknown): Promise<unknown> {
        const regs = this.listeners.get(kind);
        if (!regs) return undefined;
        // snapshot: listeners may unregister themselves during dispatch
        for (const reg of regs.slice()) {
            const result = await reg.listener(event, noopNext);
            if (result !== undefined) return result;
        }
        return undefined;
    }

    async waterfall(
        kind: string,
        event: unknown,
        inner: (event: any) => Promise<unknown>,
    ): Promise<unknown> {
        const regs = this.listeners.get(kind);
        if (!regs || regs.length === 0) return inner(event);
        const stack = [...regs];
        const dispatch = (index: number, current: unknown): Promise<unknown> => {
            const reg = stack[index];
            if (!reg) return inner(current);
            return Promise.resolve(
                reg.listener(current, (nextEvent?: unknown) =>
                    dispatch(index + 1, nextEvent ?? current),
                ),
            );
        };
        return dispatch(0, event);
    }
}
