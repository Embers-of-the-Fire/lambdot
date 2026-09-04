import type { Disposer, Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";
import type { HttpServer } from "@lambdot/http";
import nacl from "tweetnacl";

import { readQqCredentials, type QqCredentialKeys } from "./credentials.ts";
import { decodeQqEvent, type QqEvent } from "./events.ts";

/**
 * The webhook service, emitted as the plugin's item map: subscribe to decoded
 * event dispatches. The webhook is a pure listener — it holds no REST client
 * and no per-message reply state. Replying goes through `qqApi` with the
 * event's own `context`, so the passive-reply reference is always resolved
 * from the context the caller provides. Where the callback route lives is the
 * host's decision — the plugin only knows the abstract `HttpServer` it
 * registers on.
 */
export interface QqWebhook {
    /** Subscribe to decoded C2C/group events. The disposer unsubscribes. */
    onEvent(listener: (event: QqEvent) => void): Disposer;
}

export interface QqWebhookConfig {
    /** The callback route to register on the router; defaults to `"/qq/callback"`. */
    readonly path?: string;
    /** Which env variables carry the credentials. */
    readonly keys?: QqCredentialKeys;
}

/**
 * The webhook (reversed-post) half of the qq protocol: QQ pushes events to
 * an HTTPS callback address. The plugin registers the callback route on the
 * wired-in {@link HttpServer} and implements the callback algorithm — op 13
 * address validation (sign `event_ts + plain_token`), ed25519 verification
 * of `X-Signature-Ed25519` over `timestamp + body` for everything else —
 * then delivers decoded op-0 dispatches to `onEvent` listeners. The bot
 * secret seeds the ed25519 keypair (repeated to 32 bytes). The route lives
 * as long as the host's server; the listeners clear when the owning scope
 * disposes.
 *
 * ```ts
 * app.with(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *    .use(qqWebhook("qq"), {
 *        option: {},
 *        mapping: (ctx) => ({ http: ctx.http, env: ctx["qq-env"] }),
 *    });
 * ```
 */
export function qqWebhook<const TName extends string>(
    name: TName,
): Plugin<
    { http: HttpServer; env: Readonly<Record<string, string>> },
    QqWebhook,
    QqWebhookConfig,
    TName
> {
    return definePlugin({
        name,
        apply(input, scope, config) {
            const credentials = readQqCredentials(input.env, config.keys);
            // The bot secret seeds the ed25519 keypair: repeat to 32 bytes.
            let seed = credentials.clientSecret;
            while (seed.length < 32) seed += seed;
            const keyPair = nacl.sign.keyPair.fromSeed(new TextEncoder().encode(seed.slice(0, 32)));

            const listeners = new Set<(event: QqEvent) => void>();
            scope.onDispose(() => {
                listeners.clear();
            });

            input.http.on("POST", config.path ?? "/qq/callback", async (c) => {
                const request = c.req.raw;
                const body = await request.text();
                let frame: { op?: unknown; id?: unknown; d?: unknown; t?: unknown };
                try {
                    frame = JSON.parse(body) as typeof frame;
                } catch {
                    return new Response("bad request", { status: 400 });
                }

                // op 13: callback-address validation. Sign, no verify.
                if (frame.op === 13) {
                    const d = frame.d as
                        | { plain_token?: unknown; event_ts?: unknown }
                        | null
                        | undefined;
                    if (typeof d?.plain_token !== "string" || typeof d.event_ts !== "string")
                        return new Response("bad request", { status: 400 });
                    const signature = toHex(
                        nacl.sign.detached(
                            new TextEncoder().encode(d.event_ts + d.plain_token),
                            keyPair.secretKey,
                        ),
                    );
                    return Response.json({ plain_token: d.plain_token, signature });
                }

                // Everything else: verify the ed25519 signature over
                // timestamp + body before trusting the payload.
                const signature = request.headers.get("x-signature-ed25519");
                const timestamp = request.headers.get("x-signature-timestamp");
                if (
                    signature === null ||
                    timestamp === null ||
                    !verify(keyPair.publicKey, timestamp + body, signature)
                )
                    return new Response("unauthorized", { status: 401 });

                if (frame.op === 0) {
                    const event = decodeQqEvent({ id: frame.id, t: frame.t, d: frame.d });
                    if (event !== null) for (const listener of listeners) listener(event);
                }
                return Response.json({});
            });

            return {
                onEvent(listener) {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
            };
        },
    });
}

function verify(publicKey: Uint8Array, message: string, signatureHex: string): boolean {
    const signature = fromHex(signatureHex);
    return (
        signature !== null &&
        signature.length === nacl.sign.signatureLength &&
        nacl.sign.detached.verify(new TextEncoder().encode(message), signature, publicKey)
    );
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array | null {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}
