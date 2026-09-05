import { serve } from "@hono/node-server";
import { createScope, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { httpHono } from "@lambdot/host-hono";
import { qqApi, qqWebhook, type QqApi, type QqWebhook } from "@lambdot/protocol-qq";
import { Hono } from "hono";

import { startFakeQqPlatform } from "./platform.ts";

// The credentials are fakes for the fake platform; a real deployment sets
// them in the environment. The secret must match the one the platform signs
// callbacks with.
process.env.QQ_BOT_APP_ID ??= "102000001";
process.env.QQ_BOT_APP_SECRET ??= "fake-bot-secret-fake-bot-se";

const reply = definePlugin({
    name: "reply",
    apply(input: { qq: QqWebhook; api: QqApi }, scope) {
        scope.onDispose(
            input.qq.onEvent((event) => {
                // The webhook only listens; replying goes through the REST
                // client with the context the event carries.
                if (event.type === "C2C_MESSAGE_CREATE")
                    void input.api.sendC2cMessage(
                        event.userOpenid,
                        { msgType: 0, content: `echo: ${event.message.content.trim()}` },
                        event.context,
                    );
                if (event.type === "GROUP_AT_MESSAGE_CREATE")
                    void input.api.sendGroupMessage(
                        event.groupOpenid,
                        { msgType: 0, content: `echo: ${event.message.content.trim()}` },
                        event.context,
                    );
            }),
        );
    },
});

const platform = await startFakeQqPlatform();

// The host owns the HTTP surface: a plain hono app. The composition only
// sees the structural HttpServer slice of it.
const hono = new Hono();

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .with(httpHono, { option: { hono } })
    .use(qqWebhook("qq"), {
        option: {},
        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
    })
    .use(qqApi("api"), {
        option: { apiBase: platform.apiBase },
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
    })
    // identity wiring: reply's input keys match the visible ctx
    .use(reply);

const scope = createScope();
await app.apply({}, scope, undefined);

// The webhook registered its callback route on the hono app when the
// composition applied; serving is the host's own concern.
const server = serve({ fetch: hono.fetch, port: 0 });
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

// 2. A signed dispatch reaches the reply feature and is answered through
//    the REST mock: platform → hono → webhook → reply → REST mock.
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

await scope.dispose();
await platform.close();
await new Promise<void>((resolve) => server.close(() => resolve()));

if (received.content !== "echo: hello from qq" || received.msgId !== pushed.msgId)
    fail("unexpected reply");
console.log("qq-webhook-bot: OK");
