# @lambdot/host-hono

The host's hono app as the composition's HTTP surface. `httpHono` emits the
`Hono` instance supplied as config as its item map, typed as the structural
[`HttpServer`](../../core/http) contract — a hono app satisfies it directly,
no adapter.

## What it provides

One plugin:

```ts
export const httpHono: Plugin<void, HttpServer, HttpHonoConfig, "http">;
interface HttpHonoConfig {
    readonly hono: Hono;
}
```

The host owns the server: it creates the hono app, attaches its own
middleware and sub-routers, and calls `serve`. Consumers see only the
contract slice — `on(method, path, handler)` — and register their routes
through it. Routes live as long as the app; there is no per-route disposal.

## Usage

```ts
import { serve } from "@hono/node-server";
import { createScope, definePlugin } from "@lambdot/core";
import { httpHono } from "@lambdot/host-hono";
import { Hono } from "hono";

const hono = new Hono();

const app = definePlugin({ name: "app", apply: () => ({}) }).with(httpHono, {
    option: { hono },
});
// ctx.http: HttpServer — compose consumers that declare { http: HttpServer }

const scope = createScope();
await app.apply({}, scope, undefined);
serve({ fetch: hono.fetch, port: 3000 });
```

A second server composes under a different namespace with `as`:

```ts
app.with(httpHono, { option: { hono: internal }, as: "internal" });
```

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
