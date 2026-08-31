import type { Stream } from "@lambdot/core";
import { createKernel, definePlugin, pumpStream } from "@lambdot/core";

import { type BridgePort, createEchoBot, type WsEchoMessage } from "./bot.ts";
import { startEchoServer } from "./server.ts";

const serverA = await startEchoServer(8080);
const serverB = await startEchoServer(8081);

/**
 * The supervisor's cross-kernel policy, expressed as an ordinary plugin:
 * forward "@all " traffic from one bot's message stream into the other's
 * bridge port. Its declared input is the narrow contract; the wiring
 * mapping is typed against the engines' exposed surfaces — no casts, no
 * string rewriting, and anything the engines don't expose is unnameable.
 */
const bridgeAll = definePlugin({
    name: "bridge/all",
    apply(input: { source: Stream<WsEchoMessage>; target: BridgePort }, scope) {
        scope.onDispose(
            pumpStream(
                input.source,
                (event) => {
                    if (event.payload.startsWith("@all ")) {
                        input.target.push(event.payload.slice("@all ".length));
                    }
                },
                (error) => scope.onError(error),
            ),
        );
    },
});

// The supervisor is itself a kernel. Each bot is an engine nested under
// its exposed name; the bridge is bound (it emits no namespace). Startup
// and teardown order fall out of composition order: engines activate
// first, the bridge pump last — and on stop the pump detaches before the
// engines tear down.
const supervisor = createKernel()
    .use(createEchoBot("botA", `ws://127.0.0.1:${serverA.port}`))
    .use(createEchoBot("botB", `ws://127.0.0.1:${serverB.port}`))
    .bind(bridgeAll, {
        mapping: (ctx) => ({ source: ctx.botA.wsecho, target: ctx.botB.bridge }),
    });

await supervisor.start();

// Drive both bots and record every frame each driver receives.
function drive(url: string) {
    const messages: string[] = [];
    const driver = new WebSocket(url);
    const opened = new Promise<void>((resolve, reject) => {
        driver.addEventListener("open", () => resolve(), { once: true });
        driver.addEventListener("error", () => reject(new Error("driver failed to connect")), {
            once: true,
        });
    });
    driver.addEventListener("message", (event) => {
        if (typeof event.data === "string") messages.push(event.data);
    });
    return {
        messages,
        async send(text: string) {
            await opened;
            driver.send(text);
        },
        close: () => driver.close(),
    };
}

async function waitFor(messages: string[], expected: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!messages.includes(expected)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for "${expected}"`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const driverA = drive(`ws://127.0.0.1:${serverA.port}`);
const driverB = drive(`ws://127.0.0.1:${serverB.port}`);

// 1. Ordinary traffic stays inside its own composition.
await driverA.send("hello from A");
await waitFor(driverA.messages, "echo: hello from A");

// 2. The bridge forwards "@all" traffic from A into B.
await driverA.send("@all hello everyone");
await waitFor(driverA.messages, "echo: @all hello everyone");
await waitFor(driverB.messages, "echo: hello everyone");

// Give any erroneous cross-composition leak a chance to arrive, then assert.
await new Promise((resolve) => setTimeout(resolve, 200));

driverA.close();
driverB.close();
await supervisor.stop();
await serverA.close();
await serverB.close();

const expectedA = ["echo: hello from A", "echo: @all hello everyone"];
const expectedB = ["echo: hello everyone"];
if (
    driverA.messages.join("|") !== expectedA.join("|") ||
    driverB.messages.join("|") !== expectedB.join("|")
) {
    console.error(
        `multi-kernel-bot: FAIL — A got ${JSON.stringify(driverA.messages)}, B got ${JSON.stringify(driverB.messages)}`,
    );
    process.exit(1);
}
console.log("multi-kernel-bot: OK — isolated dispatch, typed engine bridge");
