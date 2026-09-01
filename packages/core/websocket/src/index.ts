import type { Disposer, Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

/**
 * The socket, re-exported to the context: the plugin owns the connection
 * lifecycle and emits the live connection as its item map, so consumers
 * listen to incoming text frames and push outgoing ones. The transport
 * knows nothing about protocols or message shapes.
 */
export interface WsConnection {
    readonly url: string;
    /** Send a text frame. */
    push(data: string): void;
    /** Subscribe to incoming text frames (binary frames are dropped). The disposer unsubscribes. */
    listen(listener: (data: string) => void): Disposer;
}

/** Config for {@link wsConnection}: where to dial, and how. */
export interface WsConnectionConfig {
    readonly url: string;
    /**
     * Socket factory; defaults to the global `WebSocket`. Inject a fake in
     * tests or a platform-specific implementation on hosts without one.
     */
    readonly create?: (url: string) => WebSocketLike;
}

/** The structural slice of the web-standard `WebSocket` the plugin drives. */
export interface WebSocketLike {
    addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
    removeEventListener(type: string, listener: (event: { data: unknown }) => void): void;
    send(data: string): void;
    close(): void;
}

/**
 * One websocket connection as an ordinary plugin: the socket opens at
 * application (a connect failure fails the application) and closes when the
 * owning scope disposes. Instances multiply by name — compose
 * `wsConnection("a")` and `wsConnection("b")` side by side, each consumer
 * wiring its own through its mapping.
 *
 * ```ts
 * const feature = definePlugin({
 *     name: "feature",
 *     apply(input: { socket: WsConnection }, scope) {
 *         scope.onDispose(input.socket.listen((data) => input.socket.push(data)));
 *     },
 * });
 *
 * app.with(wsConnection("socket"), { option: { url } }).use(feature);
 * ```
 */
export function wsConnection<const TName extends string>(
    name: TName,
): Plugin<void, WsConnection, WsConnectionConfig, TName> {
    return definePlugin({
        name,
        async apply(_input, scope, config) {
            const create = config.create ?? ((url: string) => new WebSocket(url));
            const socket = create(config.url);
            await new Promise<void>((resolve, reject) => {
                socket.addEventListener("open", () => resolve());
                socket.addEventListener("error", () =>
                    reject(new Error(`websocket failed to connect: ${config.url}`)),
                );
            });
            scope.onDispose(() => {
                socket.close();
            });

            return {
                url: config.url,
                push: (data) => {
                    socket.send(data);
                },
                listen(listener) {
                    const onMessage = (event: { data: unknown }) => {
                        if (typeof event.data === "string") listener(event.data);
                    };
                    socket.addEventListener("message", onMessage);
                    return () => {
                        socket.removeEventListener("message", onMessage);
                    };
                },
            };
        },
    });
}
