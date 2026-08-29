/**
 * Compile-time assertions for the qq gateway platform, mirroring
 * websocket-bot/type-test.ts: the fold and the registration gate must keep
 * working through the bundled capability names — env → api → transport →
 * input → output.
 */
import { createKernel, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqGatewayPlatform, type QqApi, type QqEvents, type QqOutputs } from "@lambdot/protocol-qq";
import type { WsConnection } from "@lambdot/websocket";

const reply = definePlugin<QqEvents, QqOutputs>({
    name: "reply",
    apply(ctx) {
        return ctx.on("qq.group-message", (event) => {
            // payload is typed QqMessage
            const content: string = event.payload.content;
            return ctx.send(event.address, `echo: ${content}`);
        });
    },
});

const qq = qqGatewayPlatform({ ws: "qq-ws", api: "qq-api", env: "qq-env" });

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.api, {})
    .use(qq.transport)
    .use(qq.input, {})
    .use(qq.output)
    .use(reply);

// the provided capabilities are typed on the folded kernel context
const api: QqApi = kernel.ctx["qq-api"];
const connection: WsConnection = kernel.ctx["qq-ws"];
void api;
void connection;

// the env snapshot is keyed by the requested variable names
const appId: string = kernel.ctx["qq-env"].QQ_BOT_APP_ID;
void appId;

// send checks content against the folded qq platform contract
void kernel.ctx.send({ platform: "qq", scope: "group", openid: "g1" }, "ok");
// @ts-expect-error qq content is plain text, not an object
void kernel.ctx.send({ platform: "qq", scope: "group", openid: "g1" }, { text: "nope" });

// send rejects addresses of unregistered platforms
// @ts-expect-error no "console" output is registered
void kernel.ctx.send({ platform: "console", target: "stdout" }, "hello");

// handlers can only subscribe to registered event kinds
// @ts-expect-error "discord.message" was never registered by an input
void kernel.ctx.on("discord.message", () => {});

// registration order is enforced through the bundle
// @ts-expect-error unregistered event kinds / output platforms
void createKernel().use(reply);

// the api injects the env capability: the env provider must register first
// @ts-expect-error unprovided capabilities
void createKernel().use(qq.api, {});

// the transport injects the api capability: the api must register first
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    // @ts-expect-error unprovided capabilities
    .use(qq.transport);

// the input injects both the transport and the api capabilities
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.api, {})
    .use(qq.transport)
    // @ts-expect-error the input config is required (pass `{}` for defaults)
    .use(qq.input);

// the output injects the api capability
// @ts-expect-error unprovided capabilities
void createKernel().use(qq.output);
