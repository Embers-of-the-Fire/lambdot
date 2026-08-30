import type { Message, Plugin } from "@lambdot/core";
import { channel, definePlugin, message, shareStream } from "@lambdot/core";
import type { WsConnection } from "@lambdot/websocket";

import type { QqApi } from "./api.ts";
import type { QqAddress, QqMessage, QqMessageStream } from "./events.ts";
import { decodeMessageEvent } from "./events.ts";

/** `GROUP_AND_C2C_EVENT` (1 << 25): group at-messages and C2C messages. */
export const QQ_INTENT_GROUP_AND_C2C = 1 << 25;

/**
 * The qq-specific half of the transport: unlike the generic `wsTransport`,
 * the gateway URL is not static configuration — it is discovered through the
 * REST client (`GET /gateway` with the access token). Resolves the URL at
 * activation, owns the socket, and emits the connection so the input can
 * ride it. Wire the api through the mapping:

 * ```ts
 * .bind(qqApi("qq/api"), ...)
 * .bind(qqGatewayTransport("qq/transport"), { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
 * ```
 */
export function qqGatewayTransport<const TName extends string>(
    name: TName,
): Plugin<{ api: QqApi }, WsConnection, void, TName> {
    return definePlugin({
        name,
        async apply(input, scope) {
            const url = await input.api.gatewayUrl();
            const socket = new WebSocket(url);
            await new Promise<void>((resolve, reject) => {
                socket.addEventListener("open", () => resolve(), { once: true });
                socket.addEventListener(
                    "error",
                    () => reject(new Error("qq gateway failed to connect")),
                    { once: true },
                );
            });
            scope.onDispose(() => {
                socket.close();
            });

            return {
                url,
                send: (data) => socket.send(data),
                onMessage(listener) {
                    socket.addEventListener("message", (event) => {
                        if (typeof event.data === "string") listener(event.data);
                    });
                },
            };
        },
    });
}

export interface QqGatewayInputConfig {
    /** Event intents bitmask; defaults to `QQ_INTENT_GROUP_AND_C2C`. */
    readonly intents?: number;
}

/**
 * The receiving half of the gateway infra: consumes the connection emitted
 * by {@link qqGatewayTransport} and runs the basic gateway algorithm —
 * identify on hello (op 10), heartbeat on the advertised interval (op 1),
 * decode dispatches (op 0) into the emitted message stream. Resume (op 6) is
 * deliberately not implemented: a dropped connection is a fresh identify.
 */
export function qqGatewayInput<const TName extends string>(
    name: TName,
): Plugin<{ connection: WsConnection; api: QqApi }, QqMessageStream, QqGatewayInputConfig, TName> {
    return definePlugin({
        name,
        apply(input, scope, config) {
            const { connection, api } = input;
            const intents = config.intents ?? QQ_INTENT_GROUP_AND_C2C;
            const out = channel<Message<QqMessage, QqAddress>>();
            let lastSeq: number | null = null;
            let heartbeat: ReturnType<typeof setInterval> | undefined;

            connection.onMessage((data) => {
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
                        void api.accessToken().then((token) => {
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
                        // Dispatch: message frames join the emitted stream.
                        if (typeof frame.t !== "string") break;
                        const decoded = decodeMessageEvent(frame.t, frame.d);
                        if (decoded) out.push(message(decoded.payload, decoded.address));
                        break;
                    }
                    // 11 is a heartbeat ack; every other opcode needs no handling.
                }
            });

            scope.onDispose(() => {
                if (heartbeat !== undefined) clearInterval(heartbeat);
                out.close();
            });
            // Shared: several consumers may subscribe to the message stream.
            return shareStream(out.stream);
        },
    });
}
