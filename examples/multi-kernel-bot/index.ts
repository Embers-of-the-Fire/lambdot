import { createEchoBot } from "./bot.ts";
import { startEchoServer } from "./server.ts";

const serverA = await startEchoServer(8080);
const serverB = await startEchoServer(8081);

// The supervisor: owns every kernel, controls startup/teardown order, and
// is the only place cross-kernel wiring happens.
const botA = createEchoBot("A", `ws://127.0.0.1:${serverA.port}`);
const botB = createEchoBot("B", `ws://127.0.0.1:${serverB.port}`);

await Promise.all([botA.start(), botB.start()]);

// Composition is explicit: a listener on kernel A, a typed ingest handle on
// kernel B. Messages starting with "@all " cross the boundary; everything
// else stays inside its own kernel. Both ends are fully typed — no casts,
// no string rewriting, no core changes.
const unbridge = botA.ctx.on("wsecho.message", (event) => {
    if (event.payload.startsWith("@all ")) {
        return botB.ctx.bridge.ingest(event.payload.slice("@all ".length));
    }
});

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

// 1. Ordinary traffic stays inside its own kernel.
await driverA.send("hello from A");
await waitFor(driverA.messages, "echo: hello from A");

// 2. The supervisor bridge forwards "@all" traffic from A into B.
await driverA.send("@all hello everyone");
await waitFor(driverA.messages, "echo: @all hello everyone");
await waitFor(driverB.messages, "echo: hello everyone");

// Give any erroneous cross-kernel leak a chance to arrive, then assert.
await new Promise((resolve) => setTimeout(resolve, 200));

driverA.close();
driverB.close();
void unbridge();
await Promise.all([botA.stop(), botB.stop()]);
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
console.log("multi-kernel-bot: OK — isolated dispatch, explicit bridge");
