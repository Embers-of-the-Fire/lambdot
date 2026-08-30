# @lambdot/protocol-qq

The QQ wire protocol for lambdot: address and stream contracts, frame
codec, and plugin factories for both QQ bot infrastructures — the websocket
gateway and the webhook (reversed post) — sharing one REST client. Both
transports deliver messages only; sending a message is always an HTTPS call
against the open platform, so the output half is transport-independent.

## Two infras, one platform tag

Both infras emit the same stream contract (`QqMessageStream` —
`Stream<Message<QqMessage, QqAddress>>`) and share the output
(`QqCommandStream` — `Stream<Command<QqAddress, string>>`), so a feature
plugin written against those two types runs unchanged on either infra: the
wiring `mapping` is the platform adapter. What differs is how messages
arrive:

- **Gateway** — the bot holds a websocket to QQ. The socket URL is not
  static configuration: it is discovered through the REST client
  (`GET /gateway` with the access token), so `qqGatewayTransport` consumes
  `{ api: QqApi }`, resolves the URL at activation, owns the socket, and
  emits the `WsConnection` (from `@lambdot/websocket`) as its namespace
  value. `qqGatewayInput` then runs the basic gateway algorithm on it —
  identify on hello (op 10), heartbeat on the advertised interval (op 1),
  decode dispatches (op 0) into the emitted message stream. Resume (op 6)
  is deliberately not implemented: a dropped connection is a fresh
  identify.
- **Webhook** — QQ pushes events to an HTTPS callback address owned by your
  HTTP surface (a hono route, a worker's fetch). `qqWebhook` implements the
  callback algorithm and emits it as a `QqWebhook` — `{ handle, messages }`:
  op 13 callback-address validation (sign `event_ts + plain_token`), and
  ed25519 verification of `X-Signature-Ed25519` over `timestamp + body` for
  every other request. Decoded message dispatches join the `messages`
  stream. The bot secret seeds the ed25519 keypair (repeated to 32 bytes);
  a forged signature gets a 401.

Both infras read credentials from an env namespace (see `@lambdot/env`) via
`readQqCredentials` — `QQ_BOT_APP_ID` and `QQ_BOT_APP_SECRET` by default,
overridable through `QqCredentialKeys` in each plugin's config.

## Assembling a platform

Prefer the bundles: `qqGatewayPlatform` / `qqWebhookPlatform` build a whole
platform under one name. The pieces stay separate plugins (rather than one
fused plugin) so features compose between the input (whose message stream
is `use`d under the platform name) and the terminal output, with the api
and transport `bind`ed as internal wiring. Wiring a consumer before its
dependency is a compile error — the `mapping` parameter is typed as the
namespaces visible so far.

```ts
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import type { QqMessageStream } from "@lambdot/protocol-qq";
import { qqGatewayPlatform } from "@lambdot/protocol-qq";

const reply = definePlugin({
    name: "reply",
    apply(input: { messages: QqMessageStream }) {
        return mapStream(input.messages, (event) => ({
            address: event.address,
            content: `echo: ${event.payload.content}`,
        }));
    },
});

const qq = qqGatewayPlatform("qq");

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.transport, { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
    .use(qq.input, {
        option: {},
        mapping: (ctx) => ({ connection: ctx["qq/transport"], api: ctx["qq/api"] }),
    })
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });

await kernel.start();
```

The webhook bundle swaps the socket for a request bridge — the HTTP route
lives outside the composition and hands each callback to the emitted
`handle`:

```ts
const qq = qqWebhookPlatform("qq");

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq.messages }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });
// in the hono route: return kernel.ctx.qq.handle(c.req.raw);
```

`option` is required (even as `{}`) wherever the plugin's config type is
non-void: `qq.api` accepts `{ apiBase }` to point the REST client at a mock
in tests, and `qq.input` accepts `{ intents }` (defaults to
`QQ_INTENT_GROUP_AND_C2C`).

## API overview

Shared by both infras:

- `qqApi(name)` — emits the REST client as `QqApi` under `name`; consumes
  `{ env: Readonly<Record<string, string>> }`. `QqApi` owns the
  access-token lifecycle (cached, refreshed ahead of expiry) and exposes
  `appId`, `accessToken()`, `gatewayUrl()`, and `sendMessage(to, content)`
  — plain text (`msg_type` 0) to `/v2/groups/:openid/messages` or
  `/v2/users/:openid/messages`. When the address carries a `msgId` the send
  is a passive reply: `msg_seq` is taken from the address or
  auto-incremented per `msgId` when omitted.
- `qqOutput(name)` — the output half; consumes `{ api, commands }` and
  sends each command's content (`string`) through the api. Terminal: wire
  it last.
- `QqAddress` — `scope: "group" | "c2c"`, `openid` (`group_openid` or the
  user's openid), optional `msgId`/`msgSeq` passive-reply reference.
- `QqMessage`, `QqMessageStream`, `QqCommandStream` — the plain-text
  payload and the two stream contracts features are written against.
- `decodeMessageEvent(t, d)` — decode a dispatch pair into a message
  (`GROUP_AT_MESSAGE_CREATE`, `C2C_MESSAGE_CREATE`), or null to ignore.
  Both inputs share it: the transports deliver the same `{op, t, d}`
  envelope.
- `readQqCredentials`, `QqCredentials`, `QqCredentialKeys`,
  `DEFAULT_QQ_CREDENTIAL_KEYS` — the credentials half.

Gateway infra:

- `qqGatewayPlatform(name)` — the bundle (`api`, `transport`, `input`,
  `output`), typed as `QqGatewayPlatform`. The api/transport/output are
  named `${name}/api`, `${name}/transport`, `${name}/output`; the input is
  named `name`.
- `qqGatewayTransport(name)` — resolve `GET /gateway`, own the socket, emit
  the `WsConnection`.
- `qqGatewayInput(name)` — the receiving half; `QqGatewayInputConfig` for
  the intents bitmask, `QQ_INTENT_GROUP_AND_C2C` for the default.

Webhook infra:

- `qqWebhookPlatform(name)` — the bundle (`webhook`, `api`, `output`),
  typed as `QqWebhookPlatform`. The webhook is named `name`; api and output
  are `${name}/api` and `${name}/output`.
- `qqWebhook(name)` — the callback algorithm, emitted as `QqWebhook`;
  `QqWebhook.handle(request)` returns the `Response` to send back, and
  `QqWebhook.messages` is the decoded message stream. `QqWebhookConfig`
  carries the credential keys.

## Examples

- [qq-gateway-bot](../../examples/qq-gateway-bot) — the full gateway round
  trip against a fake platform: token endpoint, gateway discovery, and a
  websocket speaking the op-code flow.
- [qq-webhook-bot](../../examples/qq-webhook-bot) — a hono-served callback
  against a fake platform, exercising op-13 validation, a signed dispatch,
  and a rejected forged signature.

The gateway transport mirrors the generic machinery of
[`@lambdot/websocket`](../../core/websocket) — the `WsConnection` shape is
documented there.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
