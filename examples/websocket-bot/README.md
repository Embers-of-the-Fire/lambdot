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

1. **The transport is a capability, not an input/output.** `wsTransport()`
   owns the socket and nothing else: no event kinds, no addresses, no content
   contract. It provides the live connection as a typed value under the `ws`
   capability (`TProvides = WsCapability`), so `ctx.provide("ws", connection)`
   is type-checked and `kernel.ctx.ws` reads back typed.
2. **Platform behavior is deferred to a spec.** `WsSpec` carries everything
   the transport cannot know — the platform tag, the event kind, the frame
   codec. The generic `wsInput(spec)` / `wsOutput(spec)` factories build the
   platform halves from it; a second platform (discord, twitter, …) costs one
   spec object, ~15 lines. Event kinds and output contracts still flow
   through the generic fold, so registration-order gating keeps working.
3. **Typed injection, compile-time gated.** The factories declare
   `TInjects = WsCapability`; inside `apply`, `ctx.ws` is typed with no
   casts. Registering them before `wsTransport()` is a compile error
   ("unprovided capabilities"), and a consumer declaring the wrong value type
   fails with "mismatched capability types" — see `type-test.ts`.
4. **Runtime activation still applies.** `inject: ["ws"]` keeps the platform
   plugins pending until the socket connects and provides the connection, and
   unloads them if the capability is withdrawn — the compile-time gate orders
   registration, the runtime gate orders activation.

## The plugin chain

```ts
const kernel = createKernel()
    .use(wsTransport(), { url }) // provides { ws: WsConnection }
    .use(wsInput(echoSpec)) // ingests "wsecho.message"
    .use(wsOutput(echoSpec)) // sends through the "wsecho" platform
    .use(reply); // echoes each message back
```

Swapping in a real platform means replacing `echoSpec` (codec, address shape,
event vocabulary) and pointing `url` at a gateway — the transport, the
factories, and the reply feature don't change.
