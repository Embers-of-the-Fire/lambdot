# @lambdot/protocol-qq

The QQ wire protocol for lambdot: address and event contracts, frame codec,
and plugin factories for both QQ bot infrastructures — the websocket gateway
and the webhook (reversed post) — sharing one REST client. Both transports
deliver events only; sending a message is always an HTTPS call against the
open platform, so the output half is transport-independent.

## Two infras, one platform tag

Both halves produce the same event kinds (`qq.group-message`,
`qq.c2c-message`) and the same `"qq"` platform addresses, so a feature plugin
written against `QqEvents`/`QqOutputs` runs unchanged on either infra. What
differs is how events arrive:

- **Gateway** — the bot holds a websocket to QQ. The socket URL is not static
  configuration: it is discovered through the REST client (`GET /gateway`
  with the access token), so `qqGatewayTransport` injects the api capability,
  resolves the URL at activation, and provides the connection as a typed
  `WsCapability` from `@lambdot/websocket`. `qqGatewayInput` then runs the
  basic gateway algorithm on it — identify on hello (op 10), heartbeat on the
  advertised interval (op 1), decode dispatches (op 0). Resume (op 6) is
  deliberately not implemented: a dropped connection is a fresh identify.
- **Webhook** — QQ pushes events to an HTTPS callback address owned by your
  HTTP surface (a hono route, a worker's fetch). `qqWebhookInput` implements
  the callback algorithm and provides it as a typed `QqWebhook` capability:
  op 13 callback-address validation (sign `event_ts + plain_token`), and
  ed25519 verification of `X-Signature-Ed25519` over `timestamp + body` for
  every other request. The bot secret seeds the ed25519 keypair (repeated to
  32 bytes); a forged signature gets a 401.

Both infras read credentials from an env capability (see `@lambdot/env`) via
`readQqCredentials` — `QQ_BOT_APP_ID` and `QQ_BOT_APP_SECRET` by default,
overridable through `QqCredentialKeys` in each plugin's config.

## Assembling a platform

Prefer the bundles: `qqGatewayPlatform` / `qqWebhookPlatform` build a whole
platform from its capability names. The pieces stay separate plugins (rather
than one fused plugin) so the type fold keeps enforcing registration order —
env provider → api → transport/input → output → features.

```ts
import { createKernel, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqGatewayPlatform, type QqEvents, type QqOutputs } from "@lambdot/protocol-qq";

const reply = definePlugin<QqEvents, QqOutputs>({
    name: "reply",
    apply(ctx) {
        return [
            ctx.on("qq.group-message", (event) =>
                ctx.send(event.address, `echo: ${event.payload.content}`),
            ),
            ctx.on("qq.c2c-message", (event) =>
                ctx.send(event.address, `echo: ${event.payload.content}`),
            ),
        ];
    },
});

const qq = qqGatewayPlatform({ ws: "qq-ws", api: "qq-api", env: "qq-env" });

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.api, {}) // reads credentials, provides the REST client
    .use(qq.transport) // discovers the gateway URL, provides the socket
    .use(qq.input, {}) // ingests "qq.group-message" / "qq.c2c-message"
    .use(qq.output) // sends through the "qq" platform
    .use(reply);
```

The webhook bundle swaps the socket for a request bridge — the HTTP route
lives outside the event pipeline and hands each callback to the capability:

```ts
const qq = qqWebhookPlatform({ webhook: "qq-webhook", api: "qq-api", env: "qq-env" });

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, {})
    .use(qq.api, {})
    .use(qq.output)
    .use(reply);
// in the hono route: return kernel.ctx["qq-webhook"].handle(c.req.raw);
```

`qq.api` accepts `{ apiBase }` to point the REST client at a mock in tests,
and `qq.input` accepts `{ intents }` (defaults to `QQ_INTENT_GROUP_AND_C2C`).

## API overview

Shared by both infras:

- `qqApi(capability, env)` — provide the REST client as `QqCapability<TCap>`.
  `QqApi` owns the access-token lifecycle (cached, refreshed ahead of expiry)
  and exposes `appId`, `accessToken()`, `gatewayUrl()`, and
  `sendMessage(to, content)` — plain text (`msg_type` 0) to
  `/v2/groups/:openid/messages` or `/v2/users/:openid/messages`. When the
  address carries a `msgId` the send is a passive reply: `msg_seq` is taken
  from the address or auto-incremented per `msgId` when omitted.
- `qqOutput(api)` — the `"qq"` platform's output half; content type is
  `string`.
- `QqAddress` — `scope: "group" | "c2c"`, `openid` (`group_openid` or the
  user's openid), optional `msgId`/`msgSeq` passive-reply reference.
- `QqEvents`, `QqMessage`, `QqOutputs` — the event map (one kind per
  conversation scope), the plain-text payload, the output contract.
- `decodeMessageEvent(t, d)` — decode a dispatch pair into an ingestible
  event (`GROUP_AT_MESSAGE_CREATE`, `C2C_MESSAGE_CREATE`), or null to ignore.
  Both inputs share it: the transports deliver the same `{op, t, d}`
  envelope.
- `readQqCredentials`, `QqCredentials`, `QqCredentialKeys`,
  `DEFAULT_QQ_CREDENTIAL_KEYS`, `QqEnvNeeds` — the credentials half.

Gateway infra:

- `qqGatewayPlatform({ ws, api, env })` — the bundle (`api`, `transport`,
  `input`, `output`), typed as `QqGatewayPlatform`.
- `qqGatewayTransport(wsCap, apiCap)` — resolve `GET /gateway`, own the
  socket, provide it as `WsCapability<TWsCap>`.
- `qqGatewayInput(wsCap, apiCap)` — the receiving half;
  `QqGatewayInputConfig` for the intents bitmask, `QQ_INTENT_GROUP_AND_C2C`
  for the default.

Webhook infra:

- `qqWebhookPlatform({ webhook, api, env })` — the bundle (`webhook`, `api`,
  `output`), typed as `QqWebhookPlatform`.
- `qqWebhookInput(capability, env)` — the callback algorithm, provided as
  `QqWebhookCapability<TCap>`; `QqWebhook.handle(request)` returns the
  `Response` to send back. `QqWebhookConfig` carries the credential keys.

## Examples

- [qq-gateway-bot](../../examples/qq-gateway-bot) — the full gateway round
  trip against a fake platform: token endpoint, gateway discovery, and a
  websocket speaking the op-code flow.
- [qq-webhook-bot](../../examples/qq-webhook-bot) — a hono-served callback
  against a fake platform, exercising op-13 validation, a signed dispatch,
  and a rejected forged signature.

The gateway transport rides the generic machinery of
[`@lambdot/websocket`](../../core/websocket) — the capability/connection
shape (`WsCapability`, `WsConnection`) is documented there.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
