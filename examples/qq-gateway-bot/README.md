# qq-gateway-bot

A self-verifying echo bot speaking the real QQ gateway protocol against a
fake open platform — the reference example for protocol packages: one chat
service's address type, message stream, command contract, and frame codec
riding the core transports, bundled as a named platform via
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
2. **One bundle, four leaves, wired with mappings.**
   `qqGatewayPlatform("qq")` returns the REST client, the gateway
   transport, the input, and the output as separate plugins that consume
   each other through declared inputs. They stay separate so the mapping
   types keep enforcing wiring order: env snapshot → api (`bind`) →
   transport (`bind`) → input (`use`) → features → output (`bind`). Wiring
   out of order is a compile error, because each `mapping`'s parameter is
   typed as the namespaces visible so far — see `type-test.ts`.
3. **The gateway URL is discovered, not configured.** Unlike the generic
   `wsTransport` (see [`../websocket-bot`](../websocket-bot)), which takes a
   static `url` option, `qqGatewayTransport` declares the api service as its
   input (`mapping: (ctx) => ({ api: ctx["qq/api"] })`), resolves the socket
   URL through it at activation (`GET /gateway` with the access token), and
   emits a `WsConnection` for the input to consume. Only `apiBase` is
   config — and only so tests can point at a mock.
4. **Messages and commands are qq's own.** The input emits a
   `QqMessageStream` — `Stream<Message<QqMessage, QqAddress>>`, payload:
   id, trimmed content, author openid, timestamp — under the platform's
   `use`d namespace (`ctx.qq`). The output consumes a `QqCommandStream`
   (`QqAddress → string`: plain text, `msg_type` 0). The address carries
   the triggering message's `msgId`, so the reply goes out as a passive
   reply with an auto-incremented `msg_seq`; the recorded `msgId`/`msgSeq`
   in the output above is the example asserting exactly that. The reply
   feature's `mapping` is the platform adapter: it wants `{ messages }`,
   the platform emits `qq` — `(ctx) => ({ messages: ctx.qq })`.
5. **The mapping types gate the whole chain at compile time.**
   `type-test.ts` asserts that the exposed namespaces read back typed
   (`kernel.ctx["qq-env"]` keyed by variable name, `kernel.ctx.qq:
QqMessageStream`), that `bind`ed namespaces (`qq/api`, `qq/transport`,
   `qq/output`) are hidden from the final `ctx`, that `mapping` is required
   when a declared input key is absent, that `option` is required even with
   a mapping (pass `{}` for defaults), and that a mapping cannot see a
   namespace before it is composed. Every `@ts-expect-error` line there is
   a genuine error — if one stops erroring, the types regressed; fix the
   types, not the test.

## The plugin chain

```ts
const qq = qqGatewayPlatform("qq");

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .bind(qq.api, {
        option: { apiBase: platform.apiBase },
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
    })
    .bind(qq.transport, { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
    .use(qq.input, {
        option: {},
        mapping: (ctx) => ({ connection: ctx["qq/transport"], api: ctx["qq/api"] }),
    })
    // the mapping is the platform adapter: reply wants "messages", qq emits "qq"
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });
```

The bot identifies only after the platform's hello, so the example waits on
`platform.identified` before driving. It then pushes one
`GROUP_AT_MESSAGE_CREATE` dispatch and verifies the full round trip —
platform → gateway socket → input → reply feature → output → REST mock —
checking both the echoed content and the passive-reply `msgId`.

## File layout

| File           | Role                                                            |
| -------------- | --------------------------------------------------------------- |
| `index.ts`     | The bot: kernel setup, the reply feature, self-checking driver. |
| `platform.ts`  | Fake QQ open platform: REST mock plus a websocket gateway shim. |
| `type-test.ts` | Compile-time assertions for the bundle's mapping-wired chain.   |

## See also

- [`../qq-webhook-bot`](../qq-webhook-bot) — the same qq events and output
  over the webhook (reversed-post) infra, with ed25519 signature
  verification.
- [`../../packages/protocol/qq`](../../packages/protocol/qq) — the protocol
  package: `qqGatewayPlatform`/`qqWebhookPlatform` bundles, the REST client,
  and the shared event decoder.
- [`../websocket-bot`](../websocket-bot) — the generic websocket transport
  and mapping-wiring model `qqGatewayTransport` builds on.
