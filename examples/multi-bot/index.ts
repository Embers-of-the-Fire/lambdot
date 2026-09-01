import { createScope, definePlugin } from "@lambdot/core";

import { type BridgePort, createEchoBot, type EchoBotSurface } from "./bot.ts";
import { startEchoServer } from "./server.ts";

const serverA = await startEchoServer(8080);
const serverB = await startEchoServer(8081);

/**
 * The supervisor's cross-bot policy, expressed as an ordinary plugin:
 * forward "@all " traffic from one bot's surface into the other's bridge
 * port. Its declared input is the narrow contract; the wiring mapping is
 * typed against the nested item maps — no casts, and anything the bots
 * don't expose is unnameable.
 */
const bridgeAll = definePlugin({
    name: "bridge/all",
    apply(input: { source: EchoBotSurface; target: BridgePort }, scope) {
        scope.onDispose(
            input.source.listen((text) => {
                if (text.startsWith("@all ")) {
                    input.target.push(text.slice("@all ".length));
                }
            }),
        );
    },
});

// The supervisor is itself a plugin. Each bot is a hermetic (`with`)
// dependency: granted a blank context, it shares nothing with its sibling —
// isolation falls out of composition. The bridge reads both nested item
// maps through its mapping.
const supervisor = definePlugin({ name: "supervisor", apply: () => ({}) })
    .with(createEchoBot("botA", `ws://127.0.0.1:${serverA.port}`))
    .with(createEchoBot("botB", `ws://127.0.0.1:${serverB.port}`))
    .use(bridgeAll, {
        mapping: (ctx) => ({ source: ctx.botA, target: ctx.botB.bridge }),
    });

const scope = createScope({ onError: (error) => console.error("[supervisor]", error) });
await supervisor.apply({}, scope, undefined);

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
await scope.dispose();
await serverA.close();
await serverB.close();

const expectedA = ["echo: hello from A", "echo: @all hello everyone"];
const expectedB = ["echo: hello everyone"];
if (
    driverA.messages.join("|") !== expectedA.join("|") ||
    driverB.messages.join("|") !== expectedB.join("|")
) {
    console.error(
        `multi-bot: FAIL — A got ${JSON.stringify(driverA.messages)}, B got ${JSON.stringify(driverB.messages)}`,
    );
    process.exit(1);
}
console.log("multi-bot: OK — nested compositions, explicit bridge");
