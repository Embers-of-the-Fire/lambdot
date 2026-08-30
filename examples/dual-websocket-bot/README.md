# dual-websocket-bot

Two websocket platforms, **one kernel** — the tagged-instance story of the
lambdot design. Both platforms are the same `wsPlatform` bundle from
`@lambdot/websocket`, instantiated twice under distinct names, so one reply
feature serves both sockets while the mapping types keep every wire
compile-time checked.

```console
$ nub index.ts
[wsecho-a] id=dbc12a65-... payload=hello from driver A
[wsecho-b] id=9e68321a-... payload=hello from driver B
driver A received: echo(wsecho-a): hello from driver A
driver B received: echo(wsecho-b): hello from driver B
dual-websocket-bot: OK
```

The example starts two broadcast servers in-process (ports 8080/8081), boots
one kernel against both, drives each instance with a raw client concurrently,
and exits non-zero if any reply arrives on the wrong socket — it is its own
integration test.

## What it demonstrates

1. **One kernel, two tagged instances.** `wsPlatform("wsecho-a", echoSpec("a"))`
   and `wsPlatform("wsecho-b", echoSpec("b"))` declare the same platform
   shape twice. The namespaces sit side by side (`wsecho-a`,
   `wsecho-a/transport`, … next to `wsecho-b`, `wsecho-b/transport`, …), and
   each platform's input/output maps its own transport's connection — see
   [`specs.ts`](./specs.ts) for the tag-parameterized spec and
   [`index.ts`](./index.ts) for the chain.
2. **The tag is not cosmetic — it is the namespace key.** A second instance
   is only safe when the tag differs everywhere a string keys a namespace:
   the platform name (and thus the `…/transport` and `…/output` namespaces)
   must be unique per instance. Reusing one name twice is a compile-time
   "duplicate namespace" error — and even setting the types aside,
   same-name messages from both sockets would merge into one stream: the
   envelope carries no socket identity beyond the address.
3. **Replies route by address, at the wiring.** The reply feature merges
   both message streams into one command stream (`mergeStreams` over two
   `mapStream`s); each output's `mapping` then `filterStream`s the shared
   command stream down to its own platform tag —
   `cmd.address.platform === "wsecho-a"` — with a type guard that narrows
   the command's address type. Each reply therefore leaves through the
   socket its request came from.
4. **Streams broadcast, so sharing is free.** Every consumer of a stream
   sees every item, in order, at its own pace: both outputs tap the same
   `ctx.reply` stream without stealing from each other, and a logger could
   tap it too. Consumption is sequential per consumer, so read-modify-write
   in mappers stays race-free across instances. That is the point of
   sharing a kernel; if you want isolation instead, see `multi-kernel-bot`.

## How the instances stay separate

```ts
// specs.ts — one spec per tag: platform and codec both carry it
export function echoSpec<const TTag extends string>(
    tag: TTag,
): WsSpec<`wsecho-${TTag}`, WsEchoAddress<TTag>, string, string> {
    const platform = `wsecho-${tag}` as const;
    return {
        platform,
        decode: (data) => ({ payload: data, address: { platform } }),
        encode: (content) => content,
    };
}

// index.ts — two bundles, one chain, one reply feature
const wsechoA = wsPlatform("wsecho-a", echoSpec("a"));
const wsechoB = wsPlatform("wsecho-b", echoSpec("b"));

const kernel = createKernel()
    .bind(wsechoA.transport, { option: { url: urlA } })
    .use(wsechoA.input, { mapping: (ctx) => ({ connection: ctx["wsecho-a/transport"] }) })
    .bind(wsechoB.transport, { option: { url: urlB } })
    .use(wsechoB.input, { mapping: (ctx) => ({ connection: ctx["wsecho-b/transport"] }) })
    .use(reply)
    .bind(wsechoA.output, {
        mapping: (ctx) => ({
            connection: ctx["wsecho-a/transport"],
            commands: filterStream(
                ctx.reply,
                (cmd): cmd is Command<AddressA, string> => cmd.address.platform === "wsecho-a",
            ),
        }),
    })
    .bind(wsechoB.output, {
        mapping: (ctx) => ({
            connection: ctx["wsecho-b/transport"],
            commands: filterStream(
                ctx.reply,
                (cmd): cmd is Command<AddressB, string> => cmd.address.platform === "wsecho-b",
            ),
        }),
    });
```

The reply feature declares both message streams as its input (identity
wiring — the keys match the visible namespaces), merges them, and lets the
address do the routing:

```ts
const reply = definePlugin({
    name: "reply",
    apply(input: {
        "wsecho-a": Stream<Message<string, AddressA>>;
        "wsecho-b": Stream<Message<string, AddressB>>;
    }) {
        function echo(event: Message<string, AddressA | AddressB>) {
            console.log(`[${event.address.platform}] id=${event.id} payload=${event.payload}`);
            return {
                address: event.address,
                content: `echo(${event.address.platform}): ${event.payload}`,
            };
        }

        return mergeStreams(mapStream(input["wsecho-a"], echo), mapStream(input["wsecho-b"], echo));
    },
});
```

## File layout

| File        | Role                                                             |
| ----------- | ---------------------------------------------------------------- |
| `specs.ts`  | The tag-parameterized spec: platform and codec per instance.     |
| `server.ts` | Demo broadcast server standing in for a real chat service.       |
| `index.ts`  | Boots the kernel, drives both instances, verifies no cross-talk. |

## When to choose this over multiple kernels

- **One kernel, tagged instances** (this example): the platforms are
  genuinely one bot — shared features tapping the same broadcast streams,
  shared state namespaces, one merged reply stream filtered per platform at
  the wiring.
- **Multi-kernel** (`multi-kernel-bot`): you want hard isolation —
  independent restart and failure domains, no shared streams, homogeneous
  bot farms where every instance composes the byte-for-byte identical,
  untagged plugin stack — and you accept that anything crossing instances
  goes through a bridge you write.

For the single-instance walkthrough of the `wsPlatform` bundle itself, see
`websocket-bot`.
