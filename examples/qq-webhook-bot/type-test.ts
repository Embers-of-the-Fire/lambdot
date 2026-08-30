/**
 * Compile-time assertions for the qq webhook platform, mirroring
 * qq-gateway-bot/type-test.ts: env → webhook → api → reply → output.
 */
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqWebhookPlatform, type QqMessageStream, type QqWebhook } from "@lambdot/protocol-qq";

const reply = definePlugin({
    name: "reply",
    apply(input: { messages: QqMessageStream }) {
        return mapStream(input.messages, (event) => ({
            address: event.address,
            content: `echo: ${event.payload.content}`,
        }));
    },
});

const qq = qqWebhookPlatform("qq");

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq.messages }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });

// the webhook bridge is typed on the ctx
const webhook: QqWebhook = kernel.ctx.qq;
void webhook;

// internal wiring is hidden from the final ctx
// @ts-expect-error the api was bound, not used
void kernel.ctx["qq/api"];
// @ts-expect-error the output was bound, not used
void kernel.ctx["qq/output"];

// the webhook's env input cannot be identity-wired: no "env" namespace
// @ts-expect-error mapping is required when the declared input is absent
void createKernel().use(qq.webhook, { option: {} });

// ...and its config is required even with a mapping
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    // @ts-expect-error option is required (pass `{}` for defaults)
    .use(qq.webhook, { mapping: (ctx) => ({ env: ctx["qq-env"] }) });

// reply's messages input cannot be identity-wired: no "messages" namespace
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    // @ts-expect-error the webhook emits "qq"; reply wants "messages" — map it
    .use(reply);
