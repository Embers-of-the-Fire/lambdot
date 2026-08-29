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
   share a kernel as `WsCapability<"ws-a"> & WsCapability<"ws-b">` in the
   fold, each platform's plugins gating on their own transport — see
   `type-test.ts`, and [dual-websocket-bot](../dual-websocket-bot) for the
   runnable version.
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
distinct capability names, with tagged specs (one factory call per
instance) so the platform tags and event kinds stay unique:

```ts
const wsechoA = wsPlatform("ws-a", echoSpec("a"));
const wsechoB = wsPlatform("ws-b", echoSpec("b"));

const kernel = createKernel()
    .use(wsechoA.transport, { url: urlA })
    .use(wsechoA.input)
    .use(wsechoA.output)
    .use(wsechoB.transport, { url: urlB })
    .use(wsechoB.input)
    .use(wsechoB.output)
    .use(reply);
```

This sketch is realized in [dual-websocket-bot](../dual-websocket-bot),
where `echoSpec(tag)` mints one spec per instance and a raw client drives
both sockets concurrently to prove no cross-dispatch.

The individual `wsTransport` / `wsInput` / `wsOutput` factories the bundle
wraps stay exported for cases that need the pieces separately — points 1–5
above describe how each piece works, and `type-test.ts` exercises them
directly.

Swapping in a real platform means replacing `echoSpec` (codec, address shape,
event vocabulary) and pointing `url` at a gateway — the transport, the
factories, and the reply feature don't change.

## File layout

| File           | Role                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `echo-spec.ts` | The platform's specific half: platform tag, event kind, frame codec. |
| `server.ts`    | Demo broadcast server standing in for a real chat service.           |
| `index.ts`     | Composition root: server, kernel, raw-client round trip, self-check. |
| `type-test.ts` | Compile-time assertions for the generic factories and the fold.      |

## Where next

- [dual-websocket-bot](../dual-websocket-bot) — two tagged instances of this
  exact platform sharing one kernel.
- [multi-kernel-bot](../multi-kernel-bot) — the same bot twice, but isolated
  in two kernels with an explicit bridge.
