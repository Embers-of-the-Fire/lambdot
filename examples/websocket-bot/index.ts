import { createScope, definePlugin } from "@lambdot/core";
import { wsConnection, type WsConnection } from "@lambdot/websocket";

import { startEchoServer } from "./server.ts";

const echo = definePlugin({
    name: "echo",
    apply(input: { socket: WsConnection }, scope) {
        scope.onDispose(input.socket.listen((data) => input.socket.push(`echo: ${data}`)));
    },
});

const server = await startEchoServer(8080);
const url = `ws://127.0.0.1:${server.port}`;

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(wsConnection("socket"), { option: { url } })
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo);

const scope = createScope();
await app.apply({}, scope, undefined);

// Drive the bot with a raw client and verify the full round trip:
// driver → server → connection → echo feature → driver.
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
await scope.dispose();
await server.close();

if (received !== "echo: hello from driver") {
    console.error(`websocket-bot: FAIL — unexpected reply "${received}"`);
    process.exit(1);
}
console.log("websocket-bot: OK");
