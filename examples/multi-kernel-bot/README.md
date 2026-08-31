# multi-kernel-bot

Two echo bots, **two engines**, one supervisor kernel — the isolation story
of the lambdot design. Each bot is a full composition sealed by
`expose(name)` into an `Engine`: its namespaces, streams, and wiring stay
private, its type is erased down to a name and a narrow public surface, and
the supervisor composes the engines exactly like plugins — cross-composition
traffic flows only through a bridge the supervisor wires explicitly.

```console
$ nub run -F @lambdot-example/multi-kernel-bot start
[botA] id=dbc12a65-... payload=hello from A
[botA] id=ee710d76-... payload=@all hello everyone
[botB] id=9e68321a-... payload=hello everyone
multi-kernel-bot: OK — isolated dispatch, typed engine bridge
```

The example starts two broadcast servers (ports 8080/8081), boots one engine
against each inside a supervisor kernel, drives both with raw clients, and
exits non-zero if isolation or the bridge misbehaves — it is its own
integration test.

## What it demonstrates

1. **The composition is the isolation boundary.** Both bots compose the
   byte-for-byte identical plugin stack — same `"wsecho"` platform, same
   namespace names (`wsecho`, `bridge`, `ingress`, `reply`). Nothing
   collides because namespaces are per-composition. Contrast with
   [dual-websocket-bot](../dual-websocket-bot) (two platforms in _one_
   kernel), where every instance needs a distinct name tag.
2. **Instance identity lives in config, not in types.** The bots differ
   only in factory arguments — a name for logs and the engine's namespace,
   a URL for the socket (the transport's `option: { url }`). The
   composition's types stay exact and tag-free.
3. **`expose` turns a bot into a typed artifact.** The factory seals each
   composition with `.expose(name)`, erasing everything the supervisor
   must not see: `ingress`, `reply`, and both transport halves are
   `bind`ed, so the engine's type is exactly
   `Engine<void, EchoBotSurface, TName>` — the inbound stream to tap and
   the `BridgePort` to push into. The name is inferred as a literal, so
   `ctx.botA` / `ctx.botB` typecheck exactly; an internal like
   `ctx.botA.reply` is a compile error.
4. **Composition across kernels is ordinary composition.** The supervisor
   is itself a kernel: it `use`s the two engines and `bind`s a plain
   bridge plugin whose declared input is the narrow contract
   (`{ source, target }`). The wiring `mapping` —
   `{ source: ctx.botA.wsecho, target: ctx.botB.bridge }` — is fully typed
   against the engines' surfaces. Startup order (engines first, bridge
   pump last) and teardown order (pump detaches before the engines stop)
   fall out of composition order; there is no manual lifecycle code.
5. **Plugin objects are pure specs.** Plugin state lives in `apply`
   closures, so a plugin object carries no per-kernel state — safe to share
   across compositions, with namespaces still private to each. The bot
   factory mints fresh instances per call anyway (`wsPlatform(…)`,
   `bridgePort()` inside `createEchoBot`), keeping each composition
   self-contained by construction — see the comment in
   [`bot.ts`](./bot.ts).

## How the bridge works

```ts
// index.ts — cross-kernel policy as an ordinary plugin
const bridgeAll = definePlugin({
    name: "bridge/all",
    apply(input: { source: Stream<WsEchoMessage>; target: BridgePort }, scope) {
        scope.onDispose(
            pumpStream(
                input.source,
                (event) => {
                    if (event.payload.startsWith("@all ")) {
                        input.target.push(event.payload.slice("@all ".length));
                    }
                },
                (error) => scope.onError(error),
            ),
        );
    },
});

const supervisor = createKernel()
    .use(createEchoBot("botA", urlA))
    .use(createEchoBot("botB", urlB))
    .bind(bridgeAll, {
        mapping: (ctx) => ({ source: ctx.botA.wsecho, target: ctx.botB.bridge }),
    });
```

A bridged message enters kernel B through the real pipeline: the `ingress`
plugin merges `bridge.stream` with the socket's message stream, so it flows
through B's reply feature and out B's output exactly like a native message
— kernel A's internals are invisible to it. And because the tap on
`ctx.botA.wsecho` rides a broadcast stream, it does not steal traffic from
bot A's own pipeline.

## File layout

| File           | Role                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| `bot.ts`       | The bot factory: one composition per call, sealed by `expose` into an engine. |
| `echo-spec.ts` | The untagged websocket spec — identical in every kernel.                      |
| `server.ts`    | Demo broadcast server standing in for a real chat service.                    |
| `index.ts`     | The supervisor kernel: the engines, the bridge plugin, self-checking drivers. |

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
