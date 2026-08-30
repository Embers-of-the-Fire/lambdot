import type { Message, Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec, type WsEchoAddress } from "./echo-spec.ts";
import { startEchoServer } from "./server.ts";

const reply = definePlugin({
    name: "reply",
    apply(input: { wsecho: Stream<Message<string, WsEchoAddress>> }) {
        return mapStream(input.wsecho, (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

const server = await startEchoServer(8080);
const url = `ws://127.0.0.1:${server.port}`;

const wsecho = wsPlatform("wsecho", echoSpec);

const kernel = createKernel()
    .bind(wsecho.transport, { option: { url } })
    .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
    // identity wiring: reply's input keys already match the visible ctx
    .use(reply)
    .bind(wsecho.output, {
        mapping: (ctx) => ({ connection: ctx["wsecho/transport"], commands: ctx.reply }),
    });

await kernel.start();

// Drive the bot with a raw client and verify the full round trip:
// driver → server → transport → input → reply feature → output → driver.
const driver = new WebSocket(url);
await new Promise<void>((resolve, reject) => {
    driver.addEventListener("open", () => resolve(), { once: true });
    driver.addEventListener("error", () => reject(new Error("driver failed to connect")), {
        once: true,
    });
});

const echoed = new Promise<string>((resolve) => {
    driver.addEventListener("message", (event) => {
        if (typeof event.data === "string" && event.data.startsWith("echo:")) {
            resolve(event.data);
        }
    });
});
const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timed out waiting for echo")), 5000);
});

driver.send("hello from driver");
const received = await Promise.race([echoed, timeout]);
console.log(`driver received: ${received}`);

driver.close();
await kernel.stop();
await server.close();

if (received !== "echo: hello from driver") {
    console.error(`websocket-bot: FAIL — unexpected reply "${received}"`);
    process.exit(1);
}
console.log("websocket-bot: OK");
