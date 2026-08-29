import type { BotEvent } from "@lambdot/core";
import { createKernel, definePlugin } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { startEchoServer } from "./server.ts";
import { echoSpec, type EchoEvents, type EchoOutputs, type WsEchoAddress } from "./specs.ts";

type Events = EchoEvents<"a"> & EchoEvents<"b">;
type Outputs = EchoOutputs<"a"> & EchoOutputs<"b">;

/**
 * One reply behavior, two websocket instances. Each instance ingests its own
 * event kind, so both subscriptions receive only their own socket's traffic.
 * The envelope's `address.platform` routes each reply back out the socket it
 * arrived on — `ContentFor` distributes over the address union, so the same
 * handler type-checks for both platforms (both accept `string`).
 */
const reply = definePlugin<Events, Outputs>({
    name: "reply",
    apply(ctx) {
        function onMessage(
            event: BotEvent<string, string, WsEchoAddress<"a"> | WsEchoAddress<"b">>,
        ) {
            // Every ingested event carries a unique id (crypto.randomUUID)
            // and its own return address — dispatch never mixes the sockets.
            console.log(
                `[${event.address.platform}] id=${event.id} kind=${event.kind} payload=${event.payload}`,
            );
            return ctx.send(event.address, `echo(${event.address.platform}): ${event.payload}`);
        }

        return [ctx.on("wsecho-a.message", onMessage), ctx.on("wsecho-b.message", onMessage)];
    },
});

const serverA = await startEchoServer(8080);
const serverB = await startEchoServer(8081);
const urlA = `ws://127.0.0.1:${serverA.port}`;
const urlB = `ws://127.0.0.1:${serverB.port}`;

// Distinct capability names fold side by side; each platform's input/output
// injects its own transport's connection.
const wsechoA = wsPlatform("ws-a", echoSpec("a"));
const wsechoB = wsPlatform("ws-b", echoSpec("b"));

const kernel = createKernel()
    .use(wsechoA.transport, { url: urlA })
    .use(wsechoA.input)
    .use(wsechoA.output)
    .use(wsechoB.transport, { url: urlB })
    .use(wsechoB.input)
    .use(wsechoB.output)
    .use(reply);

await kernel.start();

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

await kernel.stop();
await serverA.close();
await serverB.close();

if (receivedA !== "echo(wsecho-a): hello from driver A") {
    console.error(`dual-websocket-bot: FAIL — unexpected reply on A "${receivedA}"`);
    process.exit(1);
}
if (receivedB !== "echo(wsecho-b): hello from driver B") {
    console.error(`dual-websocket-bot: FAIL — unexpected reply on B "${receivedB}"`);
    process.exit(1);
}
console.log("dual-websocket-bot: OK");
