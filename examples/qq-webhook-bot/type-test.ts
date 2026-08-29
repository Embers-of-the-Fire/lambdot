/**
 * Compile-time assertions for the qq webhook platform, mirroring
 * qq-gateway-bot/type-test.ts: env → webhook → api → output.
 */
import { createKernel, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import {
    qqWebhookPlatform,
    type QqApi,
    type QqEvents,
    type QqOutputs,
    type QqWebhook,
} from "@lambdot/protocol-qq";

const reply = definePlugin<QqEvents, QqOutputs>({
    name: "reply",
    apply(ctx) {
        return ctx.on("qq.c2c-message", (event) =>
            ctx.send(event.address, `echo: ${event.payload.content}`),
        );
    },
});

const qq = qqWebhookPlatform({ webhook: "qq-webhook", api: "qq-api", env: "qq-env" });

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, {})
    .use(qq.api, {})
    .use(qq.output)
    .use(reply);

// the provided capabilities are typed on the folded kernel context
const webhook: QqWebhook = kernel.ctx["qq-webhook"];
const api: QqApi = kernel.ctx["qq-api"];
void webhook;
void api;

// send checks content against the folded qq platform contract
void kernel.ctx.send({ platform: "qq", scope: "c2c", openid: "u1" }, "ok");
// @ts-expect-error qq content is plain text, not an object
void kernel.ctx.send({ platform: "qq", scope: "c2c", openid: "u1" }, { text: "nope" });

// send rejects addresses of unregistered platforms
// @ts-expect-error no "console" output is registered
void kernel.ctx.send({ platform: "console", target: "stdout" }, "hello");

// registration order is enforced through the bundle
// @ts-expect-error unregistered event kinds / output platforms
void createKernel().use(reply);

// the webhook input injects the env capability: the env provider must register first
// @ts-expect-error unprovided capabilities
void createKernel().use(qq.webhook, {});

// the output injects the api capability
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, {})
    // @ts-expect-error unprovided capabilities
    .use(qq.output);
