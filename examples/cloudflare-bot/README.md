# cloudflare-bot

A ping-pong bot embedded in a Cloudflare worker — the reference example for
lambdot's **host integration** model: the kernel lives inside a hono-served
fetch handler, and the worker's named bindings (a KV namespace, a plain text
var) enter the composition as typed namespace values, with KV doubling as
the framework's pluggable state backend.

```console
$ nub run -F @lambdot-example/cloudflare-bot start
first ping:  {"reply":"pong: hello","count":1}
second ping: {"reply":"pong: again","count":2}
bodiless:    {"reply":"pong: ping","count":3}
cloudflare-bot: OK
```

There is no `wrangler.toml`: the example runs the worker locally under
miniflare, which stands in for Cloudflare's infra with a real workerd
isolate. Bindings are declared as miniflare options in
[`index.ts`](./index.ts) (`kvNamespaces: ["PINGS"]`, a `PING_DEFAULT_MESSAGE`
text var); the worker source is bundled with esbuild first because workerd
runs plain ESM — that bundling is the example's only build step. The driver
then posts three pings and exits non-zero if any reply is wrong — it is its
own integration test.

## What it demonstrates

1. **A composition embedded in a fetch handler.** HTTP is
   request/response, not a listener loop, so there is no input plugin and
   no streams: the `pingPong` feature plugin emits a `PingService` —
   `{ handle(message): Promise<PingReply> }` — as its namespace value, and
   the hono handler drives the round trip through
   `bot.ctx["ping-pong"].handle(message)`. The service is typed by the
   composition, so the call needs no casts.
2. **Bindings as typed namespace values.** `kvNamespace("pings")` takes the
   binding as it arrives on `env` (via `option: { binding: env.PINGS }`)
   and emits it under the `pings` namespace; `envVars("bot-env",
["PING_DEFAULT_MESSAGE"])` reads plain vars and secrets off the same
   bindings object (workers have no `process.env`) — passed as
   `option: { source: env }` — and fails loudly at kernel start if a
   required var is missing. Namespace names are parameters, so instances
   multiply — a second KV namespace composes in side by side, exactly like
   the websocket transports in [`../websocket-bot`](../websocket-bot).
3. **KV-backed plugin state.** `kvState("state")` declares the KV binding
   as its input (`mapping: (ctx) => ({ kv: ctx.pings })`) and emits the
   framework's `StateBackend` under the `state` namespace, so the
   `ping-pong` feature reaches the namespace through the ordinary typed
   accessor, `createStateAccessor<PingPongSchema>(input.state, "ping-pong")`.
   The counter survives across requests because it lives in KV, not in the
   isolate. The mapping types enforce the ordering: `kvNamespace` before
   `kvState` before the stateful feature — the last step identity-wires,
   since the bound `state` namespace matches the feature's declared input.
4. **One persistent kernel per isolate, not per request.** Workers hand
   bindings out per request, but the kernel is booted once —
   `bot ??= createBot(c.env)` in the handler, with `start` idempotent — and
   reused for the isolate's lifetime. A real deployment on Cloudflare would
   keep this exact shape; only the source of `env` changes.

## The plugin chain

```ts
function createBot(env: Env) {
    return (
        createKernel()
            .use(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { option: { source: env } })
            .bind(kvNamespace("pings"), { option: { binding: env.PINGS } })
            .bind(kvState("state"), { mapping: (ctx) => ({ kv: ctx.pings }) })
            // identity wiring: the bound "state" namespace feeds ping-pong
            .use(pingPong)
    );
}
```

The hono handler is plain worker code around that kernel — read the
configured default through the env namespace, override it with the request
body when one arrives, then answer through the service namespace:

```ts
app.post("/ping", async (c) => {
    bot ??= createBot(c.env);
    await bot.start();

    let message = bot.ctx["bot-env"].PING_DEFAULT_MESSAGE;
    // ... parse an optional { message } from the JSON body ...

    return c.json(await bot.ctx["ping-pong"].handle(message));
});
```

The `Env` bindings type is declared as a `type`, not an `interface`, so the
whole object stays assignable to `EnvVarsConfig["source"]` — interfaces get
no implicit index signature.

## File layout

| File        | Role                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `worker.ts` | The worker: plugin chain, hono app, per-isolate kernel lifecycle.         |
| `index.ts`  | The driver: esbuild bundle, miniflare with bindings, self-checking pings. |

The binding providers themselves live in
[`../../packages/host/cloudflare`](../../packages/host/cloudflare) —
`kvNamespace` / `d1Database` / `r2Bucket` for resource bindings, `envVars`
for plain vars, and `kvState` for the KV-backed `StateBackend` bridge. The
binding types (`KVNamespace`, `D1Database`, `R2Bucket`) are structural
subsets declared locally, so real bindings from `@cloudflare/workers-types`
are assignable without the package taking a dependency.
