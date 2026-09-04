/**
 * Compile-time assertions for the qq webhook composition, mirroring
 * echo-bot/type-test.ts: env + http → webhook → reply.
 */
import { definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { httpHono } from "@lambdot/host-hono";
import { qqWebhook, type QqWebhook } from "@lambdot/protocol-qq";
import { Hono } from "hono";

const hono = new Hono();

const reply = definePlugin({
    name: "reply",
    apply(input: { qq: QqWebhook }, scope) {
        scope.onDispose(
            input.qq.onMessage((event) => void event.reply(`echo: ${event.message.content}`)),
        );
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .with(httpHono, { option: { hono } })
    .use(qqWebhook("qq"), {
        option: {},
        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
    })
    .use(reply);
void app;

// the webhook declares required input ({ http, env }), so it cannot be
// hermetic — with grants a blank context
// @ts-expect-error hermetic dependency cannot declare required input
void definePlugin({ name: "bare", apply: () => ({}) }).with(qqWebhook("qq"), { option: {} });

// ...and use without a mapping fails when the visible ctx cannot satisfy it
void definePlugin({ name: "bare", apply: () => ({}) })
    // @ts-expect-error mapping is required: neither "http" nor "env" is visible
    .use(qqWebhook("qq"), { option: {} });

// ...and its config is required even with a mapping
void definePlugin({ name: "bare", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .with(httpHono, { option: { hono } })
    // @ts-expect-error option is required (pass `{}` for defaults)
    .use(qqWebhook("qq"), { mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }) });

// mappings are checked against the namespaces visible at that point
void definePlugin({ name: "bare", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qqWebhook("qq"), {
        option: {},
        // @ts-expect-error "http" is not composed yet
        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
    });

// reply identity-wires only once the webhook's namespace exists
void definePlugin({ name: "bare", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .with(httpHono, { option: { hono } })
    // @ts-expect-error no "qq" namespace yet — the webhook is not composed
    .use(reply);
