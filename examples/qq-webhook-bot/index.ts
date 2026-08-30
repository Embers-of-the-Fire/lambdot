import { serve } from "@hono/node-server";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqWebhookPlatform, type QqMessageStream } from "@lambdot/protocol-qq";
import { Hono } from "hono";

import { startFakeQqPlatform } from "./platform.ts";

// The credentials are fakes for the fake platform; a real deployment sets
// them in the environment. The secret must match the one the platform signs
// callbacks with.
process.env.QQ_BOT_APP_ID ??= "102000001";
process.env.QQ_BOT_APP_SECRET ??= "fake-bot-secret-fake-bot-se";

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

const platform = await startFakeQqPlatform();

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.webhook, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.api, {
        option: { apiBase: platform.apiBase },
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
    })
    // the mapping is the platform adapter: reply wants "messages", the
    // webhook emits { handle, messages }
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq.messages }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });

await kernel.start();

// The hono app owns the HTTP surface; the webhook namespace owns the
// callback algorithm. This bridge is the whole "reversed post" integration.
const app = new Hono();
app.post("/qq/callback", (c) => kernel.ctx.qq.handle(c.req.raw));

const server = serve({ fetch: app.fetch, port: 0 });
const port = await new Promise<number>((resolve) => {
    server.on("listening", () => {
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
});
const callbackUrl = `http://127.0.0.1:${port}/qq/callback`;

const fail = (message: string): never => {
    console.error(`qq-webhook-bot: FAIL — ${message}`);
    process.exit(1);
};

// 1. The open platform validates the callback address (op 13): the bot
//    answers with an ed25519 signature the platform can verify.
if (!(await platform.validateCallback(callbackUrl))) fail("callback validation rejected");

// 2. A signed dispatch is pushed to the stream and answered through the
//    REST mock: platform → webhook → reply feature → output → REST mock.
const echoed = platform.waitForMessage((message) => message.content.startsWith("echo:"));
const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timed out waiting for echo")), 5000);
});
const pushed = await platform.pushGroupMessage(callbackUrl, "hello from qq");
if (pushed.status !== 200) fail(`callback returned ${pushed.status}`);
const received = await Promise.race([echoed, timeout]);
console.log(`platform recorded: ${JSON.stringify(received)}`);

// 3. A forged signature is refused.
const tamperedStatus = await platform.pushTamperedMessage(callbackUrl);
if (tamperedStatus !== 401) fail(`tampered callback returned ${tamperedStatus}, expected 401`);

await kernel.stop();
await platform.close();
await new Promise<void>((resolve) => server.close(() => resolve()));

if (received.content !== "echo: hello from qq" || received.msgId !== pushed.msgId)
    fail("unexpected reply");
console.log("qq-webhook-bot: OK");
