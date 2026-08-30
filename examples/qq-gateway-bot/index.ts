import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqGatewayPlatform, type QqMessageStream } from "@lambdot/protocol-qq";

import { startFakeQqPlatform } from "./platform.ts";

// The credentials are fakes for the fake platform; a real deployment sets
// them in the environment.
process.env.QQ_BOT_APP_ID ??= "102000001";
process.env.QQ_BOT_APP_SECRET ??= "fake-bot-secret";

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

const platform = await startFakeQqPlatform();

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .bind(qq.api, {
        option: { apiBase: platform.apiBase },
        mapping: (ctx) => ({ env: ctx["qq-env"] }),
    })
    .bind(qq.transport, { mapping: (ctx) => ({ api: ctx["qq/api"] }) })
    .use(qq.input, {
        option: {},
        mapping: (ctx) => ({ connection: ctx["qq/transport"], api: ctx["qq/api"] }),
    })
    // the mapping is the platform adapter: reply wants "messages", qq emits "qq"
    .use(reply, { mapping: (ctx) => ({ messages: ctx.qq }) })
    .bind(qq.output, { mapping: (ctx) => ({ api: ctx["qq/api"], commands: ctx.reply }) });

await kernel.start();
// The bot identifies only after the platform's hello; wait for READY.
await platform.identified;

// Drive the bot with a fake dispatch and verify the full round trip:
// platform → gateway socket → input → reply feature → output → REST mock.
const echoed = platform.waitForMessage((message) => message.content.startsWith("echo:"));
const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timed out waiting for echo")), 5000);
});

platform.pushGroupMessage("hello from qq");
const received = await Promise.race([echoed, timeout]);
console.log(`platform recorded: ${JSON.stringify(received)}`);

await kernel.stop();
await platform.close();

if (received.content !== "echo: hello from qq" || received.msgId !== "ROBOT1.0_inbound_2") {
    console.error("qq-gateway-bot: FAIL — unexpected reply");
    process.exit(1);
}
console.log("qq-gateway-bot: OK");
