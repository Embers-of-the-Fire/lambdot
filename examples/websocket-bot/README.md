# websocket-bot

A self-verifying echo bot over a real websocket — the reference example for
lambdot's **generic transport** model: a general transport plugin defers
all platform behavior to a spec, and the pieces are wired together with
`use`/`bind` mappings.

```console
$ nub index.ts
driver received: echo: hello from driver
websocket-bot: OK
```

The example starts its own broadcast server in-process, boots the kernel
against it, drives the bot with a raw client, and exits non-zero if the round
trip fails — it is its own integration test.

## What it demonstrates

1. **The transport is a service, not an input/output.** `wsTransport(name)`
   (from `@lambdot/websocket`) owns the socket and nothing else: no
   platform tag, no addresses, no codec. It emits the live `WsConnection`
   as its output value, so downstream plugins declare it as an ordinary
   input and receive it through a `mapping`. It is composed with `bind`:
   internal wiring, hidden from the final `ctx` but visible to later
   mappings.
2. **Platform behavior is deferred to a spec.** `WsSpec` carries everything
   the transport cannot know — the platform tag, the address shape, the
   frame codec. The generic `wsInput(name, spec)` / `wsOutput(name, spec)`
   factories build the platform halves from it; a second platform (discord,
   qq, …) costs one spec object, ~15 lines. `wsPlatform(name, spec)`
   bundles the three leaves.
3. **Config travels in `option`.** The transport's `{ url }` is its config,
   passed as `option` at wiring time — required exactly because the config
   type is non-void, and validated by the plugin's schema. The input and
   output take no config.
4. **Instances multiply by name.** Composition namespaces key on strings,
   so each `wsPlatform(name, spec)` gets its own `name`, `name/transport`,
   and `name/output` namespaces. Two websocket platforms share a kernel
   side by side, each platform's input/output mapping to its own
   transport's connection — see `type-test.ts`, and
   [dual-websocket-bot](../dual-websocket-bot) for the runnable version.
   Reusing one name twice is a compile-time "duplicate namespace" error.
5. **Wiring order is a compile error.** Each `mapping`'s parameter is typed
   as the namespaces visible so far — `use`d and `bind`ed alike — so wiring
   the input before the transport (its `connection` source) fails to
   compile, and `ctx["wsecho"]` is not accepted where `ctx["wsecho/transport"]`
   is required. `type-test.ts` exercises all of it.

## The plugin chain

Prefer the bundled form: `wsPlatform(name, spec)` declares one websocket
platform as a triple of plugins — the triple stays separate so the mapping
types keep enforcing wiring order (transport before the halves that consume
its connection):

```ts
const wsecho = wsPlatform("wsecho", echoSpec);

const kernel = createKernel()
    .bind(wsecho.transport, { option: { url } })
    .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
    // identity wiring: reply's input keys already match the visible ctx
    .use(reply)
    .bind(wsecho.output, {
        mapping: (ctx) => ({ connection: ctx["wsecho/transport"], commands: ctx.reply }),
    });
```

The input is `use`d, so its message stream is exposed to features under the
platform name (`kernel.ctx.wsecho`); the reply feature maps it into a
command stream, exposed as `ctx.reply`. The output is terminal — it
consumes the reply stream and sends each command's encoded content through
the connection — so it is `bind`ed last.

Two websocket platforms share one kernel by declaring two bundles under
distinct names, with tagged specs (one factory call per instance) so the
platform names and namespaces stay unique:

```ts
const wsechoA = wsPlatform("wsecho-a", echoSpec("a"));
const wsechoB = wsPlatform("wsecho-b", echoSpec("b"));

const kernel = createKernel()
    .bind(wsechoA.transport, { option: { url: urlA } })
    .use(wsechoA.input, { mapping: (ctx) => ({ connection: ctx["wsecho-a/transport"] }) })
    .bind(wsechoB.transport, { option: { url: urlB } })
    .use(wsechoB.input, { mapping: (ctx) => ({ connection: ctx["wsecho-b/transport"] }) })
    .use(reply)
    .bind(wsechoA.output, { mapping: ... })
    .bind(wsechoB.output, { mapping: ... });
```

This sketch is realized in [dual-websocket-bot](../dual-websocket-bot),
where `echoSpec(tag)` mints one spec per instance and a raw client drives
both sockets concurrently to prove no cross-dispatch.

The individual `wsTransport` / `wsInput` / `wsOutput` factories the bundle
wraps stay exported for cases that need the pieces separately — points 1–5
above describe how each piece works, and `type-test.ts` exercises them
through the bundle.

Swapping in a real platform means replacing `echoSpec` (codec, address
shape) and pointing `url` at a gateway — the transport, the factories, and
the reply feature don't change.

## File layout

| File           | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `echo-spec.ts` | The platform's specific half: platform tag, address shape, frame codec. |
| `server.ts`    | Demo broadcast server standing in for a real chat service.              |
| `index.ts`     | Composition root: server, kernel, raw-client round trip, self-check.    |
| `type-test.ts` | Compile-time assertions for mapping-based wiring through the bundle.    |

## Where next

- [dual-websocket-bot](../dual-websocket-bot) — two tagged instances of this
  exact platform sharing one kernel.
- [multi-kernel-bot](../multi-kernel-bot) — the same bot twice, but isolated
  in two kernels with an explicit bridge.
