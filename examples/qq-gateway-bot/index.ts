import { createKernel, definePlugin } from "@lambdot/core";
import { envVars } from "@lambdot/env";
import { qqGatewayPlatform, type QqEvents, type QqOutputs } from "@lambdot/protocol-qq";

import { startFakeQqPlatform } from "./platform.ts";

// The credentials are fakes for the fake platform; a real deployment sets
// them in the environment.
process.env.QQ_BOT_APP_ID ??= "102000001";
process.env.QQ_BOT_APP_SECRET ??= "fake-bot-secret";

const reply = definePlugin<QqEvents, QqOutputs>({
    name: "reply",
    apply(ctx) {
        return [
            ctx.on("qq.group-message", (event) =>
                ctx.send(event.address, `echo: ${event.payload.content}`),
            ),
            ctx.on("qq.c2c-message", (event) =>
                ctx.send(event.address, `echo: ${event.payload.content}`),
            ),
        ];
    },
});

const qq = qqGatewayPlatform({ ws: "qq-ws", api: "qq-api", env: "qq-env" });

const platform = await startFakeQqPlatform();

const kernel = createKernel()
    .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
    .use(qq.api, { apiBase: platform.apiBase })
    .use(qq.transport)
    .use(qq.input, {})
    .use(qq.output)
    .use(reply);

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
