import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";
import type { HttpServer } from "@lambdot/http";
import type { Hono } from "hono";

/** Config for {@link httpHono}: the host's hono app, supplied as-is. */
export interface HttpHonoConfig {
    readonly hono: Hono;
}

/**
 * The host's hono app as the composition's HTTP surface: the plugin emits
 * the app itself as its item map, typed as the structural {@link HttpServer}
 * contract from `@lambdot/http` — a hono app satisfies it directly. The
 * host keeps full ownership of everything beyond route registration:
 * middleware, sub-routers, and `serve` stay on its own instance.
 *
 * ```ts
 * const hono = new Hono();
 * app.with(httpHono, { option: { hono } });
 * // ctx.http: HttpServer — consumers register routes through the contract
 * serve({ fetch: hono.fetch, port });
 * ```
 */
export const httpHono: Plugin<void, HttpServer, HttpHonoConfig, "http"> = definePlugin({
    name: "http",
    apply: (_input, _scope, config) => config.hono,
});
