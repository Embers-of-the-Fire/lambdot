# multi-kernel-bot

Two echo bots, **two kernels**, one supervisor — the isolation story of the
lambdot design. Each kernel is a full isolation boundary (its own event bus,
ingest queue, output registry, and capability map), so N identical bot
instances need no namespacing at all, and cross-kernel traffic flows only
through bridges the supervisor wires explicitly.

```console
$ nub run -F @lambdot-example/multi-kernel-bot start
[bot A] id=dbc12a65-... kind=wsecho.message payload=hello from A
[bot A] id=ee710d76-... kind=wsecho.message payload=@all hello everyone
[bot B] id=9e68321a-... kind=wsecho.message payload=hello everyone
multi-kernel-bot: OK — isolated dispatch, explicit bridge
```

The example starts two broadcast servers (ports 8080/8081), boots one kernel
against each, drives both with raw clients, and exits non-zero if isolation
or the bridge misbehaves — it is its own integration test.

## What it demonstrates

1. **The kernel is the isolation boundary.** Both bots register the
   byte-for-byte identical plugin stack — same `"ws"` capability, same
   `"wsecho"` platform, same `"wsecho.message"` kind. Nothing collides
   because the registries those names key into are per-kernel. Contrast with
   `dual-websocket-bot` (two platforms in _one_ kernel), where every
   instance needs distinct capability/platform/kind tags.
2. **Instance identity lives in config, not in types.** The bots differ only
   in factory arguments — a name for logs and a URL for the socket. The type
   fold of each kernel stays exact and tag-free.
3. **Composition is an explicit, typed bridge.** A bot that accepts
   cross-kernel traffic exposes a narrow handle: the `bridge-port` input
   plugin wraps its own `ctx.ingest` (ingestion exists only on the input
   context) and provides it as a typed `bridge` capability. The supervisor
   wires kernels with plain code — `botA.ctx.on(...)` calling
   `botB.ctx.bridge.ingest(...)` — fully typed at both ends, no casts, no
   string rewriting, no core changes. Nothing crosses kernels unless the
   supervisor wires it.
4. **Plugin objects are single-kernel.** `wsOutput` keeps its connection in
   a factory closure, so two kernels sharing one plugin object would
   overwrite each other's connection (bot A's replies would silently leave
   through bot B's socket). The bot factory therefore mints fresh plugin
   instances per kernel — see the comment in [`bot.ts`](./bot.ts).

## How the bridge works

```ts
// bot.ts — each bot exposes a narrow ingest handle as a capability
function bridgePort(): InputPlugin<
    EchoEvents,
    void,
    "bridge-port",
    { readonly bridge: EchoBridge }
> {
    return {
        role: "input",
        name: "bridge-port",
        apply(ctx) {
            return ctx.provide("bridge", {
                ingest: (payload) => ctx.ingest("wsecho.message", payload, { platform: "wsecho" }),
            });
        },
    };
}

// index.ts — the supervisor wires A → B for "@all" messages
const unbridge = botA.ctx.on("wsecho.message", (event) => {
    if (event.payload.startsWith("@all ")) {
        return botB.ctx.bridge.ingest(event.payload.slice("@all ".length));
    }
});
```

A bridged event enters kernel B through the real pipeline: it gets a fresh
`crypto.randomUUID()` id, passes B's ingress waterfall, and is processed on
B's queue — kernel A's internals are invisible to it.

## File layout

| File           | Role                                                                |
| -------------- | ------------------------------------------------------------------- |
| `bot.ts`       | The bot factory: one kernel per call, plus the `bridge` capability. |
| `echo-spec.ts` | The untagged websocket spec — identical in every kernel.            |
| `server.ts`    | Demo broadcast server standing in for a real chat service.          |
| `index.ts`     | The supervisor: lifecycle, the A → B bridge, self-checking drivers. |

## When to choose this over one kernel

- **One kernel, tagged instances** (`dual-websocket-bot`): the platforms are
  genuinely one bot — shared middleware (the ingress waterfall sees
  everything), shared state, one sequential event queue, replies routed by
  the shared fold.
- **Multi-kernel** (this example): you want hard isolation — independent
  restart and failure domains, no shared middleware, homogeneous bot farms —
  and you accept that anything crossing instances goes through a bridge you
  write.
