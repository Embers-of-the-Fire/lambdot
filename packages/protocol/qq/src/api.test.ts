import assert from "node:assert/strict";
import test from "node:test";

import { createQqApi, type QqFileUpload, type QqMessageContext } from "./api.ts";

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
const okApi = () =>
    createQqApi({ appId: "app", clientSecret: "secret" }, { apiBase: "https://mock.test" });

void test("qq api caches the access token and authorizes requests", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({ url: "wss://gateway.example" });
        },
        async (recorded) => {
            const api = okApi();
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

void test("sends route by scene and resolve the caller-provided context", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({ id: "sent-1", timestamp: "2026-09-01T00:00:00+08:00" });
        },
        async (recorded) => {
            const api = okApi();
            const passive = await api.sendGroupMessage(
                "g1",
                { msgType: 0, content: "reply" },
                { msgId: "m1", msgSeq: 2 },
            );
            assert.deepEqual(passive, { id: "sent-1", timestamp: "2026-09-01T00:00:00+08:00" });
            await api.sendC2cMessage(
                "u1",
                { msgType: 0, content: "by event" },
                {
                    eventId: "e1",
                },
            );
            await api.sendC2cMessage("u1", { msgType: 0, content: "wakeup" }, { wakeup: true });
            await api.sendGroupMessage("g1", { msgType: 0, content: "active" });

            const sends = recorded.filter((r) => r.url.includes("/messages"));
            assert.equal(sends[0]!.url, "https://mock.test/v2/groups/g1/messages");
            assert.deepEqual(JSON.parse(sends[0]!.body!), {
                msg_type: 0,
                content: "reply",
                msg_id: "m1",
                msg_seq: 2,
            });
            assert.equal(sends[1]!.url, "https://mock.test/v2/users/u1/messages");
            assert.deepEqual(JSON.parse(sends[1]!.body!), {
                msg_type: 0,
                content: "by event",
                event_id: "e1",
            });
            assert.deepEqual(JSON.parse(sends[2]!.body!), {
                msg_type: 0,
                content: "wakeup",
                is_wakeup: true,
            });
            assert.deepEqual(JSON.parse(sends[3]!.body!), { msg_type: 0, content: "active" });
        },
    );
});

