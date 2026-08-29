# dual-websocket-bot

Two websocket platforms, **one kernel** — the tagged-instance story of the
lambdot design. Both platforms are the same `wsPlatform` bundle from
`@lambdot/websocket`, instantiated twice under distinct capability names, so
one reply feature serves both sockets while the fold keeps every
registration compile-time gated.

```console
$ nub index.ts
[wsecho-a] id=dbc12a65-... kind=wsecho-a.message payload=hello from driver A
[wsecho-b] id=9e68321a-... kind=wsecho-b.message payload=hello from driver B
driver A received: echo(wsecho-a): hello from driver A
driver B received: echo(wsecho-b): hello from driver B
dual-websocket-bot: OK
```

The example starts two broadcast servers in-process (ports 8080/8081), boots
one kernel against both, drives each instance with a raw client concurrently,
and exits non-zero if any reply arrives on the wrong socket — it is its own
integration test.

## What it demonstrates

1. **One kernel, two tagged instances.** `wsPlatform("ws-a", echoSpec("a"))`
   and `wsPlatform("ws-b", echoSpec("b"))` declare the same platform shape
   twice. The capability names (`ws-a`, `ws-b`) fold side by side as
   `WsCapability<"ws-a"> & WsCapability<"ws-b">`, and each platform's
   input/output injects only its own transport's connection — see
   [`specs.ts`](./specs.ts) for the tag-parameterized spec and
   [`index.ts`](./index.ts) for the chain.
2. **The tag is not cosmetic — it is the dispatch key.** A second instance
   is only safe when the tag differs everywhere a string keys a registry:
   the bus's event kind (`wsecho-a.message` vs `wsecho-b.message`), the
   kernel's output registry (`platform`), and the transport's capability
   name. Reusing one spec twice throws at activation with "duplicate output
   for platform", and even without that check, same-kind events from both
   sockets would merge into one dispatch stream — the envelope carries no
   socket identity beyond the address.
3. **Replies route by address, not by subscription.** Each event's
   `address.platform` names the platform it arrived on, and `ctx.send` sends
   through the output that owns that platform, so each reply leaves through
   the socket its request came from. `ContentFor` distributes over the
   address union, so one handler type-checks for both platforms (both accept
   `string`).
4. **Shared middleware, shared queue.** Both instances feed one ingress
   waterfall — authentication, logging, and filtering see every event from
   both sockets — and one sequential event queue, so read-modify-write in
   handlers stays race-free across instances. That is the point of sharing a
   kernel; if you want isolation instead, see `multi-kernel-bot`.

## How the instances stay separate

```ts
// specs.ts — one spec per tag: platform, kind, and codec all carry it
export function echoSpec<TTag extends string>(tag: TTag) {
    const platform = `wsecho-${tag}` as const;
    return {
        platform,
        kind: `${platform}.message`,
        decode: (data) => ({ payload: data, address: { platform } }),
        encode: (content) => content,
    };
}

// index.ts — two bundles, one chain, one reply feature
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

The reply feature subscribes to both kinds and lets the address do the
routing:

```ts
const reply = definePlugin<Events, Outputs>({
    name: "reply",
    apply(ctx) {
        function onMessage(
            event: BotEvent<string, string, WsEchoAddress<"a"> | WsEchoAddress<"b">>,
        ) {
            return ctx.send(event.address, `echo(${event.address.platform}): ${event.payload}`);
        }

        return [ctx.on("wsecho-a.message", onMessage), ctx.on("wsecho-b.message", onMessage)];
    },
});
```

## File layout

| File        | Role                                                                |
| ----------- | ------------------------------------------------------------------- |
| `specs.ts`  | The tag-parameterized spec: platform, kind, and codec per instance. |
| `server.ts` | Demo broadcast server standing in for a real chat service.          |
| `index.ts`  | Boots the kernel, drives both instances, verifies no cross-talk.    |

## When to choose this over multiple kernels

- **One kernel, tagged instances** (this example): the platforms are
  genuinely one bot — shared middleware (the ingress waterfall sees
  everything), shared state, one sequential event queue, replies routed by
  the shared fold.
- **Multi-kernel** (`multi-kernel-bot`): you want hard isolation —
  independent restart and failure domains, no shared middleware, homogeneous
  bot farms where every instance registers the byte-for-byte identical,
  untagged plugin stack — and you accept that anything crossing instances
  goes through a bridge you write.

For the single-instance walkthrough of the `wsPlatform` bundle itself, see
`websocket-bot`.
