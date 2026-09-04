import type { Disposer, Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";
import { wsConnection, type WsConnection } from "@lambdot/websocket";

/**
 * A push port into the bot: bridged traffic arrives through here and is
 * echoed into the room the bot serves, exactly like socket traffic.
 */
export interface BridgePort {
    push(text: string): void;
    onMessage(listener: (text: string) => void): Disposer;
}

function bridgePort(): Plugin<void, BridgePort, void, "bridge"> {
    return definePlugin({
        name: "bridge",
        apply() {
            const listeners = new Set<(text: string) => void>();
            return {
                push(text) {
                    for (const listener of listeners) listener(text);
                },
                onMessage(listener) {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };
        },
    });
}

/**
 * The bot's public surface, exposed as the composed plugin's own item map:
 * tap inbound room traffic with `listen`, push cross-bot traffic into
 * `bridge`. Everything else — the reply feature, the socket — is internal
 * scaffolding and invisible to the composing parent.
 */
export interface EchoBotSurface {
    readonly listen: (listener: (text: string) => void) => Disposer;
    readonly bridge: BridgePort;
}

/**
 * One bot as a composed plugin: the socket and the bridge port are hermetic
 * (`with`), the reply feature reads both (`use`), and the root's own logic
 * runs last, re-exporting the surface the supervisor is allowed to see.
 * Composing this definition twice yields two fully independent bots —
 * nothing is shared, because nothing can be.
 */
export function createEchoBot<const TName extends string>(name: TName, url: string) {
    const reply = definePlugin({
        name: "reply",
        apply(input: { socket: WsConnection; bridge: BridgePort }, scope) {
            const echo = (text: string): void => {
                console.log(`[${name}] ${text}`);
                input.socket.push(`echo: ${text}`);
            };
            scope.onDispose(input.socket.listen(echo));
            // Bridged traffic echoes into the room the bot serves.
            scope.onDispose(input.bridge.onMessage(echo));
        },
    });

    return definePlugin({
        name,
        apply: (ctx: { socket: WsConnection; bridge: BridgePort }): EchoBotSurface => ({
            listen: (listener) => ctx.socket.listen(listener),
            bridge: ctx.bridge,
        }),
    })
        .with(wsConnection("socket"), { option: { url } })
        .with(bridgePort())
        .use(reply);
}

export type EchoBot = ReturnType<typeof createEchoBot>;
