# cloudflare-bot

A ping-pong bot embedded in a Cloudflare worker — the reference example for
lambdot's **host integration** model: the composition is applied inside a
hono-served fetch handler, and the worker's named bindings (a KV namespace,
a plain text var) enter the composition as typed item-map values, with KV
serving as the feature's store directly.

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
   request/response, not a listener loop, so there is no input plugin: the
   `pingPong` feature plugin emits a `PingService` —
   `{ handle(message): Promise<PingReply> }` — as its item map, and the
   root plugin's own logic re-exports exactly what the worker needs
   (`defaultMessage`, `handle`) as the application's item map. The hono
   handler drives the round trip through what `apply` returned — typed, no
   casts.
2. **Bindings as typed item-map values.** `kvNamespace("pings")` takes the
   binding as it arrives on `env` (via `option: { binding: env.PINGS }`)
   and emits it under the `pings` namespace; `envVars("bot-env",
["PING_DEFAULT_MESSAGE"])` reads plain vars and secrets off the same
   bindings object (workers have no `process.env`) — passed as
   `option: { source: env }` — and fails loudly at application time if a
   required var is missing. Namespace names are parameters, so instances
   multiply — a second KV namespace composes in side by side.
3. **No state contract — the binding is the store.** The feature declares
   `{ pings: KVNamespace }` and reads/writes KV JSON directly, exactly as
   worker-native code would. The counter survives across requests because
   it lives in KV, not in the isolate. The mapping types enforce the
   ordering: `kvNamespace` before the feature that consumes it — the last
   step identity-wires, since the `pings` namespace matches the feature's
   declared input. Note that the increment is a plain read-modify-write:
   concurrent pings served by separate isolates can race and lose an
   increment, because KV offers no atomic increment. The counter is
   illustrative; for atomic state semantics, compose inside a Durable
   Object with `doStorage` instead.
4. **One application per isolate, not per request.** Workers hand bindings
   out per request, but the composition is applied once — lazily in the
   handler, with the scope held in isolate state — and reused for the
   isolate's lifetime. A real deployment on Cloudflare would keep this
   exact shape; only the source of `env` changes.

## The composition

```ts
function createBot(env: Env) {
    return definePlugin({ name: "app", apply: (ctx) => ({ ... }) })
        .with(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { option: { source: env } })
        .with(kvNamespace("pings"), { option: { binding: env.PINGS } })
        // identity wiring: the "pings" namespace feeds ping-pong
        .use(pingPong);
}
```

The hono handler is plain worker code around that application — apply it
once, then read the configured default and the service off the returned
item map:

```ts
app.post("/ping", async (c) => {
    if (bot === undefined) {
        const scope = createScope();
        const items = await createBot(c.env).apply(undefined, scope, undefined);
        bot = { items, scope };
    }

    let message = bot.items.defaultMessage;
    // ... parse an optional { message } from the JSON body ...

    return c.json(await bot.items.handle(message));
});
```

The `Env` bindings type is declared as a `type`, not an `interface`, so the
whole object stays assignable to `EnvVarsConfig["source"]` — interfaces get
no implicit index signature.

## File layout

| File        | Role                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `worker.ts` | The worker: composition, hono app, per-isolate application lifecycle.     |
| `index.ts`  | The driver: esbuild bundle, miniflare with bindings, self-checking pings. |

The binding providers themselves live in
[`../../packages/host/cloudflare`](../../packages/host/cloudflare) —
`kvNamespace` / `d1Database` / `r2Bucket` for resource bindings, `envVars`
for plain vars, and `doStorage` / `wsHub` for Durable Objects. The binding
types (`KVNamespace`, `D1Database`, `R2Bucket`) are structural subsets
declared locally, so real bindings from `@cloudflare/workers-types` are
assignable without the package taking a dependency.
