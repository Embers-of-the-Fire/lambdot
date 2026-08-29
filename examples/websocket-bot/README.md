# websocket-bot

A self-verifying echo bot over a real websocket — the reference example for
lambdot's **typed capability** model: a general transport plugin defers all
platform behavior to a later spec, shared through the kernel's capability
fold.

```console
$ nub index.ts
driver received: echo: hello from driver
websocket-bot: OK
```

The example starts its own broadcast server in-process, boots the kernel
against it, drives the bot with a raw client, and exits non-zero if the round
trip fails — it is its own integration test.

## What it demonstrates

1. **The transport is a capability, not an input/output.** `wsTransport("ws")`
   (from `@lambdot/websocket`) owns the socket and nothing else: no event
   kinds, no addresses, no content contract. It provides the live connection
   as a typed value under the `ws` capability (`TProvides = WsCapability<"ws">`),
   so `ctx.provide("ws", connection)` is type-checked and `kernel.ctx.ws`
   reads back typed.
2. **Platform behavior is deferred to a spec.** `WsSpec` carries everything
   the transport cannot know — the platform tag, the event kind, the frame
   codec. The generic `wsInput("ws", spec)` / `wsOutput("ws", spec)` factories
   build the platform halves from it; a second platform (discord, qq, …)
   costs one spec object, ~15 lines. Event kinds and output contracts still
   flow through the generic fold, so registration-order gating keeps working.
3. **The capability name is a parameter, so instances multiply.** Each
   `wsTransport(name)` provides under its own name; two websocket platforms
   (one for discord, one for qq) share a kernel as
   `WsCapability<"ws-discord"> & WsCapability<"ws-qq">` in the fold, each
   platform's plugins gating on their own transport — see `type-test.ts`.
4. **Typed injection, compile-time gated.** The factories declare
   `TInjects = WsCapability<"ws">`; inside `apply`, `ctx.ws` is typed with no
   casts. Registering them before `wsTransport("ws")` is a compile error
   ("unprovided capabilities"), and a consumer declaring the wrong value type
   fails with "mismatched capability types" — see `type-test.ts`.
5. **Runtime activation still applies.** `inject: ["ws"]` keeps the platform
   plugins pending until the socket connects and provides the connection, and
   unloads them if the capability is withdrawn — the compile-time gate orders
   registration, the runtime gate orders activation.

## The plugin chain

Prefer the bundled form: `wsPlatform(capability, spec)` declares one
websocket platform as a triple of plugins — the triple stays separate so
the fold keeps enforcing registration order (transport before the halves
that inject it):

```ts
const wsecho = wsPlatform("ws", echoSpec);

const kernel = createKernel()
    .use(wsecho.transport, { url }) // provides { ws: WsConnection }
    .use(wsecho.input) // ingests "wsecho.message"
    .use(wsecho.output) // sends through the "wsecho" platform
    .use(reply); // echoes each message back
```

Two websocket platforms share one kernel by declaring two bundles under
distinct capability names:

```ts
const discord = wsPlatform("ws-discord", discordSpec);
const qq = wsPlatform("ws-qq", qqSpec);

const kernel = createKernel()
    .use(discord.transport, { url: discordUrl })
    .use(qq.transport, { url: qqUrl })
    .use(discord.input)
    .use(discord.output)
    .use(qq.input)
    .use(qq.output)
    .use(myFeature);
```

The individual `wsTransport` / `wsInput` / `wsOutput` factories the bundle
wraps stay exported for cases that need the pieces separately — points 1–5
above describe how each piece works, and `type-test.ts` exercises them
directly.

Swapping in a real platform means replacing `echoSpec` (codec, address shape,
event vocabulary) and pointing `url` at a gateway — the transport, the
factories, and the reply feature don't change.
