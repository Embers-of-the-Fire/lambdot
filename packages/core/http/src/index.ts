/**
 * The request half of an {@link HttpContext}: the web-standard request,
 * plus the route parameters the server captured while matching the path
 * pattern (e.g. `/users/:id`). Everything not covered here — headers, body
 * decoding, query strings — is read from `raw`.
 */
export interface HttpRequest {
    /** The web-standard request. */
    readonly raw: Request;
    /** The route parameter captured under `name` by the path pattern, if any. */
    param(name: string): string | undefined;
}

/** One matched request, handed to an {@link HttpHandler}. */
export interface HttpContext {
    readonly req: HttpRequest;
}

/**
 * One HTTP request handler, answered with a `Response` — web-standard
 * types, so the same handler runs on any server satisfying
 * {@link HttpServer}.
 */
export type HttpHandler = (c: HttpContext) => Response | Promise<Response>;

/**
 * The abstract HTTP surface, as a structural contract: anything able to
 * register a route satisfies it — a hono app directly (see
 * `@lambdot/host-hono`), another framework through a thin adapter. Protocol
 * packages declare `{ http: HttpServer }` in their input and register their
 * routes at application time; the host hands its server in as a plugin's
 * item map and keeps full ownership of everything else — middleware,
 * sub-routers, the listening socket.
 *
 * Routes are not unregistered: the contract models a server whose routes
 * live as long as the server itself. Host teardown, not per-route disposal,
 * ends them.
 */
export interface HttpServer {
    /**
     * Register `handler` for requests matching `method` and `path`. `path`
     * may carry `:param` segments, read back through `c.req.param(name)`.
     */
    on(method: string, path: string, handler: HttpHandler): void;
}
