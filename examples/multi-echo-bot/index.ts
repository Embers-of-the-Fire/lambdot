import { consoleIo } from "@lambdot/console";
import { createScope, definePlugin } from "@lambdot/core";
import { wsConnection } from "@lambdot/websocket";

import { echo } from "./echo.ts";
import { startEchoServer } from "./server.ts";

const server = await startEchoServer(8080);
const url = `ws://127.0.0.1:${server.port}`;

// One composition, two services: console (stdin/stdout) and websocket. The
// shared `echo` feature identity-wires — both services are visible
// namespaces when it is composed.
const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    .with(wsConnection("socket"), { option: { url } })
    .use(echo);

const scope = createScope();
await app.apply({}, scope, undefined);

// Verify the websocket leg end-to-end with a raw client (same round trip as
// the websocket-bot example): driver → server → connection → echo feature →
// driver.
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
    await scope.dispose();
    await server.close();
    process.exit(1);
}
console.log("multi-echo-bot: websocket leg OK");
console.log("console echo is live — type a line and press enter (Ctrl+C to quit)");

// The console leg is interactive; the scope keeps both services' resources
// open until disposed.
process.on("SIGINT", () => {
    void scope
        .dispose()
        .then(() => server.close())
        .then(() => process.exit(0));
});
