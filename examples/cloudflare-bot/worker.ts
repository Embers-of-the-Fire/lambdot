import type { Address, EventDef, InputPlugin } from "@lambdot/core";
import { createKernel, definePlugin } from "@lambdot/core";
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

/** Events produced at the HTTP boundary: one per ping request. */
export type PingEvents = {
    ping: EventDef<{ message: string }, Address<"http">>;
};

/** What a ping comes back with. */
export interface PingReply {
    readonly reply: string;
    readonly count: number;
}

/**
 * The request/response bridge, provided as a typed capability: the hono
 * handler lives outside the event pipeline, so it drives the round trip
 * through `kernel.ctx.ping` — typed by the capability fold, no casts.
 */
export interface PingService {
    handle(message: string): Promise<PingReply>;
}

export type PingCapability = { readonly ping: PingService };

/**
 * The input half of the HTTP boundary: registers the `ping` event kind with
 * the fold before the feature that handles it. Ingestion itself happens
 * through the `PingService` capability (HTTP is request/response, not a
 * listener loop), so there is nothing to apply.
 */
function pingInput(): InputPlugin<PingEvents, void, "ping-input"> {
    return {
        role: "input",
        name: "ping-input",
        apply() {},
    };
}

interface PingPongSchema {
    count: number;
}

/**
 * The ping-pong feature. Owns the `ping` event kind: each ping increments a
 * counter in plugin state (served from the KV namespace via `kvState`) and
 * bails `serial` dispatch with the reply.
 */
const pingPong = definePlugin<PingEvents, {}, PingPongSchema, void, "ping-pong", PingCapability>({
    name: "ping-pong",
    inject: ["state"],
    apply(ctx) {
        const unlisten = ctx.on("ping", async (event) => {
            const state = ctx.state.for("ping-pong");
            const count = ((await state.get("count")) ?? 0) + 1;
            await state.set("count", count);
            return { reply: `pong: ${event.payload.message}`, count } satisfies PingReply;
        });

        const service: PingService = {
            // The listener above always bails serial dispatch with a PingReply.
            handle: (message) =>
                ctx.serial("ping", {
                    kind: "ping",
                    payload: { message },
                    address: { platform: "http" },
                    id: crypto.randomUUID(),
                    at: Date.now(),
                }) as Promise<PingReply>,
        };
        const unprovide = ctx.provide("ping", service);

        return [unlisten, unprovide];
    },
});

function createBot(env: Env) {
    return createKernel()
        .use(pingInput())
        .use(envVars("bot-env", ["PING_DEFAULT_MESSAGE"]), { source: env })
        .use(kvNamespace("pings"), { binding: env.PINGS })
        .use(kvState("pings"))
        .use(pingPong);
}

// Workers hand bindings out per request; boot the kernel once per isolate
// and reuse it after that (`start` is idempotent).
let bot: ReturnType<typeof createBot> | undefined;

const app = new Hono<{ Bindings: Env }>();

app.post("/ping", async (c) => {
    bot ??= createBot(c.env);
    await bot.start();

    // No message in the request body? Fall back to the worker's configured
    // var, read through the env capability fold.
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

    return c.json(await bot.ctx.ping.handle(message));
});

export default app;
