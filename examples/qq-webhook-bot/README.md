# qq-webhook-bot

A self-verifying echo bot speaking the real QQ webhook (reversed-post)
protocol against a fake open platform — the reference example for embedding
a kernel into an HTTP host: the input owns no port, the callback algorithm
is a typed namespace value, and a hono route is the whole integration.

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

1. **The input is a namespace value, not a server.** `qq.webhook` binds no
   port and owns no HTTP surface. It emits a `QqWebhook` — a
   `handle(request): Promise<Response>` method implementing the callback
   algorithm, plus the `messages` stream decoded dispatches are pushed to.
   The HTTP route lives outside the composition and hands each callback
   request to `handle`:

    ```ts
    const app = new Hono();
    app.post("/qq/callback", (c) => kernel.ctx.qq.handle(c.req.raw));
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
   `decodeMessageEvent` and produce the same `QqMessageStream`; the reply
   feature is byte-for-byte identical to the gateway example's (only its
   `mapping` differs — the webhook emits `{ handle, messages }` under
   `ctx.qq`, so the adapter reads `ctx.qq.messages`), and the passive-reply
   contract (address carries `msgId`, output auto-increments `msg_seq`) is
   asserted the same way via the recorded message.
5. **The mapping types gate the chain at compile time.** `type-test.ts`
   asserts that the exposed namespaces read back typed
   (`kernel.ctx.qq: QqWebhook`), that `bind`ed namespaces (`qq/api`,
   `qq/output`) are hidden from the final `ctx`, that `mapping` is required
   when a declared input key is absent (no `env` namespace; no `messages`
   namespace), and that `option` is required even with a mapping (pass `{}`
   for defaults). Every `@ts-expect-error` line there is a genuine error —
   if one stops erroring, the types regressed; fix the types, not the test.

## The plugin chain

```ts
const qq = qqWebhookPlatform("qq");

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.api, {
        option: { apiBase: platform.apiBase },
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
    })
    // the mapping is the platform adapter: reply wants "messages", the
    // webhook emits { handle, messages }
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq.messages }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });
```

There is no transport plugin: QQ pushes events to the bot, so receiving is
the hono route calling the webhook's `handle`, and sending is always an
HTTPS call through the api service. The example then runs its three
self-checks in order — op-13 callback validation, the signed echo round
trip (platform → webhook → reply feature → output → REST mock), and the
tampered-signature refusal — before stopping the kernel.

## File layout

| File           | Role                                                               |
| -------------- | ------------------------------------------------------------------ |
| `index.ts`     | The bot: kernel setup, the hono bridge, self-checking driver.      |
| `platform.ts`  | Fake QQ open platform: REST mock plus the signing callback client. |
| `type-test.ts` | Compile-time assertions for the bundle's mapping-wired chain.      |

## See also

- [`../qq-gateway-bot`](../qq-gateway-bot) — the same qq events and output
  over the websocket gateway infra, where the socket URL is discovered
  through the REST client.
- [`../../packages/protocol/qq`](../../packages/protocol/qq) — the protocol
  package: `qqGatewayPlatform`/`qqWebhookPlatform` bundles, the REST client,
  and the shared event decoder.
- [`../websocket-bot`](../websocket-bot) — the mapping-wiring model the
  webhook plugin follows (exposed namespace values read back typed on
  `kernel.ctx`).
