import type { Disposer, FeaturePlugin, StateBackend } from "@lambdot/core";

import type { DurableObjectNamespace, DurableObjectStorage } from "./bindings.ts";

/**
 * The typed capability contract shared by a Durable Object namespace
 * provider and its consumers, parameterized by capability name — the same
 * scheme as `KVCapability`: workers bind namespaces under distinct names, so
 * each provider instance takes its own and distinct names fold side by side.
 */
export type DoCapability<TCap extends string> = { readonly [K in TCap]: DurableObjectNamespace };

/** Config for {@link durableObjectNamespace}: the binding as it arrives on the worker's `env`. */
export interface DurableObjectNamespaceConfig {
    readonly binding: DurableObjectNamespace;
}

/**
 * Provide one named Durable Object namespace binding as a typed capability.
 * Instances multiply by capability name, exactly like `kvNamespace`. Routing
 * to an instance stays in the worker's fetch handler — read the namespace
 * back through the fold:
 *
 * ```ts
 * createKernel().use(durableObjectNamespace("rooms"), { binding: env.ROOM });
 * // ctx.rooms.get(ctx.rooms.idFromName(name)).fetch(request)
 * ```
 */
export function durableObjectNamespace<TCap extends string>(
    capability: TCap,
): FeaturePlugin<
    {},
    {},
    undefined,
    DurableObjectNamespaceConfig,
    `do:${TCap}`,
    DoCapability<TCap>
> {
    return {
        name: `do:${capability}`,
        apply(ctx, config) {
            // The kernel's `provide` keeps its value parameter behind a
            // conditional type that stays deferred for a generic capability
            // name; `DoCapability<TCap>` already ties this name to
            // `DurableObjectNamespace`, so pin the call down here.
            return (ctx.provide as (name: TCap, value: DurableObjectNamespace) => Disposer).call(
                ctx,
                capability,
                config.binding,
            );
        },
    };
}

/** Config for {@link doState}: the instance's storage, from the Durable Object's constructor state. */
export interface DoStorageConfig {
    readonly storage: DurableObjectStorage;
}

/**
 * Bridge a Durable Object's own transactional storage into the framework's
 * pluggable state slot, so feature plugins reach it through `ctx.state` —
 * the per-instance counterpart of `kvState`. The storage arrives on the Durable
 * Object's constructor state rather than on `env`, so it is passed straight
 * as config (each instance has exactly one):
 *
 * ```ts
 * class Room extends DurableObject {
 *     boot() {
 *         return createKernel().use(doState(), { storage: this.ctx.storage });
 *     }
 * }
 * ```
 *
 * Keys are namespaced `<plugin-namespace>:<key>`. Values are
 * structured-cloneable, so no JSON round trip is needed, and there is no
 * TTL — Durable Object storage has no expiry mechanism. State is scoped to
 * the instance: two names on one namespace never share a value.
 */
export function doState(): FeaturePlugin<{}, {}, undefined, DoStorageConfig, "state-do"> {
    return {
        name: "state-do",
        apply(ctx, config) {
            const backend: StateBackend = {
                get: (ns, key) => config.storage.get(`${ns}:${key}`),
                set: (ns, key, value) => config.storage.put(`${ns}:${key}`, value),
                async delete(ns, key) {
                    await config.storage.delete(`${ns}:${key}`);
                },
            };
            return ctx.provide("state", backend);
        },
    };
}

/**
 * The capability face of a server-side websocket hub: the exact shape of
 * `WsConnection` in `@lambdot/websocket` (declared locally so the package
 * keeps its single `@lambdot/core` dependency), so the generic
 * `wsInput`/`wsOutput` factories inject it as-is. Where `wsTransport` owns
 * one client socket, the hub fans out over every socket a Durable Object
 * has accepted: `send` broadcasts, `onMessage` receives from any of them.
 */
export interface WebSocketHub {
    readonly url: string;
    /** Send a text frame to every accepted socket. */
    send(data: string): void;
    /** Subscribe to incoming text frames from any accepted socket. */
    onMessage(listener: (data: string) => void): Disposer;
}

/** The typed capability contract for a {@link wsHub} plugin, parameterized by capability name. */
export type WsHubCapability<TCap extends string> = { readonly [K in TCap]: WebSocketHub };

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

/** A {@link wsHub} bundle: the hub the Durable Object accepts sockets into, and the plugin providing it. */
export interface WsHub<TCap extends string> {
    readonly hub: WebSocketHubControl;
    readonly plugin: FeaturePlugin<
        {},
        {},
        undefined,
        WsHubConfig,
        `ws-hub:${TCap}`,
        WsHubCapability<TCap>
    >;
}

/**
 * The server-side mirror of `wsTransport`: instead of dialing out, a Durable
 * Object accepts incoming sockets. `wsHub` returns the two halves of that —
 * the hub the Durable Object's fetch handler accepts `WebSocketPair` server
 * ends into, and the plugin that provides the hub under `capability`, so the
 * generic `wsInput`/`wsOutput` halves (or a `wsPlatform` bundle minus its
 * transport) drive it unchanged:
 *
 * ```ts
 * const room = wsHub("room");
 * const chat = wsPlatform("room", chatSpec);
 *
 * class ChatRoom extends DurableObject {
 *     private kernel = createKernel()
 *         .use(room.plugin, { url })
 *         .use(chat.input)
 *         .use(chat.output);
 *     async fetch(request: Request) {
 *         await this.kernel.start();
 *         const pair = new WebSocketPair();
 *         room.hub.accept(pair[1]);
 *         return new Response(null, { status: 101, webSocket: pair[0] });
 *     }
 * }
 * ```
 */
export function wsHub<TCap extends string>(capability: TCap): WsHub<TCap> {
    const sockets = new Set<WebSocket>();
    const listeners = new Set<(data: string) => void>();

    // `url` is only known once the plugin activates with its config, so the
    // hub object stays mutable behind the readonly capability face.
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

    const plugin: WsHub<TCap>["plugin"] = {
        name: `ws-hub:${capability}`,
        apply(ctx, config) {
            hub.url = config.url;
            // See `durableObjectNamespace` for why `provide` is pinned here.
            return (ctx.provide as (name: TCap, value: WebSocketHub) => Disposer).call(
                ctx,
                capability,
                hub,
            );
        },
    };

    return { hub, plugin };
}