void test("sends encode markdown, media, input_notify, keyboards, and references", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({
                id: "sent-1",
                timestamp: "t",
                ext_info: { ref_idx: "REFIDX_x==" },
            });
        },
        async (recorded) => {
            const api = okApi();
            const sent = await api.sendC2cMessage("u1", {
                msgType: 2,
                markdown: { content: "# hi", forceVerifyImageResource: true },
                keyboard: {
                    content: {
                        rows: [
                            {
                                buttons: [
                                    {
                                        id: "b1",
                                        renderData: { label: "go", style: 1 },
                                        action: {
                                            type: 2,
                                            data: "/go",
                                            enter: true,
                                            permission: { type: 2 },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                reference: "REFIDX_0==",
            });
            assert.equal(sent.refIdx, "REFIDX_x==");
            await api.sendGroupMessage(
                "g1",
                { msgType: 7, fileInfo: "file-info-1", content: "look" },
                { msgId: "m1" },
            );
            await api.sendC2cMessage("u1", { msgType: 6, inputSeconds: 30 }, { msgId: "m2" });

            const sends = recorded.filter((r) => r.url.includes("/messages"));
            assert.deepEqual(JSON.parse(sends[0]!.body!), {
                msg_type: 2,
                markdown: { content: "# hi", force_verify_image_resource: true },
                keyboard: {
                    content: {
                        rows: [
                            {
                                buttons: [
                                    {
                                        id: "b1",
                                        render_data: { label: "go", style: 1 },
                                        action: {
                                            type: 2,
                                            data: "/go",
                                            enter: true,
                                            permission: { type: 2 },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                message_reference: { message_id: "REFIDX_0==" },
            });
            assert.deepEqual(JSON.parse(sends[1]!.body!), {
                msg_type: 7,
                media: { file_info: "file-info-1" },
                content: "look",
                msg_id: "m1",
            });
            assert.deepEqual(JSON.parse(sends[2]!.body!), {
                msg_type: 6,
                input_notify: { input_type: 1, input_second: 30 },
                msg_id: "m2",
            });
        },
    );
});

void test("sends reject a context with conflicting fields", async () => {
    await withFetch(
        () => tokenResponse(),
        async (recorded) => {
            const api = okApi();
            await assert.rejects(
                api.sendC2cMessage("u1", { msgType: 0, content: "hi" }, {
                    msgId: "m1",
                    eventId: "e1",
                } as unknown as QqMessageContext),
                /mutually exclusive/,
            );
            await assert.rejects(
                api.sendGroupMessage("g1", { msgType: 0, content: "hi" }, {
                    msgId: "m1",
                    wakeup: true,
                } as unknown as QqMessageContext),
                /mutually exclusive/,
            );
            assert.equal(recorded.filter((r) => r.url.includes("/messages")).length, 0);
        },
    );
});

void test("sends reject a context with no addressing mode", async () => {
    await withFetch(
        () => tokenResponse(),
        async (recorded) => {
            const api = okApi();
            await assert.rejects(
                api.sendC2cMessage("u1", { msgType: 0, content: "hi" }, {
                    // empty context: no msgId/eventId/wakeup
                } as unknown as QqMessageContext),
                /requires one of/,
            );
            await assert.rejects(
                api.sendGroupMessage("g1", { msgType: 0, content: "hi" }, {
                    msgSeq: 2,
                } as unknown as QqMessageContext),
                /msgSeq requires msgId/,
            );
            assert.equal(recorded.filter((r) => r.url.includes("/messages")).length, 0);
        },
    );
});

void test("group sends reject msg_type 6 (input_notify is c2c-only)", async () => {
    await withFetch(
        () => tokenResponse(),
        async () => {
            const api = okApi();
            await assert.rejects(
                api.sendGroupMessage("g1", { msgType: 6, inputSeconds: 10 }),
                /input_notify/,
            );
        },
    );
});

void test("recalls delete the message in the matching scene", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({});
        },
        async (recorded) => {
            const api = okApi();
            await api.recallC2cMessage("u1", "m1");
            await api.recallGroupMessage("g1", "m2");

            const recalls = recorded.filter((r) => r.method === "DELETE");
            assert.equal(recalls[0]!.url, "https://mock.test/v2/users/u1/messages/m1");
            assert.equal(recalls[1]!.url, "https://mock.test/v2/groups/g1/messages/m2");
            assert.equal(recalls[0]!.authorization, "QQBot token-1");
        },
    );
});

void test("uploads post the file and return its file_info", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({ file_uuid: "uuid-1", file_info: "info-1", ttl: 300 });
        },
        async (recorded) => {
            const api = okApi();
            const uploaded = await api.uploadC2cFile("u1", {
                fileType: 1,
                url: "https://example.com/a.png",
                srvSendMsg: false,
            });
            assert.deepEqual(uploaded, { fileUuid: "uuid-1", fileInfo: "info-1", ttl: 300 });
            await api.uploadGroupFile("g1", { fileType: 4, uploadId: "task-1", fileName: "a.zip" });

            const uploads = recorded.filter((r) => r.url.includes("/files"));
            assert.equal(uploads[0]!.url, "https://mock.test/v2/users/u1/files");
            assert.deepEqual(JSON.parse(uploads[0]!.body!), {
                file_type: 1,
                url: "https://example.com/a.png",
                srv_send_msg: false,
            });
            assert.equal(uploads[1]!.url, "https://mock.test/v2/groups/g1/files");
            assert.deepEqual(JSON.parse(uploads[1]!.body!), {
                file_type: 4,
                upload_id: "task-1",
                file_name: "a.zip",
            });
        },
    );
});

void test("uploads reject a file with no source", async () => {
    await withFetch(
        () => tokenResponse(),
        async (recorded) => {
            const api = okApi();
            await assert.rejects(
                api.uploadC2cFile("u1", { fileType: 1 } as QqFileUpload),
                /requires a source/,
            );
            await assert.rejects(
                api.uploadGroupFile("g1", { fileType: 4 } as QqFileUpload),
                /requires a source/,
            );
            assert.equal(recorded.filter((r) => r.url.includes("/files")).length, 0);
        },
    );
});

void test("uploads reject a file with both sources", async () => {
    await withFetch(
        () => tokenResponse(),
        async (recorded) => {
            const api = okApi();
            await assert.rejects(
                api.uploadC2cFile("u1", {
                    fileType: 1,
                    url: "https://example.com/a.png",
                    uploadId: "task-1",
                } as QqFileUpload),
                /only one source/,
            );
            await assert.rejects(
                api.uploadGroupFile("g1", {
                    fileType: 4,
                    url: "https://example.com/a.zip",
                    uploadId: "task-2",
                } as QqFileUpload),
                /only one source/,
            );
            assert.equal(recorded.filter((r) => r.url.includes("/files")).length, 0);
        },
    );
});

void test("ackInteraction puts the result code", async () => {
    await withFetch(
        (request) => {
            if (request.url.endsWith("/app/getAppAccessToken")) return tokenResponse();
            return Response.json({});
        },
        async (recorded) => {
            const api = okApi();
            await api.ackInteraction("interaction-1");
            await api.ackInteraction("interaction-2", 3);

            const acks = recorded.filter((r) => r.url.includes("/interactions/"));
            assert.equal(acks[0]!.url, "https://mock.test/interactions/interaction-1");
            assert.equal(acks[0]!.method, "PUT");
            assert.deepEqual(JSON.parse(acks[0]!.body!), { code: 0 });
            assert.deepEqual(JSON.parse(acks[1]!.body!), { code: 3 });
        },
    );
});
