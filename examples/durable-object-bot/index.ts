import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare } from "miniflare";

// The worker is TypeScript with workspace imports; workerd runs plain ESM,
// so bundle it first (this bundling is the example's only build step — the
// repo itself has none).
const bundled = await build({
    entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    // workerd's built-in module (the `DurableObject` base class) — resolved
    // by the runtime, not the bundler.
    external: ["cloudflare:workers"],
});
const script = bundled.outputFiles[0]?.text;
if (!script) throw new Error("esbuild produced no output");

// Miniflare stands in for Cloudflare's infra: the worker runs in a real
// workerd isolate with an emulated Durable Object namespace, and it listens
// on an ephemeral port so the driver can open real websockets against it.
const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2025-04-01",
    durableObjects: { ROOM: "ChatRoom" },
    port: 0,
});

const url = await mf.ready;
const wsBase = url.href.replace(/^http/, "ws");

/** A connected room client plus every frame it has received, in order. */
interface Client {
    readonly socket: WebSocket;
    readonly received: string[];
}

async function connect(room: string): Promise<Client> {
    const socket = new WebSocket(`${wsBase}room/${room}`);
    await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error(`failed to join room "${room}"`)), {
            once: true,
        });
    });
    const client: Client = { socket, received: [] };
    socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") client.received.push(event.data);
    });
    return client;
}

async function waitForMessages(client: Client, count: number, label: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while (client.received.length < count) {
        if (Date.now() > deadline)
            throw new Error(
                `${label}: timed out waiting for ${count} messages, got ${JSON.stringify(client.received)}`,
            );
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function assertMessages(client: Client, expected: readonly string[], label: string) {
    const actual = client.received;
    if (actual.length !== expected.length || actual.some((frame, i) => frame !== expected[i]))
        throw new Error(
            `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
        );
}

const sockets: WebSocket[] = [];
try {
    // Two clients in "lobby" (one Durable Object instance), one in "other"
    // (a second instance).
    const a = await connect("lobby");
    const b = await connect("lobby");
    const c = await connect("other");
    sockets.push(a.socket, b.socket, c.socket);

    // One frame from A is broadcast by the room's hub to every socket in it.
    a.socket.send("hello");
    await waitForMessages(a, 1, "a");
    await waitForMessages(b, 1, "b");
    assertMessages(a, ["echo (#1): hello"], "a");
    assertMessages(b, ["echo (#1): hello"], "b");
    console.log(`lobby broadcast: ${JSON.stringify("echo (#1): hello")} reached both clients`);

    // The counter lives in the instance's storage, shared by both clients.
    b.socket.send("again");
    await waitForMessages(a, 2, "a");
    await waitForMessages(b, 2, "b");
    assertMessages(a, ["echo (#1): hello", "echo (#2): again"], "a");
    assertMessages(b, ["echo (#1): hello", "echo (#2): again"], "b");
    console.log(`lobby counter:   ${JSON.stringify("echo (#2): again")}`);

    // A different room name is a different instance: no frames leak across,
    // and its counter starts from zero.
    assertMessages(c, [], "c (untouched by lobby traffic)");
    c.socket.send("hi");
    await waitForMessages(c, 1, "c");
    assertMessages(c, ["echo (#1): hi"], "c");
    assertMessages(a, ["echo (#1): hello", "echo (#2): again"], "a (unchanged)");
    console.log(`other room:      ${JSON.stringify("echo (#1): hi")} (isolated counter)`);

    console.log("durable-object-bot: OK");
} catch (error) {
    console.error("durable-object-bot: FAIL", error);
    process.exitCode = 1;
} finally {
    for (const socket of sockets) socket.close();
    await mf.dispose();
}
