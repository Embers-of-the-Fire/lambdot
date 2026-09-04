import { createScope, definePlugin } from "@lambdot/core";
import { wsConnection, type WsConnection } from "@lambdot/websocket";

import { startEchoServer } from "./server.ts";

/**
 * One reply behavior, two websocket connections. Each connection is a
 * separate namespace; each listener's closure replies through the socket it
 * subscribed to — no tags, no routing at the wiring.
 */
const echo = definePlugin({
    name: "echo",
    apply(input: { "socket-a": WsConnection; "socket-b": WsConnection }, scope) {
        scope.onDispose(
            input["socket-a"].listen((data) => {
                console.log(`[a] ${data}`);
                input["socket-a"].push(`echo(a): ${data}`);
            }),
        );
        scope.onDispose(
            input["socket-b"].listen((data) => {
                console.log(`[b] ${data}`);
                input["socket-b"].push(`echo(b): ${data}`);
            }),
        );
    },
});

const serverA = await startEchoServer(8080);
const serverB = await startEchoServer(8081);
const urlA = `ws://127.0.0.1:${serverA.port}`;
const urlB = `ws://127.0.0.1:${serverB.port}`;

// Distinct names compose side by side; the feature reads both namespaces.
const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(wsConnection("socket-a"), { option: { url: urlA } })
    .with(wsConnection("socket-b"), { option: { url: urlB } })
    .use(echo);

const scope = createScope();
await app.apply({}, scope, undefined);

// Drive both instances concurrently and verify each reply arrives on the
// socket its request came from — no cross-dispatch.
async function drive(url: string, message: string): Promise<string> {
    const driver = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
        driver.addEventListener("open", () => resolve(), { once: true });
        driver.addEventListener("error", () => reject(new Error("driver failed to connect")), {
            once: true,
        });
    });
    const echoed = new Promise<string>((resolve) => {
        driver.addEventListener("message", (event) => {
            if (typeof event.data === "string" && event.data.startsWith("echo(")) {
                resolve(event.data);
            }
        });
    });
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`timed out waiting for echo from ${url}`)), 5000);
    });
    driver.send(message);
    try {
        return await Promise.race([echoed, timeout]);
    } finally {
        driver.close();
    }
}

const [receivedA, receivedB] = await Promise.all([
    drive(urlA, "hello from driver A"),
    drive(urlB, "hello from driver B"),
]);
console.log(`driver A received: ${receivedA}`);
console.log(`driver B received: ${receivedB}`);

await scope.dispose();
await serverA.close();
await serverB.close();

if (receivedA !== "echo(a): hello from driver A") {
    console.error(`dual-websocket-bot: FAIL — unexpected reply on A "${receivedA}"`);
    process.exit(1);
}
if (receivedB !== "echo(b): hello from driver B") {
    console.error(`dual-websocket-bot: FAIL — unexpected reply on B "${receivedB}"`);
    process.exit(1);
}
console.log("dual-websocket-bot: OK");
