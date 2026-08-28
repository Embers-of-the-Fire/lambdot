import type {
    Address,
    Disposer,
    EventDef,
    FeaturePlugin,
    InputPlugin,
    OutputPlugin,
} from "@lambdot/core";

/**
 * The shared transport service, provided as the `ws` capability. Owns the
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
 * The general half: connection lifecycle only. Provides the live connection
 * as a typed value under the `ws` capability (folded into the kernel context
 * as `ctx.ws`); platform plugins activate once it is available via
 * `inject: ["ws"]`.
 */
export function wsTransport(): FeaturePlugin<
    {},
    {},
    undefined,
    WsTransportConfig,
    "ws-transport",
    WsCapability
> {
    return {
        name: "ws-transport",
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

            const unprovide = ctx.provide("ws", connection);
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
 * (discord, twitter, ...) supplies one of these to the factories below.
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
 * The typed capability contract shared by provider and consumers: the
 * transport declares it as `TProvides`, the platform factories as
 * `TInjects`. The kernel folds it into `TCaps` and checks at `use()` time
 * that consumers register after the transport — with the matching value
 * type. Inside `apply`, `ctx.ws` is typed with no casts.
 */
export interface WsCapability {
    readonly ws: WsConnection;
}

/**
 * Build the input half of a websocket platform from its spec. Event kinds
 * flow through the generic fold, so registration-order gating still applies
 * to the concrete instantiation.
 */
export function wsInput<
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
>(
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent, TKind>,
): InputPlugin<{ [K in TKind]: EventDef<TPayload, TAddress> }, void, string, {}, WsCapability> {
    return {
        role: "input",
        name: `${spec.platform}-input`,
        inject: ["ws"],
        apply(ctx) {
            return ctx.ws.onMessage((data) => {
                const decoded = spec.decode(data);
                if (decoded) void ctx.ingest(spec.kind, decoded.payload, decoded.address);
            });
        },
    };
}

/** Build the output half of a websocket platform from its spec. */
export function wsOutput<
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
    TKind extends string,
>(
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent, TKind>,
): OutputPlugin<TPlatform, TAddress, TContent, void, string, {}, WsCapability> {
    let connection: WsConnection | undefined;
    return {
        role: "output",
        name: `${spec.platform}-output`,
        platform: spec.platform,
        inject: ["ws"],
        send(to, content) {
            if (!connection) throw new Error(`output "${spec.platform}" is not active`);
            connection.send(spec.encode(content, to));
        },
        apply(ctx) {
            connection = ctx.ws;
            return () => {
                connection = undefined;
            };
        },
    };
}
