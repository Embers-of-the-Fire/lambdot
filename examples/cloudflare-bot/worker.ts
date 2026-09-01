import type { OwnedScope } from "@lambdot/core";
import { createScope, definePlugin } from "@lambdot/core";
import type { KVNamespace } from "@lambdot/host-cloudflare";
import { envVars, kvNamespace } from "@lambdot/host-cloudflare";
import { Hono } from "hono";

/**
 * The worker's named bindings, as declared in the miniflare/wrangler config.
 * Declared as a `type` (not an `interface`) so the whole object stays
 * assignable to `EnvVarsConfig["source"]` — interfaces get no implicit
 * index signature.
 */
type Env = {
    /** Plain text var: the fallback message for a ping without a body. */
    readonly PING_DEFAULT_MESSAGE: string;
    readonly PINGS: KVNamespace;
};

/** What a ping comes back with. */
export interface PingReply {
    readonly reply: string;
    readonly count: number;
}

/**
 * The request/response service, emitted as the feature's item map: the hono
 * handler lives outside the composition, so it drives the round trip
 * through the item map the application returned — typed, no casts.
 */
export interface PingService {
    handle(message: string): Promise<PingReply>;
}

/**
 * The ping-pong feature. Each ping increments a counter in the KV namespace
 * — declared directly as the feature's input; there is no framework state
 * contract — and replies. No event indirection: HTTP is request/response,
 * so `handle` does the work inline.
 */
const pingPong = definePlugin({
    name: "ping-pong",
    apply(input: { pings: KVNamespace }) {
        const service: PingService = {
            async handle(message) {
                // Illustrative read-modify-write: concurrent pings served by
                // separate isolates can race and lose an increment, because
                // KV offers no atomic increment. For atomic semantics use a
                // Durable Object (`doStorage` from @lambdot/host-cloudflare).
                const stored = await input.pings.get("ping-pong:count", { type: "json" });
                const count = (typeof stored === "number" ? stored : 0) + 1;
                await input.pings.put("ping-pong:count", JSON.stringify(count));
                return { reply: `pong: ${message}`, count };
            },
        };
        return service;
    },
});

/** What the worker needs back from the application. */
interface BotItems {
    readonly defaultMessage: string;
    readonly handle: PingService["handle"];
}

function createBot(env: Env) {
    return (
        definePlugin({
            name: "app",
            apply: (ctx: {
                "bot-env": Readonly<Record<"PING_DEFAULT_MESSAGE", string>>;
                "ping-pong": PingService;
            }): BotItems => ({
                defaultMessage: ctx["bot-env"].PING_DEFAULT_MESSAGE,
                handle: (message) => ctx["ping-pong"].handle(message),
            }),
        })
            .with(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { option: { source: env } })
            .with(kvNamespace("pings"), { option: { binding: env.PINGS } })
            // identity wiring: the "pings" namespace feeds ping-pong
            .use(pingPong)
    );
}

// Workers hand bindings out per request; the composition is applied once
// per isolate and reused after that. The scope lives as long as the
// isolate — there is nothing to stop, only resources held open.
let bot: { items: BotItems; scope: OwnedScope } | undefined;

const app = new Hono<{ Bindings: Env }>();

app.post("/ping", async (c) => {
    if (bot === undefined) {
        const scope = createScope();
        const items = await createBot(c.env).apply({}, scope, undefined);
        bot = { items, scope };
    }

    // No message in the request body? Fall back to the worker's configured
    // var, re-exported on the application's item map.
    let message = bot.items.defaultMessage;
    try {
        const body: unknown = await c.req.json();
        if (
            typeof body === "object" &&
            body !== null &&
            "message" in body &&
            typeof body.message === "string"
        )
            message = body.message;
    } catch {
        // Not JSON (or no body): ping with the default message.
    }

    return c.json(await bot.items.handle(message));
});

export default app;
