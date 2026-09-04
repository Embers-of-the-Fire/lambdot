# @lambdot/http

The abstract HTTP surface for lambdot, as a structural contract over
web-standard types — no server, no framework, just the slice a protocol
package needs to register its routes.

## What it provides

Only the contract:

```ts
interface HttpServer {
    on(method: string, path: string, handler: HttpHandler): void;
}
type HttpHandler = (c: HttpContext) => Response | Promise<Response>;
interface HttpContext {
    readonly req: HttpRequest;
}
interface HttpRequest {
    readonly raw: Request;
    param(name: string): string | undefined;
}
```

The contract is structural: anything able to register a route satisfies it.
A hono app satisfies it directly — [`@lambdot/host-hono`](../../host/hono)
emits the host's `Hono` instance as a plugin's item map typed as
`HttpServer`; another framework adapts with a thin wrapper. `path` may carry
`:param` segments, read back through `c.req.param(name)`; everything else —
headers, body, query — is read from the web-standard `c.req.raw`.

There is deliberately no server here, and no per-route disposal: routes
live as long as the server that holds them, and host teardown ends them.
The host keeps full ownership of everything beyond route registration —
middleware, sub-routers, and the listening socket stay on its own instance.

## Usage

A protocol package declares `{ http: HttpServer }` in its input and
registers its routes at application time:

```ts
import { definePlugin } from "@lambdot/core";
import type { HttpServer } from "@lambdot/http";

const health = definePlugin({
    name: "health",
    apply(input: { http: HttpServer }) {
        input.http.on("GET", "/health", () => new Response("ok"));
    },
});

// a host wires its server in — the plugin never knows which:
app.use(health, { mapping: (ctx) => ({ http: ctx.http }) });
```

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
