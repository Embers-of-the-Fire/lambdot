import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";
import { Hono } from "hono";
import nacl from "tweetnacl";

import type { QqMessageEvent } from "./webhook.ts";
import { qqWebhook } from "./webhook.ts";

/** The keypair the plugin derives from the bot secret: seed repeated to 32 bytes. */
function keyPairFor(secret: string): nacl.SignKeyPair {
    let seed = secret;
    while (seed.length < 32) seed += seed;
    return nacl.sign.keyPair.fromSeed(new TextEncoder().encode(seed.slice(0, 32)));
}

function sign(secret: string, message: string): string {
    return Array.from(
        nacl.sign.detached(new TextEncoder().encode(message), keyPairFor(secret).secretKey),
        (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
}

const ENV = { QQ_BOT_APP_ID: "app", QQ_BOT_APP_SECRET: "shhhhh" };

async function boot(config: { path?: string } = {}) {
    // A real hono app: the host server this package is written against.
    // Requests are dispatched in-memory through `hono.fetch`.
    const hono = new Hono();
    const scope = createScope();
    const webhook = await qqWebhook("qq").apply({ http: hono, env: ENV }, scope, config);
    const call = (request: Request): Promise<Response> => Promise.resolve(hono.fetch(request));
    return { webhook, call, scope };
}

void test("op 13 callback validation signs event_ts + plain_token", async () => {
    const { webhook, call } = await boot();
    assert.equal(typeof webhook.onMessage, "function");

    const response = await call(
        new Request("https://bot.test/qq/callback", {
            method: "POST",
            body: JSON.stringify({ op: 13, d: { plain_token: "token", event_ts: "1234" } }),
        }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { plain_token: string; signature: string };
    assert.equal(body.plain_token, "token");
    const valid = nacl.sign.detached.verify(
        new TextEncoder().encode("1234token"),
        Buffer.from(body.signature, "hex"),
        keyPairFor(ENV.QQ_BOT_APP_SECRET).publicKey,
    );
    assert.equal(valid, true);
});

void test("a forged signature is rejected with 401", async () => {
    const { call } = await boot();
    const body = JSON.stringify({ op: 0, t: "C2C_MESSAGE_CREATE", d: {} });
    const response = await call(
        new Request("https://bot.test/qq/callback", {
            method: "POST",
            headers: {
                "x-signature-ed25519": sign("forged-secret", `ts${body}`),
                "x-signature-timestamp": "ts",
            },
            body,
        }),
    );
    assert.equal(response.status, 401);
});

void test("a signed dispatch reaches onMessage, and reply posts a passive message", async () => {
    const { webhook, call, scope } = await boot();

    const events: QqMessageEvent[] = [];
    const unsubscribe = webhook.onMessage((event) => events.push(event));

    const dispatch = JSON.stringify({
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
            id: "msg-1",
            content: "hello",
            group_openid: "group-1",
            timestamp: "2026-09-01T00:00:00Z",
            author: { member_openid: "user-1" },
        },
    });
    const timestamp = "1756700000";
    const response = await call(
        new Request("https://bot.test/qq/callback", {
            method: "POST",
            headers: {
                "x-signature-ed25519": sign(ENV.QQ_BOT_APP_SECRET, timestamp + dispatch),
                "x-signature-timestamp": timestamp,
            },
            body: dispatch,
        }),
    );
    assert.equal(response.status, 200);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.message.content, "hello");

    // reply goes through the REST client against the configured apiBase…
    // the default apiBase is unreachable, so stub fetch for the reply.
    const original = globalThis.fetch;
    const posted: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/app/getAppAccessToken"))
            return Response.json({ access_token: "t", expires_in: 7200 });
        posted.push({
            url,
            body: JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
        });
        return Response.json({});
    }) as typeof fetch;
    try {
        await events[0]!.reply("echo: hello");
    } finally {
        globalThis.fetch = original;
    }
    assert.equal(posted.length, 1);
    assert.equal(posted[0]!.url, "https://api.bot.qq.com/v2/groups/group-1/messages");
    assert.deepEqual(posted[0]!.body, {
        msg_type: 0,
        content: "echo: hello",
        msg_id: "msg-1",
        msg_seq: 1,
    });

    void unsubscribe();
    await scope.dispose();
});

void test("a custom callback path is honored", async () => {
    const { call, scope } = await boot({ path: "/custom/hook" });
    const body = JSON.stringify({ op: 13, d: { plain_token: "token", event_ts: "1234" } });
    const custom = await call(
        new Request("https://bot.test/custom/hook", { method: "POST", body }),
    );
    assert.equal(custom.status, 200);
    const fallback = await call(
        new Request("https://bot.test/qq/callback", { method: "POST", body }),
    );
    assert.equal(fallback.status, 404);
    await scope.dispose();
});

void test("the listeners clear when the scope disposes", async () => {
    const { webhook, call, scope } = await boot();
    const events: QqMessageEvent[] = [];
    webhook.onMessage((event) => events.push(event));
    await scope.dispose();

    const dispatch = JSON.stringify({
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: {
            id: "msg-1",
            content: "hello",
            timestamp: "2026-09-01T00:00:00Z",
            author: { member_openid: "user-1" },
        },
    });
    const timestamp = "1756700000";
    const response = await call(
        new Request("https://bot.test/qq/callback", {
            method: "POST",
            headers: {
                "x-signature-ed25519": sign(ENV.QQ_BOT_APP_SECRET, timestamp + dispatch),
                "x-signature-timestamp": timestamp,
            },
            body: dispatch,
        }),
    );
    // the route lives as long as the host's server, but nothing listens
    assert.equal(response.status, 200);
    assert.equal(events.length, 0);
});

void test("malformed bodies and bad op-13 payloads are 400", async () => {
    const { call } = await boot();
    const bad = await call(
        new Request("https://bot.test/qq/callback", { method: "POST", body: "not json" }),
    );
    assert.equal(bad.status, 400);
    const badOp13 = await call(
        new Request("https://bot.test/qq/callback", {
            method: "POST",
            body: JSON.stringify({ op: 13, d: {} }),
        }),
    );
    assert.equal(badOp13.status, 400);
});
