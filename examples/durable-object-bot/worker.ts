import type { Message, StateBackend, Stream } from "@lambdot/core";
import { createKernel, createStateAccessor, definePlugin, mapStream } from "@lambdot/core";
import type { DurableObjectNamespace, DurableObjectStorage, WsHub } from "@lambdot/host-cloudflare";
import { doState, durableObjectNamespace, wsHub } from "@lambdot/host-cloudflare";
import { wsPlatform } from "@lambdot/websocket";
import { DurableObject } from "cloudflare:workers";

import type { DoChatAddress } from "./chat-spec.ts";
import { chatSpec } from "./chat-spec.ts";

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

interface ChatSchema {
    count: number;
}

/** One inbound room chat message. */
export type DoChatMessage = Message<string, DoChatAddress>;

/**
 * The room's chat feature: each frame increments a counter in the Durable
 * Object instance's own storage (served through `doState`) and the reply
 * goes out through the room's output — which broadcasts to every socket the
 * hub has accepted. Identity wiring: both inputs ("dochat" message stream,
 * "state" backend) are namespaces in the same composition.
 */
const reply = definePlugin({
    name: "reply",
    apply(input: { dochat: Stream<DoChatMessage>; state: StateBackend }) {
        const state = createStateAccessor<ChatSchema>(input.state, "reply");
        return mapStream(input.dochat, async (event) => {
            const count = ((await state.get("count")) ?? 0) + 1;
            await state.set("count", count);
            return { address: event.address, content: `echo (#${count}): ${event.payload}` };
        });
    },
});

function createRoomKernel(room: WsHub<"room">, url: string, storage: DurableObjectStorage) {
    const chat = wsPlatform("dochat", chatSpec);
    return (
        createKernel()
            // the hub rides the composition as an internal namespace
            .bind(room.plugin, { option: { url } })
            .use(chat.input, { mapping: (ctx) => ({ connection: ctx.room }) })
            // serves the "state" namespace from the instance's storage
            .bind(doState(), { option: { storage } })
            // identity wiring: { dochat, state } are both visible to reply
            .use(reply)
            .bind(chat.output, {
                mapping: (ctx) => ({ connection: ctx.room, commands: ctx.reply }),
            })
    );
}

/**
 * The Durable Object: one instance per room name, holding the accepted
 * sockets (through the hub) and the composition that drives them. The
 * composition is booted once per instance — `start` is idempotent —
 * mirroring the per-isolate bot in `../cloudflare-bot`. Extends the
 * `DurableObject` base class from the built-in `cloudflare:workers` module
 * (the documented shape; its `ctx`/`env` are typed via the local declaration
 * in `cloudflare-workers.d.ts`).
 */
export class ChatRoom extends DurableObject<Env> {
    private readonly roomHub = wsHub("room");
    private kernel: ReturnType<typeof createRoomKernel> | undefined;

    async fetch(request: Request): Promise<Response> {
        if (!isWebSocketUpgrade(request))
            return new Response("expected a websocket upgrade", { status: 426 });

        this.kernel ??= createRoomKernel(this.roomHub, request.url, this.ctx.storage);
        await this.kernel.start();

        const pair = new WebSocketPair();
        this.roomHub.hub.accept(pair[1]);
        // `webSocket` on ResponseInit is a workers extension.
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
}

/**
 * The worker-side router composition: the room namespace binding as a typed
 * namespace value, read back as `router.ctx.rooms`.
 */
function createRouter(env: Env) {
    return createKernel().use(durableObjectNamespace("rooms"), { option: { binding: env.ROOM } });
}

// Workers hand bindings out per request; boot the router composition once
// per isolate and reuse it after that (`start` is idempotent).
let router: ReturnType<typeof createRouter> | undefined;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const roomName = /^\/room\/(?<name>[\w-]+)$/.exec(new URL(request.url).pathname)?.groups
            ?.name;
        if (roomName === undefined || !isWebSocketUpgrade(request))
            return new Response("not found", { status: 404 });

        router ??= createRouter(env);
        await router.start();
        const rooms = router.ctx.rooms;
        return rooms.get(rooms.idFromName(roomName)).fetch(request);
    },
};
