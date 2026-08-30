import type { StateBackend } from "@lambdot/core";
import { createKernel, createStateAccessor, definePlugin } from "@lambdot/core";
import type { KVNamespace } from "@lambdot/host-cloudflare";
import { envVars, kvNamespace, kvState } from "@lambdot/host-cloudflare";
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
 * The request/response bridge, emitted as the plugin's namespace value: the
 * hono handler lives outside the composition, so it drives the round trip
 * through `kernel.ctx["ping-pong"]` — typed by the composition, no casts.
 */
export interface PingService {
    handle(message: string): Promise<PingReply>;
}

interface PingPongSchema {
    count: number;
}

/**
 * The ping-pong feature. Each ping increments a counter in plugin state
 * (served from the KV namespace via `kvState`) and replies. No event
 * indirection: HTTP is request/response, so `handle` does the work inline.
 */
const pingPong = definePlugin({
    name: "ping-pong",
    apply(input: { state: StateBackend }) {
        const state = createStateAccessor<PingPongSchema>(input.state, "ping-pong");
        const service: PingService = {
            async handle(message) {
                // Illustrative read-modify-write: concurrent pings served by
                // separate isolates can race and lose an increment, because
                // KV offers no atomic increment. For atomic semantics use a
                // Durable Object (`doState` from @lambdot/host-cloudflare).
                const count = ((await state.get("count")) ?? 0) + 1;
                await state.set("count", count);
                return { reply: `pong: ${message}`, count };
            },
        };
        return service;
    },
});

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

// Workers hand bindings out per request; boot the composition once per
// isolate and reuse it after that (`start` is idempotent).
let bot: ReturnType<typeof createBot> | undefined;

const app = new Hono<{ Bindings: Env }>();

app.post("/ping", async (c) => {
    bot ??= createBot(c.env);
    await bot.start();

    // No message in the request body? Fall back to the worker's configured
    // var, read from the env namespace.
    let message = bot.ctx["bot-env"].PING_DEFAULT_MESSAGE;
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

    return c.json(await bot.ctx["ping-pong"].handle(message));
});

export default app;
