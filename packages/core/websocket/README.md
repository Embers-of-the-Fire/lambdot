# @lambdot/websocket

The generic websocket transport. It owns the socket lifecycle — connect,
fan out incoming text frames, close on unload — and nothing else: no event
kinds, no addresses, no content contract. Everything chat-specific is
deferred to a `WsSpec` supplied by consumers, which makes this a core
behavior (like `console`), not a chat platform. Protocol packages
(`@lambdot/protocol-qq`, …) ride this transport by supplying their own
specs.

The transport is a **capability, not an input/output**: `wsTransport(name)`
provides the live `WsConnection` as a typed value under `name` — its
`TProvides = WsCapability<name>` folds into the kernel context, so
`ctx.provide(name, connection)` is type-checked and consumers read the
connection back typed with no casts. The `wsInput(name, spec)` /
`wsOutput(name, spec)` factories build a platform's two halves from the
spec, declaring `TInjects = WsCapability<name>` — registering them before
the transport is a compile error. Their runtime `inject: [name]` gates
activation on connection: the halves stay pending until the socket opens
and provides the connection, and unload if the capability is withdrawn.

The capability name is a parameter, so instances multiply: distinct names
fold side by side (`WsCapability<"ws-discord"> & WsCapability<"ws-qq">`),
and several websocket platforms share one kernel, each platform's plugins
gating on their own transport.

## Usage

Prefer the bundle. `wsPlatform(capability, spec)` declares one websocket
platform as a triple of plugins — they stay separate so the fold keeps
enforcing registration order (transport before the halves that inject it):

```ts
import { createKernel } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec } from "./echo-spec.ts";

const wsecho = wsPlatform("ws", echoSpec);

const kernel = createKernel()
    .use(wsecho.transport, { url }) // provides { ws: WsConnection }
    .use(wsecho.input) // ingests "wsecho.message"
    .use(wsecho.output); // sends through the "wsecho" platform
```

Reach for the individual `wsTransport` / `wsInput` / `wsOutput` factories
when a kernel hosts several tagged websocket platforms and the triples must
interleave with other registrations — the factories the bundle wraps stay
exported for exactly that:

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

A concrete platform supplies one `WsSpec` — platform tag, event kind, frame
codec — and nothing else:

```ts
import type { WsSpec } from "@lambdot/websocket";

export const echoSpec: WsSpec<"wsecho", WsEchoAddress, string, string, "wsecho.message"> = {
    platform: "wsecho",
    kind: "wsecho.message",
    decode: (data) => ({ payload: data, address: { platform: "wsecho" } }),
    encode: (content) => content,
};
```

`decode` may return `null` to ignore a frame. Adding a second platform
costs one spec object, ~15 lines; the transport, factories, and feature
plugins don't change.

## API

- `wsPlatform(capability, spec)` — bundle a transport and the input/output
  halves built from `spec` into a `WsPlatform` triple
  (`{ transport, input, output }`).
- `wsTransport(capability)` — the general half: connection lifecycle only.
  Config is `{ url }`; provides the live `WsConnection` under the
  capability name.
- `wsInput(capability, spec)` — subscribes to the connection, decodes each
  frame, ingests `spec.kind` events with the decoded payload and address.
- `wsOutput(capability, spec)` — registers an output plugin for
  `spec.platform`; `send` encodes content through `spec.encode`. Throws if
  called while inactive.
- `WsSpec<TPlatform, TAddress, TPayload, TContent, TKind>` — the deferred
  behavior slot: `platform`, `kind`, plus the `decode` / `encode` frame
  codec.
- `WsConnection` — the shared transport service: `url`, `send(data)`,
  `onMessage(listener)` (text frames only; binary frames are dropped).
- `WsCapability<TCap>` — the typed capability contract,
  `{ readonly [K in TCap]: WsConnection }`: `TProvides` on the transport,
  `TInjects` on the factories.
- `WsTransportConfig` — `{ readonly url: string }`.

## Examples

- [../../examples/websocket-bot](../../examples/websocket-bot) — the typed-capability
  walkthrough: one platform end to end, plus compile-time type tests.
- [../../examples/dual-websocket-bot](../../examples/dual-websocket-bot) — two tagged
  platforms sharing one kernel under distinct capability names.

Protocol packages under `packages/protocol/` ride this transport, supplying
their wire protocol's address type, event/output contracts, and frame codec
as a `WsSpec`.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
