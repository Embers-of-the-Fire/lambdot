# qq-webhook-bot

A self-verifying echo bot speaking the real QQ webhook (reversed-post)
protocol against a fake open platform — the reference example for embedding
a kernel into an HTTP host: the input owns no port, the callback algorithm
is a typed capability, and a hono route is the whole integration.

```console
$ nub run -F @lambdot-example/qq-webhook-bot start
platform recorded: {"scope":"group","openid":"GROUP_FAKE_OPENID","content":"echo: hello from qq","msgId":"ROBOT1.0_inbound_1","msgSeq":1}
qq-webhook-bot: OK
```

The example starts a fake QQ open platform in-process (token endpoint,
send-message endpoints, and the callback side of the webhook protocol — it
signs reversed-post requests with the shared bot secret), boots the kernel,
serves the callback route with hono, and exits non-zero if any of its three
checks fail. No QQ credentials are needed; the ones in `index.ts` are fakes
that match the secret the fake platform signs with.

## What it demonstrates

1. **The input is a capability, not a server.** `qqWebhookInput` binds no
   port and owns no HTTP surface. It registers the qq event kinds and
   provides a `QqWebhook` capability — one `handle(request): Promise<Response>`
   method implementing the callback algorithm. The HTTP route lives outside
   the event pipeline and hands each callback request to `handle`:

    ```ts
    const app = new Hono();
    app.post("/qq/callback", (c) => kernel.ctx["qq-webhook"].handle(c.req.raw));
    ```

    That bridge is the entire reversed-post integration; the same kernel
    drops into a worker's `fetch` or any other HTTP host unchanged.

2. **Signature verification is exercised end-to-end.** The callback
   algorithm is real protocol code: op-13 callback-address validation (sign
   `event_ts + plain_token` with the ed25519 keypair seeded from the bot
   secret, repeated to 32 bytes), and for every other frame, ed25519
   verification of `X-Signature-Ed25519` over `timestamp + body` before the
   payload is trusted. The example checks all of it: the platform validates
   the callback address (op 13) and verifies the returned signature, a
   signed dispatch round-trips into an echo, and a deliberately forged
   signature is refused with 401.
3. **The protocol is real, the platform is fake.** Token lifecycle, the
   send-message REST calls, and the callback algorithm all come from
   `@lambdot/protocol-qq`. [`platform.ts`](./platform.ts) is a demo shim
   implementing the platform's side: it derives the same keypair from the
   shared secret, signs its POSTs, and records what the bot sends. Swapping
   in the real infra means dropping the shim, pointing hono at a public URL,
   and setting real credentials.
4. **Same events, same output, different transport.** Gateway and webhook
   deliver the same `{ op, t, d }` envelope, so both inputs share
   `decodeMessageEvent` and produce the same `qq.group-message` /
   `qq.c2c-message` kinds; the reply feature is byte-for-byte identical to
   the gateway example's, and the passive-reply contract (address carries
   `msgId`, output auto-increments `msg_seq`) is asserted the same way via
   the recorded message.
5. **The fold gates the chain at compile time.** `type-test.ts` asserts
   that the provided capabilities read back typed
   (`kernel.ctx["qq-webhook"]: QqWebhook`, `kernel.ctx["qq-api"]: QqApi`),
   that `ctx.send` rejects non-string content and foreign-platform
   addresses, and that registration order is enforced through the bundle:
   env provider → webhook → api → output → features. Every
   `@ts-expect-error` line there is a genuine error — if one stops
   erroring, the fold regressed; fix the types, not the test.

## The plugin chain

```ts
const qq = qqWebhookPlatform({ webhook: "qq-webhook", api: "qq-api", env: "qq-env" });

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, {}) // provides the QqWebhook callback handler
    .use(qq.api, { apiBase: platform.apiBase }) // provides QqApi
    .use(qq.output) // sends through the "qq" platform
    .use(reply); // echoes each message back
```

There is no transport plugin: QQ pushes events to the bot, so receiving is
the hono route calling the webhook capability, and sending is always an
HTTPS call through the api capability. The example then runs its three
self-checks in order — op-13 callback validation, the signed echo round
trip (platform → webhook → reply feature → output → REST mock), and the
tampered-signature refusal — before stopping the kernel.

## File layout

| File           | Role                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `index.ts`     | The bot: kernel setup, the hono bridge, self-checking driver.           |
| `platform.ts`  | Fake QQ open platform: REST mock plus the signing callback client.      |
| `type-test.ts` | Compile-time assertions for the bundle's capability chain and the fold. |

## See also

- [`../qq-gateway-bot`](../qq-gateway-bot) — the same qq events and output
  over the websocket gateway infra, where the socket URL is discovered
  through the REST client.
- [`../../packages/protocol/qq`](../../packages/protocol/qq) — the protocol
  package: `qqGatewayPlatform`/`qqWebhookPlatform` bundles, the REST client,
  and the shared event decoder.
- [`../websocket-bot`](../websocket-bot) — the typed-capability model the
  webhook capability follows (provided values read back typed on
  `kernel.ctx`).
