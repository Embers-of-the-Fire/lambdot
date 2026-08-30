import type { Message, Plugin } from "@lambdot/core";
import { channel, definePlugin, message, shareStream } from "@lambdot/core";
import nacl from "tweetnacl";

import { readQqCredentials, type QqCredentialKeys } from "./credentials.ts";
import type { QqAddress, QqMessage, QqMessageStream } from "./events.ts";
import { decodeMessageEvent } from "./events.ts";

/**
 * The request bridge, emitted as the plugin's namespace value: the HTTP
 * route lives outside the composition (a hono handler, a worker's fetch), so
 * it hands each callback request to `handle` and sends back the returned
 * response. Decoded message dispatches join the `messages` stream.
 */
export interface QqWebhook {
    handle(request: Request): Promise<Response>;
    readonly messages: QqMessageStream;
}

export interface QqWebhookConfig {
    /** Which env variables carry the credentials. */
    readonly keys?: QqCredentialKeys;
}

/**
 * The webhook (reversed-post) input: QQ pushes events to an HTTPS callback
 * address. Emits a {@link QqWebhook} that implements the callback algorithm —
 * op 13 address validation (sign `event_ts + plain_token`), ed25519
 * verification of `X-Signature-Ed25519` over `timestamp + body` for
 * everything else — then pushes message dispatches to the stream. The bot
 * secret seeds the ed25519 keypair (repeated to 32 bytes).
 *
 * ```ts
 * .use(qqWebhook("qq"), { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) });
 * // in the hono route: return kernel.ctx.qq.handle(c.req.raw);
 * ```
 */
export function qqWebhook<const TName extends string>(
    name: TName,
): Plugin<{ env: Readonly<Record<string, string>> }, QqWebhook, QqWebhookConfig, TName> {
    return definePlugin({
        name,
        apply(input, scope, config) {
            const credentials = readQqCredentials(input.env, config.keys);
            // The bot secret seeds the ed25519 keypair: repeat to 32 bytes.
            let seed = credentials.clientSecret;
            while (seed.length < 32) seed += seed;
            const keyPair = nacl.sign.keyPair.fromSeed(new TextEncoder().encode(seed.slice(0, 32)));

            const messages = channel<Message<QqMessage, QqAddress>>();
            scope.onDispose(() => {
                messages.close();
            });

            const webhook: QqWebhook = {
                // Shared: several consumers may subscribe to the stream.
                messages: shareStream(messages.stream),
                async handle(request) {
                    if (request.method !== "POST")
                        return new Response("method not allowed", { status: 405 });
                    const body = await request.text();
                    let frame: { op?: unknown; d?: unknown; t?: unknown };
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

                    if (frame.op === 0 && typeof frame.t === "string") {
                        const decoded = decodeMessageEvent(frame.t, frame.d);
                        if (decoded) messages.push(message(decoded.payload, decoded.address));
                    }
                    return Response.json({});
                },
            };

            return webhook;
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
