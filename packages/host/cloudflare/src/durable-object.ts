import type { Disposer, Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

import type { DurableObjectNamespace, DurableObjectStorage } from "./bindings.ts";

/** Config for {@link durableObjectNamespace}: the binding as it arrives on the worker's `env`. */
export interface DurableObjectNamespaceConfig {
    readonly binding: DurableObjectNamespace;
}

/**
 * Emit one named Durable Object namespace binding as the plugin's item map.
 * Instances multiply by name, exactly like `kvNamespace`. Routing to an
 * instance stays in the worker's fetch handler — read the namespace back
 * from the composition's item map:
 *
 * ```ts
 * app.with(durableObjectNamespace("rooms"), { option: { binding: env.ROOM } });
 * // items.rooms.get(items.rooms.idFromName(name)).fetch(request)
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

/** Config for {@link doStorage}: the instance's storage, from the Durable Object's constructor state. */
export interface DoStorageConfig {
    readonly storage: DurableObjectStorage;
}

/**
 * Emit a Durable Object's own transactional storage as the plugin's item
 * map, as-is. The storage arrives on the Durable Object's constructor state
 * rather than on `env`, so it is passed straight as config (each instance
 * has exactly one). Emitted under `"storage"`, so feature plugins reach it
 * by declaring `{ storage: DurableObjectStorage }` in their input:
 *
 * ```ts
 * class Room extends DurableObject {
 *     async boot() {
 *         const scope = createScope();
 *         return app.with(doStorage(), { option: { storage: this.ctx.storage } })
 *             .apply({}, scope, undefined);
 *     }
 * }
 * ```
 *
 * Values are structured-cloneable, so no JSON round trip is needed, and
 * there is no TTL — Durable Object storage has no expiry mechanism. Storage
 * is scoped to the instance: two names on one namespace never share a value.
 */
export function doStorage(): Plugin<void, DurableObjectStorage, DoStorageConfig, "storage"> {
    return definePlugin({
        name: "storage",
        apply(_input, _scope, config) {
            return config.storage;
        },
    });
}

/**
 * A server-side websocket hub: the same shape as `WsConnection` in
 * `@lambdot/websocket` (declared locally so the package keeps its single
 * `@lambdot/core` dependency), so anything written against a connection
 * consumes it as-is. Where `wsConnection` owns one client socket, the hub
 * fans out over every socket a Durable Object has accepted: `push`
 * broadcasts, `listen` receives from any of them.
 */
export interface WebSocketHub {
    readonly url: string;
    /** Send a text frame to every accepted socket. */
    push(data: string): void;
    /** Subscribe to incoming text frames from any accepted socket. The disposer unsubscribes. */
    listen(listener: (data: string) => void): Disposer;
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

/** Config for a {@link wsHub} plugin: the URL the hub serves, reported as `WebSocketHub["url"]`. */
export interface WsHubConfig {
    readonly url: string;
}

/** A {@link wsHub} bundle: the hub the Durable Object accepts sockets into, and the plugin emitting it. */
export interface WsHub<TCap extends string> {
    readonly hub: WebSocketHubControl;
    readonly plugin: Plugin<void, WebSocketHub, WsHubConfig, TCap>;
}

/**
 * The server-side mirror of `wsConnection`: instead of dialing out, a
 * Durable Object accepts incoming sockets. `wsHub` returns the two halves
 * of that — the hub the Durable Object's fetch handler accepts
 * `WebSocketPair` server ends into, and the plugin that emits the hub as
 * its item map:
 *
 * ```ts
 * class ChatRoom extends DurableObject {
 *     private readonly room = wsHub("room");
 *     private scope: OwnedScope | undefined;
 *
 *     async fetch(request: Request) {
 *         if (this.scope === undefined) {
 *             this.scope = createScope();
 *             await roomApp
 *                 .with(this.room.plugin, { option: { url: request.url } })
 *                 .apply({}, this.scope, undefined);
 *         }
 *         const pair = new WebSocketPair();
 *         this.room.hub.accept(pair[1]);
 *         return new Response(null, { status: 101, webSocket: pair[0] });
 *     }
 * }
 * ```
 *
 * Create the hub **per Durable Object instance**, never at module level: it
 * keeps sockets and listeners in closures, and co-resident instances share
 * the isolate's module scope, so module-level instances would cross-wire two
 * rooms (one room's broadcasts leaking into another's sockets). The
 * instance's URL is only known per request, so hold the hub in instance
 * state and apply the composition lazily in `fetch()` with `request.url`.
 */
export function wsHub<const TCap extends string>(capability: TCap): WsHub<TCap> {
    const sockets = new Set<WebSocket>();
    const listeners = new Set<(data: string) => void>();

    // `url` is only known once the plugin applies with its config, so the
    // hub object stays mutable behind the readonly connection face.
    const hub = {
        url: "",
        push(data: string) {
            for (const socket of sockets) socket.send(data);
        },
        listen(listener: (data: string) => void): Disposer {
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
