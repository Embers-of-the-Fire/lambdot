import type { Disposer, FeaturePlugin, InputPlugin } from "@lambdot/core";
import type { WsCapability, WsConnection } from "@lambdot/websocket";

import type { QqCapability } from "./api.ts";
import { decodeMessageEvent, type QqEvents } from "./events.ts";

/** `GROUP_AND_C2C_EVENT` (1 << 25): group at-messages and C2C messages. */
export const QQ_INTENT_GROUP_AND_C2C = 1 << 25;

/**
 * The qq-specific half of the transport: unlike the generic `wsTransport`,
 * the gateway URL is not static configuration — it is discovered through the
 * REST client (`GET /gateway` with the access token). Resolves the URL at
 * activation, owns the socket, and provides the connection as a typed
 * `WsCapability` so the input can ride it. Register after the api:
 *
 * ```ts
 * .use(qqApi("qq-api", "qq-env"))
 * .use(qqGatewayTransport("qq-ws", "qq-api"))
 * ```
 */
export function qqGatewayTransport<TWsCap extends string, TApiCap extends string>(
    capability: TWsCap,
    api: TApiCap,
): FeaturePlugin<
    {},
    {},
    undefined,
    void,
    `qq-gateway-transport:${TWsCap}`,
    WsCapability<TWsCap>,
    QqCapability<TApiCap>
> {
    return {
        name: `qq-gateway-transport:${capability}`,
        inject: [api],
        async apply(ctx) {
            const url = await ctx[api].gatewayUrl();
            const socket = new WebSocket(url);
            await new Promise<void>((resolve, reject) => {
                socket.addEventListener("open", () => resolve(), { once: true });
                socket.addEventListener(
                    "error",
                    () => reject(new Error("qq gateway failed to connect")),
                    { once: true },
                );
            });

            const listeners = new Set<(data: string) => void>();
            socket.addEventListener("message", (event) => {
                if (typeof event.data !== "string") return;
                for (const listener of listeners) listener(event.data);
            });

            const connection: WsConnection = {
                url,
                send: (data) => socket.send(data),
                onMessage(listener) {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };

            // See `wsTransport` in @lambdot/websocket for why `provide` is pinned here.
            const unprovide = (ctx.provide as (name: TWsCap, value: WsConnection) => Disposer).call(
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

export interface QqGatewayInputConfig {
    /** Event intents bitmask; defaults to `QQ_INTENT_GROUP_AND_C2C`. */
    readonly intents?: number;
}

/**
 * The receiving half of the gateway infra: consumes the connection provided
 * by {@link qqGatewayTransport} and runs the basic gateway algorithm —
 * identify on hello (op 10), heartbeat on the advertised interval (op 1),
 * decode dispatches (op 0) into message events. Resume (op 6) is deliberately
 * not implemented: a dropped connection is a fresh identify.
 */
export function qqGatewayInput<TWsCap extends string, TApiCap extends string>(
    ws: TWsCap,
    api: TApiCap,
): InputPlugin<
    QqEvents,
    QqGatewayInputConfig,
    "qq-gateway-input",
    {},
    WsCapability<TWsCap> & QqCapability<TApiCap>
> {
    return {
        role: "input",
        name: "qq-gateway-input",
        inject: [ws, api],
        apply(ctx, config) {
            const connection = ctx[ws];
            const intents = config.intents ?? QQ_INTENT_GROUP_AND_C2C;
            let lastSeq: number | null = null;
            let heartbeat: ReturnType<typeof setInterval> | undefined;

            const unsubscribe = connection.onMessage((data) => {
                let frame: { op?: unknown; d?: unknown; s?: unknown; t?: unknown };
                try {
                    frame = JSON.parse(data) as typeof frame;
                } catch {
                    return; // not JSON: not ours
                }
                if (typeof frame.s === "number") lastSeq = frame.s;

                switch (frame.op) {
                    case 10: {
                        // Hello: identify, then heartbeat on the advertised interval.
                        const d = frame.d as { heartbeat_interval?: unknown } | null | undefined;
                        const interval =
                            typeof d?.heartbeat_interval === "number"
                                ? d.heartbeat_interval
                                : 45_000;
                        void ctx[api].accessToken().then((token) => {
                            connection.send(
                                JSON.stringify({
                                    op: 2,
                                    d: {
                                        token: `QQBot ${token}`,
                                        intents,
                                        shard: [0, 1],
                                        properties: {},
                                    },
                                }),
                            );
                        });
                        heartbeat = setInterval(() => {
                            connection.send(JSON.stringify({ op: 1, d: lastSeq }));
                        }, interval);
                        break;
                    }
                    case 0: {
                        // Dispatch: message events become lambdot events.
                        if (typeof frame.t !== "string") break;
                        const decoded = decodeMessageEvent(frame.t, frame.d);
                        if (decoded)
                            void ctx.ingest(decoded.kind, decoded.payload, decoded.address);
                        break;
                    }
                    // 11 is a heartbeat ack; every other opcode needs no handling.
                }
            });

            return () => {
                if (heartbeat !== undefined) clearInterval(heartbeat);
                void unsubscribe();
            };
        },
    };
}
