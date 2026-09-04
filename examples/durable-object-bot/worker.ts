import type { OwnedScope } from "@lambdot/core";
import { createScope, definePlugin } from "@lambdot/core";
import type {
    DurableObjectNamespace,
    DurableObjectStorage,
    WebSocketHub,
    WsHub,
} from "@lambdot/host-cloudflare";
import { doStorage, durableObjectNamespace, wsHub } from "@lambdot/host-cloudflare";
import { DurableObject } from "cloudflare:workers";

/** The worker's named bindings, as declared in the miniflare/wrangler config. */
type Env = {
    readonly ROOM: DurableObjectNamespace;
};

/**
 * The workers runtime global behind a server-side upgrade: index 0 is the
 * client end (returned with the 101 response), index 1 the server end
 * (accepted inside the Durable Object). Declared locally because the repo
 * types against Node, not `@cloudflare/workers-types`.
 */
declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

/**
 * Whether the request asks for a websocket upgrade. `Upgrade` is a
 * comma-separated list of ASCII case-insensitive tokens (RFC 9110 §7.8), so
 * `WebSocket` (or `websocket, h2c`) must match just like `websocket` —
 * otherwise a stricter client gets a spurious 404/426 mid-handshake.
 */
function isWebSocketUpgrade(request: Request): boolean {
    return (request.headers.get("Upgrade") ?? "")
        .split(",")
        .some((token) => token.trim().toLowerCase() === "websocket");
}

/**
 * The room's chat feature: each frame increments a counter in the Durable
 * Object instance's own storage (emitted by `doStorage`) and the reply goes
 * out through the room's hub — which broadcasts to every accepted socket.
 * Both inputs are plain host APIs declared directly; there is no framework
 * state or stream contract. Identity wiring: both namespaces ("room",
 * "storage") are visible when the feature composes.
 */
const reply = definePlugin({
    name: "reply",
    apply(input: { room: WebSocketHub; storage: DurableObjectStorage }, scope) {
        const onFrame = async (data: string): Promise<void> => {
            const count = ((await input.storage.get<number>("count")) ?? 0) + 1;
            await input.storage.put("count", count);
            input.room.push(`echo (#${count}): ${data}`);
        };
        scope.onDispose(
            input.room.listen((data) => {
                onFrame(data).catch((error: unknown) => scope.onError(error));
            }),
        );
    },
});

function createRoomApp(room: WsHub<"room">, url: string, storage: DurableObjectStorage) {
    return (
        definePlugin({ name: "room-app", apply: () => ({}) })
            // the hub rides the composition as the "room" namespace
            .with(room.plugin, { option: { url } })
            // serves the "storage" namespace from the instance's storage
            .with(doStorage(), { option: { storage } })
            // identity wiring: { room, storage } are both visible to reply
            .use(reply)
    );
}

/**
 * The Durable Object: one instance per room name, holding the accepted
 * sockets (through the hub) and the composition that drives them. The
 * composition is applied once per instance, mirroring the per-isolate bot
 * in `../cloudflare-bot`. Extends the `DurableObject` base class from the
 * built-in `cloudflare:workers` module (the documented shape; its
 * `ctx`/`env` are typed via the local declaration in
 * `cloudflare-workers.d.ts`).
 */
export class ChatRoom extends DurableObject<Env> {
    private readonly roomHub = wsHub("room");
    private scope: OwnedScope | undefined;

    async fetch(request: Request): Promise<Response> {
        if (!isWebSocketUpgrade(request))
            return new Response("expected a websocket upgrade", { status: 426 });

        if (this.scope === undefined) {
            this.scope = createScope();
            await createRoomApp(this.roomHub, request.url, this.ctx.storage).apply(
                {},
                this.scope,
                undefined,
            );
        }

        const pair = new WebSocketPair();
        this.roomHub.hub.accept(pair[1]);
        // `webSocket` on ResponseInit is a workers extension.
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
}

/**
 * The worker-side router composition: the room namespace binding as a
 * typed item-map value, read back from the application's own item map.
 */
function createRouter(env: Env) {
    return definePlugin({
        name: "router",
        apply: (ctx: { rooms: DurableObjectNamespace }) => ({ rooms: ctx.rooms }),
    }).with(durableObjectNamespace("rooms"), { option: { binding: env.ROOM } });
}

// Workers hand bindings out per request; apply the router composition once
// per isolate and reuse it after that.
let router: { items: { rooms: DurableObjectNamespace }; scope: OwnedScope } | undefined;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const roomName = /^\/room\/(?<name>[\w-]+)$/.exec(new URL(request.url).pathname)?.groups
            ?.name;
        if (roomName === undefined || !isWebSocketUpgrade(request))
            return new Response("not found", { status: 404 });

        if (router === undefined) {
            const scope = createScope();
            const items = await createRouter(env).apply({}, scope, undefined);
            router = { items, scope };
        }
        const { rooms } = router.items;
        return rooms.get(rooms.idFromName(roomName)).fetch(request);
    },
};
