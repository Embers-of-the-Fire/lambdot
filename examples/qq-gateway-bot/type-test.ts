/**
 * Compile-time assertions for the qq gateway platform, mirroring
 * websocket-bot/type-test.ts: mapping-based wiring through the bundle —
 * env → api → transport → input → reply → output.
 */
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqGatewayPlatform, type QqMessageStream } from "@lambdot/protocol-qq";

const reply = definePlugin({
    name: "reply",
    apply(input: { messages: QqMessageStream }) {
        return mapStream(input.messages, (event) => ({
            address: event.address,
            content: `echo: ${event.payload.content}`,
        }));
    },
});

const qq = qqGatewayPlatform("qq");

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.transport, { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
    .use(qq.input, {
        option: {},
        mapping: (ctx) => ({ connection: ctx["qq/transport"], api: ctx["qq/api"] }),
    })
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });

// the env snapshot and the message stream are typed on the ctx
const appId: string = kernel.ctx["qq-env"].QQ_BOT_APP_ID;
const messages: QqMessageStream = kernel.ctx.qq;
void appId;
void messages;

// internal wiring is hidden from the final ctx
// @ts-expect-error the api was bound, not used
void kernel.ctx["qq/api"];
// @ts-expect-error the transport was bound, not used
void kernel.ctx["qq/transport"];
// @ts-expect-error the output was bound, not used
void kernel.ctx["qq/output"];

// the api's env input cannot be identity-wired: no "env" namespace
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    // @ts-expect-error mapping is required when the declared input is absent
    .bind(qq.api, { option: {} });

// ...and its config is required even with a mapping
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    // @ts-expect-error option is required (pass `{}` for defaults)
    .bind(qq.api, { mapping: (ctx) => ({ env: ctx["qq-env"] }) });

// mappings are checked against the visible-and-hidden ctx: the transport
// cannot see the api before it is composed
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .bind(qq.transport, {
        // @ts-expect-error "qq/api" is not composed yet
        mapping: (ctx) => ({ api: ctx["qq/api"] }),
    });

// the input config is required (pass `{}` for defaults)
void createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .bind(qq.api, { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) })
    .bind(qq.transport, { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
    // @ts-expect-error option is required (pass `{}` for defaults)
    .use(qq.input, {
        mapping: (ctx) => ({ connection: ctx["qq/transport"], api: ctx["qq/api"] }),
    });
