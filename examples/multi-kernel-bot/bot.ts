import type { Message, Plugin, Stream } from "@lambdot/core";
import {
    channel,
    createKernel,
    definePlugin,
    mapStream,
    mergeStreams,
    message,
} from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec, type WsEchoAddress } from "./echo-spec.ts";

/** One inbound wsecho message. */
export type WsEchoMessage = Message<string, WsEchoAddress>;

/**
 * The cross-composition handle a bot exposes. Deliberately narrow: the
 * supervisor can push a message into this bot's pipeline, nothing more.
 * Because plugin state now lives in `apply` closures, plugin objects are
 * pure specs — safe to share across compositions (namespaces are
 * per-composition, so identical names never collide).
 */
export interface BridgePort {
    readonly stream: Stream<WsEchoMessage>;
    push(payload: string): void;
}

function bridgePort(): Plugin<void, BridgePort, void, "bridge"> {
    return definePlugin({
        name: "bridge",
        apply() {
            const inbound = channel<WsEchoMessage>();
            const port: BridgePort = {
                stream: inbound.stream,
                push: (payload) => inbound.push(message(payload, { platform: "wsecho" })),
            };
            return port;
        },
    });
}

/** The bot's inbound traffic: its own socket's messages plus bridged ones. */
const ingress = definePlugin({
    name: "ingress",
    apply(input: { wsecho: Stream<WsEchoMessage>; bridge: BridgePort }) {
        return mergeStreams(input.wsecho, input.bridge.stream);
    },
});

/**
 * One bot = one composition. The stack is byte-for-byte identical for every
 * instance — same "wsecho" platform, same namespace names — because each
 * composition's namespaces are private. Instance identity lives in the
 * factory arguments (name for logs, url for the socket), not in type-level
 * names.
 */
export function createEchoBot(name: string, url: string) {
    const wsecho = wsPlatform("wsecho", echoSpec);
    const reply = definePlugin({
        name: "reply",
        apply(input: { ingress: Stream<WsEchoMessage> }) {
            return mapStream(input.ingress, (event) => {
                console.log(`[bot ${name}] id=${event.id} payload=${event.payload}`);
                return { address: event.address, content: `echo: ${event.payload}` };
            });
        },
    });

    return createKernel({ onError: (error) => console.error(`[bot ${name}]`, error) })
        .bind(wsecho.transport, { option: { url } })
        .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
        .use(bridgePort())
        .use(ingress)
        .use(reply)
        .bind(wsecho.output, {
            mapping: (ctx) => ({ connection: ctx["wsecho/transport"], commands: ctx.reply }),
        });
}

export type EchoBot = ReturnType<typeof createEchoBot>;
