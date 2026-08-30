import type { Command, Message, Stream } from "@lambdot/core";
import { createKernel, definePlugin, filterStream, mapStream, mergeStreams } from "@lambdot/core";
import { wsPlatform } from "@lambdot/websocket";

import { startEchoServer } from "./server.ts";
import { echoSpec, type WsEchoAddress } from "./specs.ts";

type AddressA = WsEchoAddress<"a">;
type AddressB = WsEchoAddress<"b">;

/**
 * One reply behavior, two websocket instances. Each instance's message
 * stream is a separate namespace, merged into one command stream; each
 * output then filters the commands back down to its own platform tag —
 * `address.platform` routes each reply out the socket it arrived on.
 */
const reply = definePlugin({
    name: "reply",
    apply(input: {
        "wsecho-a": Stream<Message<string, AddressA>>;
        "wsecho-b": Stream<Message<string, AddressB>>;
    }) {
        function echo(event: Message<string, AddressA | AddressB>) {
            console.log(`[${event.address.platform}] id=${event.id} payload=${event.payload}`);
            return {
                address: event.address,
                content: `echo(${event.address.platform}): ${event.payload}`,
            };
        }

        return mergeStreams(mapStream(input["wsecho-a"], echo), mapStream(input["wsecho-b"], echo));
    },
});

const serverA = await startEchoServer(8080);
const serverB = await startEchoServer(8081);
const urlA = `ws://127.0.0.1:${serverA.port}`;
const urlB = `ws://127.0.0.1:${serverB.port}`;

// Distinct platform names fold side by side; each platform's input/output
// wires its own transport's connection.
const wsechoA = wsPlatform("wsecho-a", echoSpec("a"));
const wsechoB = wsPlatform("wsecho-b", echoSpec("b"));

const kernel = createKernel()
    .bind(wsechoA.transport, { option: { url: urlA } })
    .use(wsechoA.input, { mapping: (ctx) => ({ connection: ctx["wsecho-a/transport"] }) })
    .bind(wsechoB.transport, { option: { url: urlB } })
    .use(wsechoB.input, { mapping: (ctx) => ({ connection: ctx["wsecho-b/transport"] }) })
    .use(reply)
    .bind(wsechoA.output, {
        mapping: (ctx) => ({
            connection: ctx["wsecho-a/transport"],
            commands: filterStream(
                ctx.reply,
                (cmd): cmd is Command<AddressA, string> => cmd.address.platform === "wsecho-a",
            ),
        }),
    })
    .bind(wsechoB.output, {
        mapping: (ctx) => ({
            connection: ctx["wsecho-b/transport"],
            commands: filterStream(
                ctx.reply,
                (cmd): cmd is Command<AddressB, string> => cmd.address.platform === "wsecho-b",
            ),
        }),
    });

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
