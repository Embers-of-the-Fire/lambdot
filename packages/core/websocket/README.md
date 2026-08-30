# @lambdot/websocket

The generic websocket transport. It owns the socket lifecycle — connect,
fan out incoming text frames, close on unload — and nothing else: no message
shapes, no addresses, no content contract. Everything chat-specific is
deferred to a `WsSpec` supplied by consumers, which makes this a core
behavior (like `console`), not a chat platform. Protocol packages
(`@lambdot/protocol-qq`, …) ride this transport by supplying their own
specs.

The transport is a **service plugin, not a stream**: `wsTransport(name)`
emits the live `WsConnection` as its namespace value under `name`. The
`wsInput(name, spec)` / `wsOutput(name, spec)` factories build a platform's
two halves from the spec, declaring the connection in their input — wiring
them before the transport is a compile error, because the `mapping`
parameter is typed as the namespaces visible so far. The socket opens when
the transport activates and closes when the composition stops.

The name is a parameter, so instances multiply: distinct names compose side
by side (`wsPlatform("wsecho-a", spec)` next to `wsPlatform("wsecho-b", spec)`),
and several websocket platforms share one kernel, each platform's input and
output mapping its own transport's connection.

## Usage

Prefer the bundle. `wsPlatform(name, spec)` builds one websocket platform as
a triple of plugins — they stay separate so feature plugins can be wired
between the input (whose message stream is `use`d) and the output (which is
terminal and always wired last). The transport and output are usually
`bind`ed, keeping them internal to the chain:

```ts
import type { Message, Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec, type WsEchoAddress } from "./echo-spec.ts";

const reply = definePlugin({
    name: "reply",
    apply(input: { wsecho: Stream<Message<string, WsEchoAddress>> }) {
        return mapStream(input.wsecho, (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

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

Reach for the individual `wsTransport` / `wsInput` / `wsOutput` factories
when a kernel hosts several tagged websocket platforms and the triples must
interleave with other plugins — the factories the bundle wraps stay exported
for exactly that. Each output filters the shared command stream back down to
its own platform tag, so `address.platform` routes every reply out the
socket it arrived on:

```ts
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
    .bind(wsechoB.output, {/* ...same for "wsecho-b"... */});
```

A concrete platform supplies one `WsSpec` — platform tag, address shape,
frame codec — and nothing else:

```ts
import type { Address } from "@lambdot/core";
import type { WsSpec } from "@lambdot/websocket";

export type WsEchoAddress = Address<"wsecho">;

export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string> = {
    platform: "wsecho",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
```

`decode` may return `null` to ignore a frame. Adding a second platform
costs one spec object, ~5 lines; the transport, factories, and feature
plugins don't change.

## API

- `wsPlatform(name, spec)` — bundle a transport and the input/output halves
  built from `spec` into a `WsPlatform` triple (`{ transport, input, output }`).
  The transport is named `${name}/transport`, the input `name`, the output
  `${name}/output`.
- `wsTransport(name)` — the general half: connection lifecycle only. Config
  is `{ url }` (passed via `option`); emits the live `WsConnection` under
  the name.
- `wsInput(name, spec)` — subscribes to the connection, decodes each frame,
  and emits a shared `Stream<Message<TPayload, TAddress>>` of the decoded
  messages.
- `wsOutput(name, spec)` — consumes a `Stream<Command<TAddress, TContent>>`
  and sends each command's encoded content through the connection. Terminal:
  wire it last, after the features whose reply streams it consumes.
- `WsSpec<TPlatform, TAddress, TPayload, TContent>` — the deferred behavior
  slot: `platform`, plus the `decode` / `encode` frame codec.
- `WsConnection` — the shared transport service: `url`, `send(data)`,
  `onMessage(listener)` (text frames only; binary frames are dropped).
- `WsTransportConfig` — `{ readonly url: string }`.

## Examples

- [../../../examples/websocket-bot](../../../examples/websocket-bot) — one platform
  end to end: a raw driver round-trips through server, transport, input,
  reply feature, and output.
- [../../../examples/dual-websocket-bot](../../../examples/dual-websocket-bot) — two
  tagged platforms sharing one kernel under distinct names, each output
  filtering the shared command stream by `address.platform`.

Protocol packages under `packages/protocol/` ride this transport, supplying
their wire protocol's address type and frame codec as a `WsSpec`.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
