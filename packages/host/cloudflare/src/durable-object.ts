import type { Disposer, Plugin, StateBackend } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

import type { DurableObjectNamespace, DurableObjectStorage } from "./bindings.ts";

/** Config for {@link durableObjectNamespace}: the binding as it arrives on the worker's `env`. */
export interface DurableObjectNamespaceConfig {
    readonly binding: DurableObjectNamespace;
}

/**
 * Emit one named Durable Object namespace binding as the plugin's namespace
 * value. Instances multiply by name, exactly like `kvNamespace`. Routing to
 * an instance stays in the worker's fetch handler — read the namespace back
 * from the composition's ctx:
 *
 * ```ts
 * createKernel().use(durableObjectNamespace("rooms"), { option: { binding: env.ROOM } });
 * // ctx.rooms.get(ctx.rooms.idFromName(name)).fetch(request)
 * ```
 */
export function durableObjectNamespace<const TCap extends string>(
    capability: TCap,
): Plugin<void, DurableObjectNamespace, DurableObjectNamespaceConfig, TCap> {
    return definePlugin({
        name: capability,
        apply(_input, _scope, config) {
            return config.binding;
        },
    });
}

/** Config for {@link doState}: the instance's storage, from the Durable Object's constructor state. */
export interface DoStorageConfig {
    readonly storage: DurableObjectStorage;
}

/**
 * Bridge a Durable Object's own transactional storage into a pluggable
 * `StateBackend` — the per-instance counterpart of `kvState`. The storage
 * arrives on the Durable Object's constructor state rather than on `env`, so
 * it is passed straight as config (each instance has exactly one). Emitted
 * under `"state"`, so feature plugins reach it by declaring
 * `{ state: StateBackend }` in their input (identity wiring):
 *
 * ```ts
 * class Room extends DurableObject {
 *     boot() {
 *         return createKernel().bind(doState(), { option: { storage: this.ctx.storage } });
 *     }
 * }
 * ```
 *
 * Keys are namespaced `<plugin-namespace>:<key>`. Values are
 * structured-cloneable, so no JSON round trip is needed, and there is no
 * TTL — Durable Object storage has no expiry mechanism. State is scoped to
 * the instance: two names on one namespace never share a value.
 */
export function doState(): Plugin<void, StateBackend, DoStorageConfig, "state"> {
    return definePlugin({
        name: "state",
        apply(_input, _scope, config) {
            const backend: StateBackend = {
                get: (ns, key) => config.storage.get(`${ns}:${key}`),
                set: (ns, key, value) => config.storage.put(`${ns}:${key}`, value),
                async delete(ns, key) {
                    await config.storage.delete(`${ns}:${key}`);
                },
            };
            return backend;
        },
    });
}

/**
 * A server-side websocket hub: the exact shape of `WsConnection` in
 * `@lambdot/websocket` (declared locally so the package keeps its single
 * `@lambdot/core` dependency), so the generic `wsInput`/`wsOutput` factories
 * consume it as-is through their `{ connection }` input. Where `wsTransport`
 * owns one client socket, the hub fans out over every socket a Durable
 * Object has accepted: `send` broadcasts, `onMessage` receives from any of
 * them.
 */
export interface WebSocketHub {
    readonly url: string;
    /** Send a text frame to every accepted socket. */
    send(data: string): void;
    /** Subscribe to incoming text frames from any accepted socket. */
    onMessage(listener: (data: string) => void): Disposer;
}

/**
 * The handler face of a {@link wsHub} bundle, held by the Durable Object
 * class: everything {@link WebSocketHub} exposes to plugins, plus the
 * server-side `accept` the fetch handler calls with the server end of a
 * `WebSocketPair`.
 */
export interface WebSocketHubControl extends WebSocketHub {
    accept(socket: WebSocket): void;
}

/** Config for a {@link wsHub} plugin: the URL the hub serves, reported as `WsConnection["url"]`. */
export interface WsHubConfig {
    readonly url: string;
}

/** A {@link wsHub} bundle: the hub the Durable Object accepts sockets into, and the plugin emitting it. */
export interface WsHub<TCap extends string> {
    readonly hub: WebSocketHubControl;
    readonly plugin: Plugin<void, WebSocketHub, WsHubConfig, TCap>;
}

/**
 * The server-side mirror of `wsTransport`: instead of dialing out, a Durable
 * Object accepts incoming sockets. `wsHub` returns the two halves of that —
 * the hub the Durable Object's fetch handler accepts `WebSocketPair` server
 * ends into, and the plugin that emits the hub as its namespace value, so
 * the generic `wsInput`/`wsOutput` halves (a `wsPlatform` bundle minus its
 * transport) drive it unchanged:
 *
 * ```ts
 * class ChatRoom extends DurableObject {
 *     private readonly room = wsHub("room");
 *     private kernel: ReturnType<typeof createRoomKernel> | undefined;
 *
 *     async fetch(request: Request) {
 *         this.kernel ??= createRoomKernel(this.room, request.url);
 *         await this.kernel.start(); // `start` is idempotent
 *         const pair = new WebSocketPair();
 *         this.room.hub.accept(pair[1]);
 *         return new Response(null, { status: 101, webSocket: pair[0] });
 *     }
 * }
 *
 * function createRoomKernel(room: WsHub<"room">, url: string) {
 *     const chat = wsPlatform("dochat", chatSpec);
 *     return createKernel()
 *         .bind(room.plugin, { option: { url } })
 *         .use(chat.input, { mapping: (ctx) => ({ connection: ctx.room }) })
 *         .bind(chat.output, {
 *             mapping: (ctx) => ({ connection: ctx.room, commands: ctx.reply }),
 *         });
 * }
 * ```
 *
 * Create the hub **per Durable Object instance**, never at module level: it
 * keeps sockets and listeners in closures, and co-resident instances share
 * the isolate's module scope, so module-level instances would cross-wire two
 * rooms (one room's broadcasts leaking into another's sockets). The
 * instance's URL is only known per request, so hold the hub in instance
 * state and boot the composition lazily in `fetch()` with `request.url`.
 */
export function wsHub<const TCap extends string>(capability: TCap): WsHub<TCap> {
    const sockets = new Set<WebSocket>();
    const listeners = new Set<(data: string) => void>();

    // `url` is only known once the plugin activates with its config, so the
    // hub object stays mutable behind the readonly connection face.
    const hub = {
        url: "",
        send(data: string) {
            for (const socket of sockets) socket.send(data);
        },
        onMessage(listener: (data: string) => void): Disposer {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        accept(socket: WebSocket) {
            // `accept()` is the server-side workers extension: the global
            // `WebSocket` type this package compiles against is the
            // client-side one, so pin the call down structurally.
            (socket as WebSocket & { accept(): void }).accept();
            sockets.add(socket);
            socket.addEventListener("message", (event) => {
                if (typeof event.data === "string")
                    for (const listener of listeners) listener(event.data);
            });
            const drop = () => {
                sockets.delete(socket);
            };
            socket.addEventListener("close", drop);
            socket.addEventListener("error", drop);
        },
    };

    const plugin = definePlugin({
        name: capability,
        apply(_input, _scope, config: WsHubConfig) {
            hub.url = config.url;
            return hub as WebSocketHub;
        },
    });

    return { hub, plugin };
}
