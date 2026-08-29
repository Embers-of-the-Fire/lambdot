# durable-object-bot

A chat-room bot embedded in a Cloudflare **Durable Object** — the websocket
counterpart of [`../cloudflare-bot`](../cloudflare-bot): each room name maps
to one Durable Object instance, which accepts the room's websocket clients
into a hub and drives them with a kernel, with the room's message counter
served from the instance's own transactional storage.

```console
$ nub run -F @lambdot-example/durable-object-bot start
lobby broadcast: "echo (#1): hello" reached both clients
lobby counter:   "echo (#2): again"
other room:      "echo (#1): hi" (isolated counter)
durable-object-bot: OK
```

Like cloudflare-bot there is no `wrangler.toml`: the example runs the worker
locally under miniflare (a real workerd isolate with an emulated Durable
Object namespace, `durableObjects: { ROOM: "ChatRoom" }` in
[`index.ts`](./index.ts)), bundled with esbuild first because workerd runs
plain ESM. The driver then opens three real websocket clients against
miniflare's listening socket and asserts the round trips — it is its own
integration test, exiting non-zero on any wrong frame.

## What it demonstrates

1. **A `wsHub` in place of `wsTransport`.** `wsTransport` (see
   [`../websocket-bot`](../websocket-bot)) dials out: one client socket,
   provided as a `WsConnection` capability. A Durable Object is the mirror
   image — it _accepts_ sockets — so `wsHub("room")` from
   `@lambdot/host-cloudflare` provides a hub with the exact `WsConnection`
   shape instead, and the generic `wsPlatform` input/output halves drive it
   unchanged. The difference is fan-out: the hub's `send` broadcasts to every
   accepted socket, so one frame from client A reaches client B too.
2. **A kernel per Durable Object instance.** The `ChatRoom` class boots its
   kernel lazily on the first upgrade (`start` is idempotent) and accepts the
   server end of each `WebSocketPair` into the hub afterwards. The platform
   bundle is created _inside_ `createRoomKernel`, not at module scope:
   `wsOutput` keeps its connection in the bundle's closure, and all instances
   of a Durable Object class share one isolate — a shared bundle would
   cross-wire their sockets (workerd rejects it: "Cannot perform I/O on
   behalf of a different Durable Object").
3. **Per-instance state with `doState()`.** The `reply` feature counts
   messages through `ctx.state.for("reply")`, served from the instance's
   transactional storage — passed straight as config
   (`.use(doState(), { storage: this.state.storage })`), since a Durable
   Object's storage arrives on its constructor state, not on `env`. Two rooms
   on one namespace never share a value: "other" starts its counter at zero
   while "lobby" is at two.
4. **The namespace binding as a capability.** The worker's fetch handler is
   a router: `durableObjectNamespace("rooms")` provides the binding through a
   small per-isolate kernel, so the route reads
   `router.ctx.rooms.get(router.ctx.rooms.idFromName(name)).fetch(request)`
   typed by the fold — the same bindings-as-capabilities model as
   cloudflare-bot's KV namespace.

## The plugin chain

```ts
function createRoomKernel(room: WsHub<"room">, url: string, storage: DurableObjectStorage) {
    const chat = wsPlatform("room", chatSpec); // per-instance, see above
    return createKernel()
        .use(room.plugin, { url }) // provides the hub as the "room" capability
        .use(chat.input) // hub frames -> "dochat.message" events
        .use(chat.output) // ctx.send -> hub broadcast
        .use(doState(), { storage }) // serves ctx.state from the instance's storage
        .use(reply); // counts, echoes
}
```

The Durable Object handler is plain worker code around that kernel —
extending the `DurableObject` base class from the built-in
`cloudflare:workers` module (the documented shape; workerd resolves the
import at runtime, esbuild leaves it external, and its `ctx`/`env` are
typed via the local declaration in `cloudflare-workers.d.ts`):

```ts
export class ChatRoom extends DurableObject<Env> {
    private readonly roomHub = wsHub("room");
    private kernel: ReturnType<typeof createRoomKernel> | undefined;

    async fetch(request: Request): Promise<Response> {
        // ... reject non-upgrades with 426 ...
        this.kernel ??= createRoomKernel(this.roomHub, request.url, this.ctx.storage);
        await this.kernel.start();

        const pair = new WebSocketPair();
        this.roomHub.hub.accept(pair[1]); // server end
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
}
```

## File layout

| File                      | Role                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `worker.ts`               | The worker: `ChatRoom` Durable Object, per-instance kernel, room router.          |
| `chat-spec.ts`            | The platform spec: plain-text frames, one `dochat.message` event kind.            |
| `cloudflare-workers.d.ts` | The local type declaration for the `cloudflare:workers` built-in module.          |
| `index.ts`                | The driver: esbuild bundle, miniflare with the DO namespace, self-checking rooms. |

The Durable Object pieces themselves live in
[`../../packages/host/cloudflare`](../../packages/host/cloudflare):
`durableObjectNamespace` for the binding, `doState` for the
storage-backed `StateBackend` bridge, and `wsHub` for the server-side
socket hub. The binding types (`DurableObjectNamespace`,
`DurableObjectState`, `DurableObjectStorage`) are structural subsets declared
locally, exactly like the KV/D1/R2 bindings.
