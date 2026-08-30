import type { Address, Command, Message, Plugin, Stream } from "@lambdot/core";
import { channel, definePlugin, message, pumpStream, shareStream } from "@lambdot/core";

/**
 * The shared transport service, emitted as a plugin's output value. Owns the
 * socket; platform plugins consume it through their input — the transport
 * itself knows nothing about platforms, addresses, or message shapes.
 */
export interface WsConnection {
    readonly url: string;
    /** Send a text frame. */
    send(data: string): void;
    /** Subscribe to incoming text frames. Returns an unsubscribe disposer. */
    onMessage(listener: (data: string) => void): void;
}

export interface WsTransportConfig {
    readonly url: string;
}

/**
 * The general half: connection lifecycle only. Emits the live connection as
 * its output value; platform plugins declare it as their input. The socket
 * opens at activation and closes when the composition stops.
 */
export function wsTransport<const TName extends string>(
    name: TName,
): Plugin<void, WsConnection, WsTransportConfig, TName> {
    return definePlugin({
        name,
        async apply(_input, scope, config) {
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
            scope.onDispose(() => {
                socket.close();
            });

            return {
                url: config.url,
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

/**
 * The deferred behavior slot: everything the generic transport cannot know —
 * the platform tag, the address shape, and the frame codec. A concrete
 * platform (discord, qq, ...) supplies one of these to the factories below.
 */
export interface WsSpec<
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
> {
    readonly platform: TPlatform;
    /** Decode an incoming frame into a message, or null to ignore the frame. */
    decode(data: string): { payload: TPayload; address: TAddress } | null;
    /** Encode outgoing content into a text frame. */
    encode(content: TContent, address: TAddress): string;
}

/**
 * The input half of a websocket platform: consumes the connection and emits
 * the stream of decoded messages. Wire the connection with a mapping from
 * the transport's namespace.
 */
export function wsInput<
    const TName extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
>(
    name: TName,
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent>,
): Plugin<{ connection: WsConnection }, Stream<Message<TPayload, TAddress>>, void, TName> {
    return definePlugin({
        name,
        apply(input, scope) {
            const messages = channel<Message<TPayload, TAddress>>();
            input.connection.onMessage((data) => {
                const decoded = spec.decode(data);
                if (decoded) messages.push(message(decoded.payload, decoded.address));
            });
            scope.onDispose(() => {
                messages.close();
            });
            // Shared: several consumers may subscribe to the message stream.
            return shareStream(messages.stream);
        },
    });
}

/**
 * The output half of a websocket platform: consumes a command stream and
 * sends each command's encoded content through the connection. Terminal —
 * wire it last, after the features whose reply streams it consumes.
 */
export function wsOutput<
    const TName extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
>(
    name: TName,
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent>,
): Plugin<
    { connection: WsConnection; commands: Stream<Command<TAddress, TContent>> },
    void,
    void,
    TName
> {
    return definePlugin({
        name,
        apply(input, scope) {
            const { connection } = input;
            scope.onDispose(
                pumpStream(
                    input.commands,
                    (cmd) => connection.send(spec.encode(cmd.content, cmd.address)),
                    (error) => scope.onError(error),
                ),
            );
        },
    });
}

/**
 * One websocket platform, bundled as three leaves. The transport and output
 * are usually `bind`ed (internal wiring); the input's message stream is
 * `use`d (exposed to features). The output is terminal, so it is always
 * wired last:

 * ```ts
 * const wsecho = wsPlatform("wsecho", echoSpec);
 * createKernel()
 *     .bind(wsecho.transport, { option: { url } })
 *     .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
 *     .use(reply)
 *     .bind(wsecho.output, {
 *         mapping: (ctx) => ({ connection: ctx["wsecho/transport"], commands: ctx.reply }),
 *     });
 * ```
 */
export interface WsPlatform<
    TName extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
> {
    readonly transport: Plugin<void, WsConnection, WsTransportConfig, `${TName}/transport`>;
    readonly input: Plugin<
        { connection: WsConnection },
        Stream<Message<TPayload, TAddress>>,
        void,
        TName
    >;
    readonly output: Plugin<
        { connection: WsConnection; commands: Stream<Command<TAddress, TContent>> },
        void,
        void,
        `${TName}/output`
    >;
}

/** Build a whole websocket platform (transport + input + output) from a name and a spec. */
export function wsPlatform<
    const TName extends string,
    TPlatform extends string,
    TAddress extends Address<TPlatform>,
    TPayload,
    TContent,
>(
    name: TName,
    spec: WsSpec<TPlatform, TAddress, TPayload, TContent>,
): WsPlatform<TName, TPlatform, TAddress, TPayload, TContent> {
    return {
        transport: wsTransport(`${name}/transport`),
        input: wsInput(name, spec),
        output: wsOutput(`${name}/output`, spec),
    };
}
