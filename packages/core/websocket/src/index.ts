import type {
    Address,
    Disposer,
    EventDef,
    FeaturePlugin,
    InputPlugin,
    OutputPlugin,
} from "@lambdot/core";

/**
 * The shared transport service, provided as a typed capability. Owns the
 * socket; platform plugins consume it — the transport itself knows nothing
 * about platforms, addresses, or event kinds.
 */
export interface WsConnection {
    readonly url: string;
    /** Send a text frame. */
    send(data: string): void;
    /** Subscribe to incoming text frames. Returns an unsubscribe disposer. */
    onMessage(listener: (data: string) => void): Disposer;
}

export interface WsTransportConfig {
    readonly url: string;
}

/**
 * The typed capability contract shared by a transport and its consumers,
 * parameterized by capability name: the transport declares it as
 * `TProvides`, the platform factories as `TInjects`. Distinct names fold
 * side by side (`WsCapability<"ws-discord"> & WsCapability<"ws-qq">`), so
 * several websocket platforms can share one kernel — the kernel rejects a
 * duplicate capability name at runtime, and the type fold makes each
 * consumer read back its own connection with no casts.
 */
export type WsCapability<TCap extends string> = { readonly [K in TCap]: WsConnection };

/**
 * The general half: connection lifecycle only. Provides the live connection
 * as a typed value under the given capability name (folded into the kernel
 * context as `ctx[capability]`); platform plugins activate once it is
 * available via `inject: [capability]`.
 */
export function wsTransport<TCap extends string>(
    capability: TCap,
): FeaturePlugin<{}, {}, undefined, WsTransportConfig, `ws-transport:${TCap}`, WsCapability<TCap>> {
    return {
        name: `ws-transport:${capability}`,
        async apply(ctx, config) {
            const socket = new WebSocket(config.url);
            await new Promise<void>((resolve, reject) => {
                socket.addEventListener("open", () => resolve(), { once: true });
                socket.addEventListener(
                    "error",
                    () => reject(new Error("websocket failed to connect")),
                    {
                        once: true,
                    },
                );
            });

            const listeners = new Set<(data: string) => void>();
            socket.addEventListener("message", (event) => {
                if (typeof event.data !== "string") return;
                for (const listener of listeners) listener(event.data);
            });

            const connection: WsConnection = {
                url: config.url,
                send: (data) => socket.send(data),
                onMessage(listener) {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };

            // The kernel's `provide` keeps its value parameter behind a
            // conditional type that stays deferred for a generic capability
            // name; `WsCapability<TCap>` already ties this name to
            // `WsConnection`, so pin the call down here.
            const unprovide = (ctx.provide as (name: TCap, value: WsConnection) => Disposer).call(
                ctx,
                capability,
                connection,
            );
            return () => {
                socket.close();
                void unprovide();
            };
        },
    };
}

/**
 * The deferred behavior slot: everything the generic transport cannot know —
 * the platform tag, the event kind, and the frame codec. A concrete platform
 * (discord, qq, ...) supplies one of these to the factories below.
 */
export interface WsSpec<
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
> {
    readonly platform: TPlatform;
    readonly kind: TKind;
    /** Decode an incoming frame into an event, or null to ignore the frame. */
    decode(data: string): { payload: TPayload; address: TAddress } | null;
    /** Encode outgoing content into a text frame. */
    encode(content: TContent, address: TAddress): string;
}

/**
 * Build the input half of a websocket platform from its spec, consuming the
 * connection provided under `capability` by a `wsTransport`. Event kinds
 * flow through the generic fold, so registration-order gating still applies
 * to the concrete instantiation.
 */
export function wsInput<
    TCap extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
>(
    capability: TCap,
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent, TKind>,
): InputPlugin<
    { [K in TKind]: EventDef<TPayload, TAddress> },
    void,
    `${TPlatform}-input`,
    {},
    WsCapability<TCap>
> {
    return {
        role: "input",
        name: `${spec.platform}-input`,
        inject: [capability],
        apply(ctx) {
            return ctx[capability].onMessage((data) => {
                const decoded = spec.decode(data);
                if (decoded) void ctx.ingest(spec.kind, decoded.payload, decoded.address);
            });
        },
    };
}

/** Build the output half of a websocket platform from its spec. */
export function wsOutput<
    TCap extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
>(
    capability: TCap,
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent, TKind>,
): OutputPlugin<
    TPlatform,
    TAddress,
    TContent,
    void,
    `${TPlatform}-output`,
    {},
    WsCapability<TCap>
> {
    let connection: WsConnection | undefined;
    return {
        role: "output",
        name: `${spec.platform}-output`,
        platform: spec.platform,
        inject: [capability],
        send(to, content) {
            if (!connection) throw new Error(`output "${spec.platform}" is not active`);
            connection.send(spec.encode(content, to));
        },
        apply(ctx) {
            connection = ctx[capability];
            return () => {
                connection = undefined;
            };
        },
    };
}

/**
 * One websocket platform, bundled: the transport that owns the socket under
 * `capability`, plus the input/output halves built from `spec`. The triple
 * stays separate (rather than one fused plugin) so the type fold can keep
 * enforcing registration order — transport before the halves that inject it.
 *
 * ```ts
 * const discord = wsPlatform("ws-discord", discordSpec);
 * createKernel()
 *     .use(discord.transport, { url })
 *     .use(discord.input)
 *     .use(discord.output);
 * ```
 */
export interface WsPlatform<
    TCap extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
> {
    readonly transport: FeaturePlugin<
        {},
        {},
        undefined,
        WsTransportConfig,
        `ws-transport:${TCap}`,
        WsCapability<TCap>
    >;
    readonly input: InputPlugin<
        { [K in TKind]: EventDef<TPayload, TAddress> },
        void,
        `${TPlatform}-input`,
        {},
        WsCapability<TCap>
    >;
    readonly output: OutputPlugin<
        TPlatform,
        TAddress,
        TContent,
        void,
        `${TPlatform}-output`,
        {},
        WsCapability<TCap>
    >;
}

/** Build a whole websocket platform (transport + input + output) from a capability name and a spec. */
export function wsPlatform<
    TCap extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
>(
    capability: TCap,
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent, TKind>,
): WsPlatform<TCap, TPlatform, TAddress, TPayload, TContent, TKind> {
    return {
        transport: wsTransport(capability),
        input: wsInput(capability, spec),
        output: wsOutput(capability, spec),
    };
}
