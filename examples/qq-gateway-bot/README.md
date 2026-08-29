# qq-gateway-bot

A self-verifying echo bot speaking the real QQ gateway protocol against a
fake open platform — the reference example for protocol packages: one chat
service's address type, event kinds, output contract, and frame codec riding
the core transports, bundled as a capability-named platform via
`qqGatewayPlatform`.

```console
$ nub run -F @lambdot-example/qq-gateway-bot start
platform recorded: {"scope":"group","openid":"GROUP_FAKE_OPENID","content":"echo: hello from qq","msgId":"ROBOT1.0_inbound_2","msgSeq":1}
qq-gateway-bot: OK
```

The example starts a fake QQ open platform in-process (token endpoint,
gateway discovery, send-message endpoints, and a websocket gateway speaking
the op-code flow), boots the kernel against it, pushes a fake dispatch, and
exits non-zero if the round trip misbehaves — it is its own integration
test. No QQ credentials are needed; the ones in `index.ts` are fakes the
fake platform accepts.

## What it demonstrates

1. **The protocol is real, the platform is fake.** Everything imported from
   `@lambdot/protocol-qq` is production code: the access-token lifecycle
   (`POST /app/getAppAccessToken`, cached and refreshed ahead of expiry),
   gateway discovery (`GET /gateway`), the gateway algorithm (identify on
   op-10 hello, heartbeat on the advertised interval, decode op-0
   dispatches), and the send-message REST calls. [`platform.ts`](./platform.ts)
   is a demo shim implementing the other end of those wire protocols — it
   checks the `QQBot <token>` authorization, answers identify with READY,
   acks heartbeats, and records what the bot sends. Swapping in the real
   infra means dropping the shim and setting real credentials; not one line
   of the kernel setup or the reply feature changes.
2. **One bundle, three capabilities, four plugins.**
   `qqGatewayPlatform({ ws: "qq-ws", api: "qq-api", env: "qq-env" })` returns
   the REST client, the gateway transport, the input, and the output as
   separate plugins that inject each other through named typed capabilities.
   They stay separate so the generic fold keeps enforcing registration
   order: env provider → api → transport → input → output → features.
   Registering out of order is a compile error — see `type-test.ts`.
3. **The gateway URL is discovered, not configured.** Unlike the generic
   `wsTransport` (see [`../websocket-bot`](../websocket-bot)), which takes a
   static `url`, `qqGatewayTransport` resolves the socket URL through the
   api capability at activation (`GET /gateway` with the access token) and
   provides the connection as a `WsCapability` for the input to ride. Only
   `apiBase` is config — and only so tests can point at a mock.
4. **Event kinds and the output contract are qq's own.** The input registers
   `qq.group-message` and `qq.c2c-message` (payload `QqMessage`: id, trimmed
   content, author openid, timestamp). The output contract is
   `QqAddress → string` — plain text, `msg_type` 0. The address carries the
   triggering message's `msgId`, so the reply goes out as a passive reply
   with an auto-incremented `msg_seq`; the recorded `msgId`/`msgSeq` in the
   output above is the example asserting exactly that.
5. **The fold gates the whole chain at compile time.** `type-test.ts`
   asserts that the provided capabilities read back typed
   (`kernel.ctx["qq-api"]: QqApi`, `kernel.ctx["qq-ws"]: WsConnection`, the
   env snapshot keyed by variable name), that `ctx.send` rejects non-string
   content and foreign-platform addresses, that handlers can only subscribe
   to registered kinds, and that every `inject` in the chain fails to
   compile when its provider registers later. Every `@ts-expect-error` line
   there is a genuine error — if one stops erroring, the fold regressed;
   fix the types, not the test.

## The plugin chain

```ts
const qq = qqGatewayPlatform({ ws: "qq-ws", api: "qq-api", env: "qq-env" });

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.api, { apiBase: platform.apiBase }) // provides QqApi
    .use(qq.transport) // discovers the gateway URL, provides WsConnection
    .use(qq.input, {}) // identify, heartbeat, decode dispatches
    .use(qq.output) // sends through the "qq" platform
    .use(reply); // echoes each message back
```

The bot identifies only after the platform's hello, so the example waits on
`platform.identified` before driving. It then pushes one
`GROUP_AT_MESSAGE_CREATE` dispatch and verifies the full round trip —
platform → gateway socket → input → reply feature → output → REST mock —
checking both the echoed content and the passive-reply `msgId`.

## File layout

| File           | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `index.ts`     | The bot: kernel setup, the reply feature, self-checking driver.         |
| `platform.ts`  | Fake QQ open platform: REST mock plus a websocket gateway shim.         |
| `type-test.ts` | Compile-time assertions for the bundle's capability chain and the fold. |

## See also

- [`../qq-webhook-bot`](../qq-webhook-bot) — the same qq events and output
  over the webhook (reversed-post) infra, with ed25519 signature
  verification.
- [`../../packages/protocol/qq`](../../packages/protocol/qq) — the protocol
  package: `qqGatewayPlatform`/`qqWebhookPlatform` bundles, the REST client,
  and the shared event decoder.
- [`../websocket-bot`](../websocket-bot) — the generic websocket transport
  and typed-capability model `qqGatewayTransport` builds on.
