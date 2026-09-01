# durable-object-bot

A chat-room bot embedded in a Cloudflare **Durable Object** — the websocket
counterpart of [`../cloudflare-bot`](../cloudflare-bot): each room name maps
to one Durable Object instance, which accepts the room's websocket clients
into a hub and drives them with a composition, with the room's message
counter kept in the instance's own transactional storage.

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

1. **A `wsHub` in place of `wsConnection`.** `wsConnection` (see
   [`../websocket-bot`](../websocket-bot)) dials out: one client socket,
   emitted as its plugin's item map. A Durable Object is the mirror image —
   it _accepts_ sockets — so `wsHub("room")` from `@lambdot/host-cloudflare`
   emits a hub with the same connection shape (`push` / `listen`), and the
   feature consumes it through the ordinary `{ room: WebSocketHub }` input.
   The difference is fan-out: the hub's `push` broadcasts to every accepted
   socket, so one frame from client A reaches client B too.
2. **A composition per Durable Object instance.** The `ChatRoom` class
   applies its composition lazily on the first upgrade, holding the scope
   in instance state, and accepts the server end of each `WebSocketPair`
   into the hub afterwards. The hub is held in instance state, not at
   module scope: it keeps the room's sockets and listeners in closures, and
   all instances of a Durable Object class share one isolate — a shared hub
   would cross-wire their sockets (workerd rejects it: "Cannot perform I/O
   on behalf of a different Durable Object"). The plugin definitions
   themselves are immutable and would be safe to share; the hub is what
   must stay per-instance.
3. **Per-instance state with `doStorage()`.** The `reply` feature counts
   messages through the instance's transactional storage — passed to the
   composition as config (`.with(doStorage(), { option: { storage } })`),
   since a Durable Object's storage arrives on its constructor state, not
   on `env`. The feature declares `{ storage: DurableObjectStorage }` and
   reads/writes it directly; no backend contract, no accessor factory. Two
   rooms on one namespace never share a value: "other" starts its counter
   at zero while "lobby" is at two.
4. **The namespace binding as a typed item-map value.** The worker's fetch
   handler is a router: `durableObjectNamespace("rooms")` emits the binding
   through a small per-isolate composition whose root re-exports it, so the
   route reads `items.rooms.get(items.rooms.idFromName(name)).fetch(request)`
   typed — the same bindings-as-item-maps model as cloudflare-bot's KV
   namespace.

## The room composition

```ts
function createRoomApp(room: WsHub<"room">, url: string, storage: DurableObjectStorage) {
    return definePlugin({ name: "room-app", apply: () => ({}) })
        .with(room.plugin, { option: { url } }) // the hub as the "room" namespace
        .with(doStorage(), { option: { storage } }) // "storage" from the instance
        .use(reply); // identity wiring on { room, storage }: counts, echoes
}
```

The Durable Object handler is plain worker code around that composition —
extending the `DurableObject` base class from the built-in
`cloudflare:workers` module (the documented shape; workerd resolves the
import at runtime, esbuild leaves it external, and its `ctx`/`env` are
typed via the local declaration in `cloudflare-workers.d.ts`):

```ts
export class ChatRoom extends DurableObject<Env> {
    private readonly roomHub = wsHub("room");
    private scope: OwnedScope | undefined;

    async fetch(request: Request): Promise<Response> {
        // ... reject non-upgrades with 426 ...
        if (this.scope === undefined) {
            this.scope = createScope();
            await createRoomApp(this.roomHub, request.url, this.ctx.storage).apply(
                undefined,
                this.scope,
                undefined,
            );
        }

        const pair = new WebSocketPair();
        this.roomHub.hub.accept(pair[1]); // server end
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
    }
}
```

## File layout

| File                      | Role                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `worker.ts`               | The worker: `ChatRoom` Durable Object, per-instance composition, room router.     |
| `cloudflare-workers.d.ts` | The local type declaration for the `cloudflare:workers` built-in module.          |
| `index.ts`                | The driver: esbuild bundle, miniflare with the DO namespace, self-checking rooms. |

The Durable Object pieces themselves live in
[`../../packages/host/cloudflare`](../../packages/host/cloudflare):
`durableObjectNamespace` for the binding, `doStorage` for the instance's
storage, and `wsHub` for the server-side socket hub. The binding types
(`DurableObjectNamespace`, `DurableObjectState`, `DurableObjectStorage`)
are structural subsets declared locally, exactly like the KV/D1/R2
bindings.
