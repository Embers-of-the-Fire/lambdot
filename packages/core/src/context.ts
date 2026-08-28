import type { Disposer } from "./effect.ts";
import type { BotEvent, EventMap, IngressListener, Listener, OnOptions } from "./events.ts";
import { INGRESS } from "./events.ts";
import type { StateView } from "./state.ts";

/**
 * A typed return address. Produced by the input half of a platform pair,
 * consumed by the output half. The core never inspects it beyond the
 * `platform` routing tag.
 */
export interface Address<TPlatform extends string = string> {
    readonly platform: TPlatform;
}

/** An output platform's contract: the addresses it accepts and the content it can send. */
export interface OutputContract<TAddress = unknown, TContent = unknown> {
    address: TAddress;
    content: TContent;
}

/** platform → contract. Folded across all registered output plugins. */
export type OutputContractMap = Record<string, OutputContract<any, any>>;

type AllAddresses<TOutputs extends OutputContractMap> = TOutputs[keyof TOutputs]["address"];

/**
 * Content types accepted for a given address: the union of `content` from
 * every registered output whose address type accepts `TAddress`. Resolves to
 * `never` when no output matches — with no outputs registered at all,
 * `send` is simply uncallable.
 */
export type ContentFor<TOutputs extends OutputContractMap, TAddress> = {
    [K in keyof TOutputs]: TAddress extends TOutputs[K]["address"] ? TOutputs[K]["content"] : never;
}[keyof TOutputs];

/**
 * The typed surface every plugin sees. Parameterized by the plugin's own
 * declared needs (event kinds it handles, output platforms it sends to,
 * state schema it owns) — the kernel checks at `use()` time that the fold
 * so far satisfies them.
 */
export interface ContextView<
    TEvents extends EventMap,
    TOutputs extends OutputContractMap,
    TState extends object,
> {
    /** Subscribe to ingress middleware (waterfall over every event). */
    on(kind: typeof INGRESS, listener: IngressListener<TEvents>, options?: OnOptions): Disposer;
    /** Subscribe to a specific event kind. */
    on<TKind extends keyof TEvents & string>(
        kind: TKind,
        listener: Listener<BotEvent<TKind, TEvents[TKind]["payload"], TEvents[TKind]["address"]>>,
        options?: OnOptions,
    ): Disposer;

    emit<TKind extends keyof TEvents & string>(
        kind: TKind,
        event: BotEvent<TKind, TEvents[TKind]["payload"], TEvents[TKind]["address"]>,
    ): void;
    parallel<TKind extends keyof TEvents & string>(
        kind: TKind,
        event: BotEvent<TKind, TEvents[TKind]["payload"], TEvents[TKind]["address"]>,
    ): Promise<void>;
    serial<TKind extends keyof TEvents & string>(
        kind: TKind,
        event: BotEvent<TKind, TEvents[TKind]["payload"], TEvents[TKind]["address"]>,
    ): Promise<unknown>;
    waterfall<TKind extends keyof TEvents & string>(
        kind: TKind,
        event: BotEvent<TKind, TEvents[TKind]["payload"], TEvents[TKind]["address"]>,
        inner: (
            event: BotEvent<TKind, TEvents[TKind]["payload"], TEvents[TKind]["address"]>,
        ) => Promise<unknown>,
    ): Promise<unknown>;

    /**
     * Send content through the output platform that owns `to`'s address
     * type. Compile error if the content doesn't match that platform's
     * contract — or if the platform's output plugin was never registered.
     */
    send<TAddress extends AllAddresses<TOutputs>>(
        to: TAddress,
        content: ContentFor<TOutputs, TAddress>,
    ): Promise<void>;

    /**
     * Typed per-plugin state. `never` unless some plugin declared a state
     * schema; usable at runtime only while a state backend plugin is active.
     */
    readonly state: StateView<TState>;

    /**
     * Provide a named capability for `inject` gating, optionally attaching a
     * value to the context (the dashboard-plugin pattern: provide a service
     * object other plugins consume). Returns the unregistering disposer.
     */
    provide(name: string, value?: unknown): Disposer;
}

/** Context seen by input plugins: adds the ability to push events into the pipeline. */
export interface InputContext<TEvents extends EventMap> extends ContextView<TEvents, {}, {}> {
    ingest<TKind extends keyof TEvents & string>(
        kind: TKind,
        payload: TEvents[TKind]["payload"],
        address: TEvents[TKind]["address"],
    ): Promise<void>;
}
