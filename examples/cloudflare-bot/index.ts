import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { Miniflare } from "miniflare";

import type { PingReply } from "./worker.ts";

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
});
const script = bundled.outputFiles[0]?.text;
if (!script) throw new Error("esbuild produced no output");

// Miniflare stands in for Cloudflare's infra: the worker runs in a real
// workerd isolate with an emulated named KV namespace.
const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2025-04-01",
    kvNamespaces: ["PINGS"],
});

async function ping(message: string): Promise<PingReply> {
    const res = await mf.dispatchFetch("http://localhost/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
    });
    if (res.status !== 200) throw new Error(`ping failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as PingReply;
}

try {
    const first = await ping("hello");
    if (first.reply !== "pong: hello" || first.count !== 1)
        throw new Error(`unexpected first reply: ${JSON.stringify(first)}`);
    console.log(`first ping:  ${JSON.stringify(first)}`);

    // A second request reuses the isolate's kernel; the count survives in KV.
    const second = await ping("again");
    if (second.reply !== "pong: again" || second.count !== 2)
        throw new Error(`unexpected second reply: ${JSON.stringify(second)}`);
    console.log(`second ping: ${JSON.stringify(second)}`);

    console.log("cloudflare-bot: OK");
} catch (error) {
    console.error("cloudflare-bot: FAIL", error);
    process.exitCode = 1;
} finally {
    await mf.dispose();
}
