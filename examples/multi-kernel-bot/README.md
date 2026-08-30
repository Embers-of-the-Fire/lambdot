# multi-kernel-bot

Two echo bots, **two kernels**, one supervisor — the isolation story of the
lambdot design. Each composition is a full isolation boundary (its own
namespaces, streams, and wiring), so N identical bot instances need no
namespacing at all, and cross-composition traffic flows only through
bridges the supervisor wires explicitly.

```console
$ nub run -F @lambdot-example/multi-kernel-bot start
[bot A] id=dbc12a65-... payload=hello from A
[bot A] id=ee710d76-... payload=@all hello everyone
[bot B] id=9e68321a-... payload=hello everyone
multi-kernel-bot: OK — isolated dispatch, explicit bridge
```

The example starts two broadcast servers (ports 8080/8081), boots one kernel
against each, drives both with raw clients, and exits non-zero if isolation
or the bridge misbehaves — it is its own integration test.

## What it demonstrates

1. **The composition is the isolation boundary.** Both bots compose the
   byte-for-byte identical plugin stack — same `"wsecho"` platform, same
   namespace names (`wsecho`, `bridge`, `ingress`, `reply`). Nothing
   collides because namespaces are per-composition. Contrast with
   [dual-websocket-bot](../dual-websocket-bot) (two platforms in _one_
   kernel), where every instance needs a distinct name tag.
2. **Instance identity lives in config, not in types.** The bots differ
   only in factory arguments — a name for logs and a URL for the socket
   (the transport's `option: { url }`). The composition's types stay exact
   and tag-free.
3. **Composition across kernels is an explicit, typed bridge.** A bot that
   accepts cross-kernel traffic exposes a narrow handle: the `bridge` plugin
   emits a `BridgePort` — `{ stream, push }` — built on a `channel`, and an
   `ingress` plugin merges `bridge.stream` with the socket's own message
   stream (`mergeStreams`). The supervisor wires kernels with plain code —
   `pumpStream(botA.ctx.wsecho, …)` calling `botB.ctx.bridge.push(…)` —
   fully typed at both ends, no casts, no string rewriting, no core
   changes. Streams broadcast, so the supervisor's tap on
   `botA.ctx.wsecho` does not steal traffic from bot A's own pipeline.
   Nothing crosses kernels unless the supervisor wires it.
4. **Plugin objects are pure specs.** Plugin state lives in `apply`
   closures, so a plugin object carries no per-kernel state — safe to share
   across compositions, with namespaces still private to each. The bot
   factory mints fresh instances per call anyway (`wsPlatform(…)`,
   `bridgePort()` inside `createEchoBot`), keeping each composition
   self-contained by construction — see the comment in
   [`bot.ts`](./bot.ts).

## How the bridge works

```ts
// bot.ts — each bot exposes a narrow push handle as its "bridge" namespace
function bridgePort(): Plugin<void, BridgePort, void, "bridge"> {
    return definePlugin({
        name: "bridge",
        apply() {
            const inbound = channel<WsEchoMessage>();
            const port: BridgePort = {
                stream: inbound.stream,
                push: (payload) => inbound.push(message(payload, { platform: "wsecho" })),
            };
            return port;
        },
    });
}

// index.ts — the supervisor wires A → B for "@all" messages
const unbridge = pumpStream(
    botA.ctx.wsecho,
    (event) => {
        if (event.payload.startsWith("@all ")) {
            botB.ctx.bridge.push(event.payload.slice("@all ".length));
        }
    },
    console.error,
);
```

A bridged message enters kernel B through the real pipeline: the `ingress`
plugin merges `bridge.stream` with the socket's message stream, so it flows
through B's reply feature and out B's output exactly like a native message
— kernel A's internals are invisible to it.

## File layout

| File           | Role                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `bot.ts`       | The bot factory: one composition per call, plus the `bridge` handle. |
| `echo-spec.ts` | The untagged websocket spec — identical in every kernel.             |
| `server.ts`    | Demo broadcast server standing in for a real chat service.           |
| `index.ts`     | The supervisor: lifecycle, the A → B bridge, self-checking drivers.  |

## When to choose this over one kernel

- **One kernel, tagged instances** ([dual-websocket-bot](../dual-websocket-bot)):
  the platforms are
  genuinely one bot — shared features tapping the same broadcast streams,
  shared state namespaces, one merged reply stream filtered per platform at
  the wiring.
- **Multi-kernel** (this example): you want hard isolation — independent
  restart and failure domains, no shared streams, homogeneous bot farms —
  and you accept that anything crossing instances goes through a bridge you
  write.
