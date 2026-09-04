import assert from "node:assert/strict";
import test from "node:test";

import { createQqApi } from "./api.ts";

interface RecordedRequest {
    url: string;
    method: string;
    body: string | undefined;
    authorization: string | null;
}

/** Stub globalThis.fetch for the duration of `run`. */
async function withFetch(
    handler: (request: RecordedRequest) => Response,
    run: (recorded: RecordedRequest[]) => Promise<void>,
): Promise<void> {
    const recorded: RecordedRequest[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        recorded.push({
            url,
            method: init?.method ?? "GET",
            body: typeof init?.body === "string" ? init.body : undefined,
            authorization: new Headers(init?.headers).get("authorization"),
        });
        return handler(recorded[recorded.length - 1] as RecordedRequest);
    }) as typeof fetch;
    try {
        await run(recorded);
    } finally {
        globalThis.fetch = original;
    }
}

const tokenResponse = () => Response.json({ access_token: "token-1", expires_in: "7200" });

void test("qq api caches the access token and authorizes requests", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({ url: "wss://gateway.example" });
        },
        async (recorded) => {
            const api = createQqApi(
                { appId: "app", clientSecret: "secret" },
                { apiBase: "https://mock.test" },
            );
            assert.equal(api.appId, "app");
            await api.accessToken();
            await api.accessToken();
            const url = await api.gatewayUrl();
            assert.equal(url, "wss://gateway.example");

            const tokenCalls = recorded.filter((r) => r.url.endsWith("/app/getAppAccessToken"));
            assert.equal(tokenCalls.length, 1);
            assert.deepEqual(JSON.parse(tokenCalls[0]!.body!), {
                appId: "app",
                clientSecret: "secret",
            });
            const gateway = recorded.find((r) => r.url.endsWith("/gateway"));
            assert.equal(gateway!.authorization, "QQBot token-1");
        },
    );
});

void test("sendMessage routes by scope and auto-increments msg_seq per msgId", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({});
        },
        async (recorded) => {
            const api = createQqApi(
                { appId: "app", clientSecret: "secret" },
                { apiBase: "https://mock.test" },
            );
            await api.sendMessage({ scope: "group", openid: "g1", msgId: "m1" }, "first");
            await api.sendMessage({ scope: "group", openid: "g1", msgId: "m1" }, "second");
            await api.sendMessage({ scope: "c2c", openid: "u1" }, "active");

            const sends = recorded.filter((r) => r.url.includes("/messages"));
            assert.equal(sends[0]!.url, "https://mock.test/v2/groups/g1/messages");
            assert.deepEqual(JSON.parse(sends[0]!.body!), {
                msg_type: 0,
                content: "first",
                msg_id: "m1",
                msg_seq: 1,
            });
            assert.deepEqual(JSON.parse(sends[1]!.body!), {
                msg_type: 0,
                content: "second",
                msg_id: "m1",
                msg_seq: 2,
            });
            assert.equal(sends[2]!.url, "https://mock.test/v2/users/u1/messages");
            assert.deepEqual(JSON.parse(sends[2]!.body!), { msg_type: 0, content: "active" });
        },
    );
});

void test("sendMessage honors an explicit msgSeq", async () => {
    await withFetch(
        () => Response.json({ access_token: "t", expires_in: 7200 }),
        async (recorded) => {
            const api = createQqApi(
                { appId: "app", clientSecret: "secret" },
                { apiBase: "https://mock.test" },
            );
            await api.sendMessage({ scope: "c2c", openid: "u1", msgId: "m9", msgSeq: 41 }, "x");
            const send = recorded.find((r) => r.url.includes("/messages"));
            assert.deepEqual(JSON.parse(send!.body!), {
                msg_type: 0,
                content: "x",
                msg_id: "m9",
                msg_seq: 41,
            });
        },
    );
});
