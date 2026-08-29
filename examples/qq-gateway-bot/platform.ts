import { createServer, type Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

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
    /** Resolves once the bot has identified over the gateway socket. */
    readonly identified: Promise<void>;
    /** Dispatch a `GROUP_AT_MESSAGE_CREATE` event to the connected bot. */
    pushGroupMessage(content: string): void;
    /** Resolve with the next recorded message matching `predicate`. */
    waitForMessage(predicate: (message: RecordedMessage) => boolean): Promise<RecordedMessage>;
    close(): Promise<void>;
}

const TOKEN = "fake-access-token";

/**
 * A fake QQ open platform standing in for the real infra: the token endpoint
 * (`POST /app/getAppAccessToken`), the gateway discovery endpoint
 * (`GET /gateway`), the send-message endpoints, and a websocket gateway that
 * speaks the basic op-code flow (hello → identify → READY, heartbeat ack,
 * dispatch).
 */
export async function startFakeQqPlatform(): Promise<FakeQqPlatform> {
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

    let gatewayUrl = "";
    const http: Server = createServer((req, res) => {
        const json = (status: number, body: unknown): void => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        const authed = req.headers.authorization === `QQBot ${TOKEN}`;

        if (req.method === "POST" && req.url === "/app/getAppAccessToken") {
            void readBody(req).then((body) => {
                if (typeof body.appId !== "string" || typeof body.clientSecret !== "string")
                    return json(400, { error: "missing appId/clientSecret" });
                json(200, { access_token: TOKEN, expires_in: "7200" });
            });
            return;
        }
        if (req.method === "GET" && req.url === "/gateway") {
            if (!authed) return json(401, { error: "bad token" });
            return json(200, { url: gatewayUrl });
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

    let botSocket: WebSocket | undefined;
    let seq = 0;
    let resolveIdentified!: () => void;
    const identified = new Promise<void>((resolve) => {
        resolveIdentified = resolve;
    });

    const wss = new WebSocketServer({ server: http, path: "/websocket" });
    wss.on("connection", (socket) => {
        botSocket = socket;
        socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 45_000 } }));
        socket.on("message", (data) => {
            const text = Array.isArray(data)
                ? Buffer.concat(data).toString()
                : data instanceof ArrayBuffer
                  ? Buffer.from(data).toString()
                  : data.toString();
            const frame = JSON.parse(text) as {
                op?: number;
                d?: { token?: unknown };
            };
            if (frame.op === 2) {
                if (frame.d?.token !== `QQBot ${TOKEN}`) {
                    socket.close(4002, "invalid payload");
                    return;
                }
                seq += 1;
                socket.send(
                    JSON.stringify({
                        op: 0,
                        s: seq,
                        t: "READY",
                        d: {
                            version: 1,
                            session_id: "fake-session",
                            user: { id: "fake-bot", username: "fakebot", bot: true },
                            shard: [0, 1],
                        },
                    }),
                );
                resolveIdentified();
            } else if (frame.op === 1) {
                socket.send(JSON.stringify({ op: 11 }));
            }
        });
        socket.on("close", () => {
            if (botSocket === socket) botSocket = undefined;
        });
    });

    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    gatewayUrl = `ws://127.0.0.1:${port}/websocket`;

    return {
        apiBase: `http://127.0.0.1:${port}`,
        identified,
        pushGroupMessage(content) {
            seq += 1;
            botSocket?.send(
                JSON.stringify({
                    op: 0,
                    s: seq,
                    t: "GROUP_AT_MESSAGE_CREATE",
                    d: {
                        id: `ROBOT1.0_inbound_${seq}`,
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
                }),
            );
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
                for (const client of wss.clients) client.terminate();
                wss.close();
                http.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}
