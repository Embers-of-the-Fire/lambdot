import { createServer, type Server } from "node:http";

import nacl from "tweetnacl";

/** A message the bot sent to the platform, captured by the REST mock. */
export interface RecordedMessage {
    readonly scope: "group" | "c2c";
    readonly openid: string;
    readonly content: string;
    readonly msgId?: string;
    readonly msgSeq?: number;
}

export interface FakeQqPlatform {
    /** Base URL for the qq REST client config (`apiBase`). */
    readonly apiBase: string;
    /** Run the op-13 callback-address validation against the bot. */
    validateCallback(callbackUrl: string): Promise<boolean>;
    /** Post a signed `GROUP_AT_MESSAGE_CREATE` callback to the bot. */
    pushGroupMessage(
        callbackUrl: string,
        content: string,
    ): Promise<{ status: number; msgId: string }>;
    /** Post a callback with a deliberately wrong signature. */
    pushTamperedMessage(callbackUrl: string): Promise<number>;
    /** Resolve with the next recorded message matching `predicate`. */
    waitForMessage(predicate: (message: RecordedMessage) => boolean): Promise<RecordedMessage>;
    close(): Promise<void>;
}

const TOKEN = "fake-access-token";
const SECRET = "fake-bot-secret-fake-bot-se";

function keyPairFromSecret(secret: string): nacl.SignKeyPair {
    let seed = secret;
    while (seed.length < 32) seed += seed;
    return nacl.sign.keyPair.fromSeed(new TextEncoder().encode(seed.slice(0, 32)));
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A fake QQ open platform standing in for the real infra: the token endpoint
 * and the send-message endpoints, plus the callback side of the webhook
 * protocol — it signs reversed-post requests with the shared bot secret.
 */
export async function startFakeQqPlatform(): Promise<FakeQqPlatform> {
    const keyPair = keyPairFromSecret(SECRET);
    const recorded: RecordedMessage[] = [];
    const waiters: {
        predicate: (message: RecordedMessage) => boolean;
        resolve: (message: RecordedMessage) => void;
    }[] = [];
    const record = (message: RecordedMessage): void => {
        recorded.push(message);
        for (let i = waiters.length - 1; i >= 0; i--) {
            const waiter = waiters[i];
            if (waiter && waiter.predicate(message)) {
                waiters.splice(i, 1);
                waiter.resolve(message);
            }
        }
    };

    const readBody = async (req: NodeJS.ReadableStream): Promise<Record<string, unknown>> => {
        let text = "";
        for await (const chunk of req) text += String(chunk);
        return (JSON.parse(text) as Record<string, unknown>) ?? {};
    };

    const http: Server = createServer((req, res) => {
        const json = (status: number, body: unknown): void => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        const authed = req.headers.authorization === `QQBot ${TOKEN}`;

        if (req.method === "POST" && req.url === "/app/getAppAccessToken") {
            void readBody(req).then(() => json(200, { access_token: TOKEN, expires_in: "7200" }));
            return;
        }
        const send = /^\/v2\/(groups|users)\/([^/]+)\/messages$/.exec(req.url ?? "");
        if (req.method === "POST" && send) {
            if (!authed) return json(401, { error: "bad token" });
            void readBody(req).then((body) => {
                const message: RecordedMessage = {
                    scope: send[1] === "groups" ? "group" : "c2c",
                    openid: send[2] ?? "",
                    content: typeof body.content === "string" ? body.content : "",
                    ...(typeof body.msg_id === "string" ? { msgId: body.msg_id } : {}),
                    ...(typeof body.msg_seq === "number" ? { msgSeq: body.msg_seq } : {}),
                };
                record(message);
                json(200, {
                    id: `ROBOT1.0_reply_${recorded.length}`,
                    timestamp: new Date().toISOString(),
                });
            });
            return;
        }
        json(404, { error: "not found" });
    });

    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;

    const post = async (callbackUrl: string, frame: unknown, sign: boolean): Promise<Response> => {
        const body = JSON.stringify(frame);
        const timestamp = `${Math.floor(Date.now() / 1000)}`;
        const signed = sign ? timestamp + body : `${timestamp}tampered`;
        const signature = toHex(
            nacl.sign.detached(new TextEncoder().encode(signed), keyPair.secretKey),
        );
        return fetch(callbackUrl, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "user-agent": "QQBot-Callback",
                "x-signature-ed25519": signature,
                "x-signature-timestamp": timestamp,
            },
            body,
        });
    };

    return {
        apiBase: `http://127.0.0.1:${port}`,
        async validateCallback(callbackUrl) {
            const plainToken = "Arq0D5A61EgUu4OxUvOp";
            const eventTs = "1725442341";
            const res = await post(
                callbackUrl,
                {
                    op: 13,
                    d: { plain_token: plainToken, event_ts: eventTs },
                },
                true,
            );
            if (res.status !== 200) return false;
            const body = (await res.json()) as { plain_token?: unknown; signature?: unknown };
            if (body.plain_token !== plainToken || typeof body.signature !== "string") return false;
            const signature = new Uint8Array(
                (body.signature.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)),
            );
            return nacl.sign.detached.verify(
                new TextEncoder().encode(eventTs + plainToken),
                signature,
                keyPair.publicKey,
            );
        },
        async pushGroupMessage(callbackUrl, content) {
            const msgId = `ROBOT1.0_inbound_${recorded.length + 1}`;
            const res = await post(
                callbackUrl,
                {
                    op: 0,
                    t: "GROUP_AT_MESSAGE_CREATE",
                    d: {
                        id: msgId,
                        content: ` ${content} `,
                        group_openid: "GROUP_FAKE_OPENID",
                        timestamp: new Date().toISOString(),
                        message_type: 0,
                        author: {
                            id: "USER_FAKE_OPENID",
                            member_openid: "USER_FAKE_OPENID",
                            username: "tester",
                            bot: false,
                        },
                    },
                },
                true,
            );
            await res.arrayBuffer();
            return { status: res.status, msgId };
        },
        async pushTamperedMessage(callbackUrl) {
            const res = await post(
                callbackUrl,
                {
                    op: 0,
                    t: "GROUP_AT_MESSAGE_CREATE",
                    d: {
                        id: "ROBOT1.0_tampered",
                        content: "forged",
                        group_openid: "GROUP_FAKE_OPENID",
                        author: { member_openid: "USER_FAKE_OPENID" },
                    },
                },
                false,
            );
            await res.arrayBuffer();
            return res.status;
        },
        waitForMessage(predicate) {
            const hit = recorded.find(predicate);
            if (hit) return Promise.resolve(hit);
            return new Promise<RecordedMessage>((resolve) => {
                waiters.push({ predicate, resolve });
            });
        },
        close: () =>
            new Promise<void>((resolve, reject) => {
                http.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}
