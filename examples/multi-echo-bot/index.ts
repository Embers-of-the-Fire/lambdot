import type { ConsoleReply } from "@lambdot/console";
import { consolePlatform } from "@lambdot/console";
import type { Command } from "@lambdot/core";
import { createKernel, filterStream } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { echoSpec, type WsEchoAddress } from "./echo-spec.ts";
import { echo } from "./echo.ts";
import { startEchoServer } from "./server.ts";

const server = await startEchoServer(8080);
const url = `ws://127.0.0.1:${server.port}`;

const cli = consolePlatform();
const wsecho = wsPlatform("wsecho", echoSpec);

// One composition, two platforms: console (stdin/stdout) and websocket. The
// shared `echo` feature identity-wires (both message streams are visible
// namespaces); each output's mapping filters the merged command stream down
// to its own platform tag.
const kernel = createKernel()
    .use(cli.lines)
    .bind(wsecho.transport, { option: { url } })
    .use(wsecho.input, { mapping: (ctx) => ({ connection: ctx["wsecho/transport"] }) })
    .use(echo)
    .bind(cli.printer, {
        mapping: (ctx) => ({
            replies: filterStream(
                ctx.echo,
                (cmd): cmd is ConsoleReply => cmd.address.platform === "console",
            ),
        }),
    })
    .bind(wsecho.output, {
        mapping: (ctx) => ({
            connection: ctx["wsecho/transport"],
            commands: filterStream(
                ctx.echo,
                (cmd): cmd is Command<WsEchoAddress, string> => cmd.address.platform === "wsecho",
            ),
        }),
    });

await kernel.start();

// Verify the websocket leg end-to-end with a raw client (same round trip as
// the websocket-bot example): driver → server → transport → input → shared
// echo feature → output → driver.
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

if (received !== "echo: hello from driver") {
    console.error(`multi-echo-bot: FAIL — unexpected reply "${received}"`);
    await kernel.stop();
    await server.close();
    process.exit(1);
}
console.log("multi-echo-bot: websocket leg OK");
console.log("console echo is live — type a line and press enter (Ctrl+C to quit)");

// The console leg is interactive; the composition keeps serving both
// platforms until interrupted.
process.on("SIGINT", () => {
    void kernel
        .stop()
        .then(() => server.close())
        .then(() => process.exit(0));
});
