import { createKernel } from "@lambdot/core";
import { consoleInput } from "@lambdot/input-console";
import { consoleOutput } from "@lambdot/output-console";

import { echoSpec } from "./echo-spec.ts";
import { echo } from "./echo.ts";
import { startEchoServer } from "./server.ts";
import { wsInput, wsOutput, wsTransport } from "./transport.ts";

const server = await startEchoServer(8080);
const url = `ws://127.0.0.1:${server.port}`;

// One kernel, two platforms: console (stdin/stdout) and websocket. The
// shared `echo` feature must come last — the type fold requires every event
// kind it handles and every output platform it sends through to be
// registered first.
const kernel = createKernel()
    .use(consoleInput())
    .use(consoleOutput())
    .use(wsTransport(), { url })
    .use(wsInput(echoSpec))
    .use(wsOutput(echoSpec))
    .use(echo);

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

// The console leg is interactive; the kernel keeps serving both platforms
// until interrupted.
process.on("SIGINT", () => {
    void kernel
        .stop()
        .then(() => server.close())
        .then(() => process.exit(0));
});
