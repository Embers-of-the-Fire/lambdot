# qq-webhook-bot

A self-verifying echo bot speaking the real QQ webhook (reversed-post)
protocol against a fake open platform — the reference example for the
specification's abstract/handler pattern over HTTP: the bot declares
`{ http: HttpServer }` (from `@lambdot/http`), and the host hands its hono
app in through `@lambdot/host-hono`.

```console
$ nub run -F @lambdot-example/qq-webhook-bot start
platform recorded: {"scope":"group","openid":"GROUP_FAKE_OPENID","content":"echo: hello from qq","msgId":"ROBOT1.0_inbound_1"}
qq-webhook-bot: OK
```

The example starts a fake QQ open platform in-process (token endpoint,
send-message endpoints, and the callback side of the webhook protocol — it
signs reversed-post requests with the shared bot secret), applies the
composition, serves the hono app, and exits non-zero if any of
its three checks fail. No QQ credentials are needed; the ones in `index.ts`
are fakes that match the secret the fake platform signs with.

## What it demonstrates

1. **The HTTP surface belongs to the host.** `qqWebhook` binds no port and
   owns no server. It declares `{ http: HttpServer; env: … }` as its input
   and registers its callback route on the wired-in server at application
   time; the route lives as long as the host's app. The host side is plain
   hono: `httpHono` (from `@lambdot/host-hono`) emits the `Hono` instance
   as the composition's `http` namespace — a hono app satisfies the
   structural `HttpServer` contract directly, no adapter — and the host
   serves that same instance itself:

    ```ts
    const hono = new Hono();
    app.with(httpHono, { option: { hono } });
    serve({ fetch: hono.fetch, port });
    ```

    The same composition drops into any other HTTP host unchanged — swap
    the server behind the contract, nothing else.

2. **Listening and replying are separate, context-bound halves.** The
   webhook's item map is `{ onEvent(listener): Disposer }` — a pure event
   listener with no REST client inside. Each decoded event carries its own
   reply `context` (`{ msgId }` for message events, `{ eventId }` for
   interaction/lifecycle events), and replying is a `qqApi` send with that
   context provided: the passive-reply reference is resolved from the
   context the caller hands over, never from state bound into the client.

3. **Signature verification is exercised end-to-end.** The callback
   algorithm is real protocol code: op-13 callback-address validation (sign
   `event_ts + plain_token` with the ed25519 keypair seeded from the bot
   secret, repeated to 32 bytes), and for every other frame, ed25519
   verification of `X-Signature-Ed25519` over `timestamp + body` before the
   payload is trusted. The example checks all of it: the platform validates
   the callback address (op 13) and verifies the returned signature, a
   signed dispatch round-trips into an echo, and a deliberately forged
   signature is refused with 401.

4. **The protocol is real, the platform is fake.** Token lifecycle, the
   send-message REST calls, and the callback algorithm all come from
   `@lambdot/protocol-qq`. [`platform.ts`](./platform.ts) is a demo shim
   implementing the platform's side: it derives the same keypair from the
   shared secret, signs its POSTs, and records what the bot sends. Swapping
   in the real infra means dropping the shim, exposing the server at a
   public URL, and setting real credentials.

5. **The mapping types gate the chain at compile time.** `type-test.ts`
   asserts that the webhook — which declares required input — cannot be
   `with`-ed, that `mapping` is required when the visible context lacks
   `http`/`env`, that `option` is required even with a mapping (pass `{}`
   for defaults), and that `reply` identity-wires only once the `qq` and
   `api` namespaces exist. Every `@ts-expect-error` line there is a genuine
   error — if one stops erroring, the types regressed; fix the types, not
   the test.

## The composition

```ts
const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .with(httpHono, { option: { hono } })
    .use(qqWebhook("qq"), {
        option: {},
        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
    })
    .use(qqApi("api"), {
        option: { apiBase: platform.apiBase },
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
    })
    // identity wiring: reply's input keys match the visible ctx
    .use(reply);
```

Env and server are hermetic (`with`): snapshots and bindings depend on
nothing around them. The webhook and the REST client are `use`d with
mappings that reshape the accumulated namespaces into their declared
inputs. The example then runs its three self-checks in order — op-13
callback validation, the signed echo round trip (platform → hono → webhook
→ reply → REST mock), and the tampered-signature refusal — before disposing
the scope.

## File layout

| File           | Role                                                               |
| -------------- | ------------------------------------------------------------------ |
| `index.ts`     | The bot: composition, the hono server, self-checking driver.       |
| `platform.ts`  | Fake QQ open platform: REST mock plus the signing callback client. |
| `type-test.ts` | Compile-time assertions for the composition's wiring.              |

## See also

- [`../../packages/protocol/qq`](../../packages/protocol/qq) — the protocol
  package: the webhook plugin, the REST client, and the event decoder.
- [`../../packages/core/http`](../../packages/core/http) — the structural
  `HttpServer` contract the composition is written against.
- [`../../packages/host/hono`](../../packages/host/hono) — the host side:
  a hono app as the composition's HTTP surface.
- [`../cloudflare-bot`](../cloudflare-bot) — the same host-owns-the-surface
  shape embedded in a worker.
