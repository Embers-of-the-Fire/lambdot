# multi-bot

Two instances of **the same bot definition**, nested under namespaces of a
supervisor composition — the isolation story of the lambdot design.
"Composing two plugins yields a plugin": `createEchoBot(name, url)` returns
a composed plugin, and the supervisor composes it twice, `with` — hermetic,
blank-context — so the two bots share nothing. Anything crossing between
them goes through a bridge the supervisor writes.

```console
$ nub index.ts
[botA] hello from A
[botA] @all hello everyone
[botB] hello everyone
multi-bot: OK — nested compositions, explicit bridge
```

The example starts two broadcast servers in-process, applies the supervisor
composition, drives each bot with a raw client, and exits non-zero if
isolation breaks or the bridge drops traffic — it is its own integration
test.

## What it demonstrates

1. **Nesting is uniform (spec §4.5).** A composed plugin is a plugin.
   `createEchoBot` builds a root plugin, composes a `wsConnection` and a
   bridge port into it with `with`, adds a reply feature with `use`, and
   returns the whole thing. The supervisor's `.with(createEchoBot("botA",
urlA))` nests the bot's own item map under one namespace of the
   supervisor's context: `ctx.botA` is the bot's surface, typed.
2. **The surface is the root's own item map.** The bot's root logic runs
   last, over the accumulated context, and re-exports exactly what the
   parent may see — `{ listen, bridge }`. The socket and the reply feature
   are input-side scaffolding: invisible to the supervisor, unnameable in
   its mappings.
3. **Isolation falls out of composition.** Both bots are hermetic
   dependencies: each is granted a blank context, so neither can observe
   the other or the supervisor. Both bots compose the byte-for-byte
   identical definition — no tags, no renaming tricks — because namespaces
   are per-composition. (Contrast [dual-websocket-bot](../dual-websocket-bot),
   where two connections share one context on purpose.)
4. **Cross-bot traffic is an ordinary plugin.** `bridgeAll` declares
   `{ source: EchoBotSurface; target: BridgePort }` and subscribes to the
   source's `listen`, pushing "@all " traffic into the target's `bridge`
   port. The mapping — `(ctx) => ({ source: ctx.botA, target: ctx.botB.bridge })`
   — is typed against the nested item maps, so bridging to something a bot
   doesn't expose is a compile error.
5. **Teardown unwinds the tree.** One `createScope()` owns the whole
   application; disposing it unsubscribes the bridge, then each bot's
   listener and socket, in reverse dependency order.

## File layout

| File        | Role                                                               |
| ----------- | ------------------------------------------------------------------ |
| `bot.ts`    | The bot factory: one definition, composed twice by the supervisor. |
| `server.ts` | Demo broadcast server standing in for a real chat service.         |
| `index.ts`  | Supervisor composition, bridge plugin, drivers, self-checks.       |

## See also

- [websocket-bot](../websocket-bot) — the single-connection echo bot.
- [dual-websocket-bot](../dual-websocket-bot) — two connections sharing one
  context deliberately, the alternative to nesting.
