import type { Disposer, InputPlugin } from "@lambdot/core";
import nacl from "tweetnacl";

import { readQqCredentials, type QqCredentialKeys, type QqEnvNeeds } from "./credentials.ts";
import { decodeMessageEvent, type QqEvents } from "./events.ts";

/**
 * The request bridge, provided as a typed capability: the HTTP route lives
 * outside the event pipeline (a hono handler, a worker's fetch), so it hands
 * each callback request to `handle` and sends back the returned response —
 * the same bridge pattern as the cloudflare example's `PingService`.
 */
export interface QqWebhook {
    handle(request: Request): Promise<Response>;
}

export type QqWebhookCapability<TCap extends string> = { readonly [K in TCap]: QqWebhook };

export interface QqWebhookConfig {
    /** Which env variables carry the credentials. */
    readonly keys?: QqCredentialKeys;
}

/**
 * The webhook (reversed-post) input: QQ pushes events to an HTTPS callback
 * address. Registers the message event kinds and provides a {@link QqWebhook}
 * capability that implements the callback algorithm — op 13 address
 * validation (sign `event_ts + plain_token`), ed25519 verification of
 * `X-Signature-Ed25519` over `timestamp + body` for everything else — then
 * ingests message dispatches. The bot secret seeds the ed25519 keypair
 * (repeated to 32 bytes).
 *
 * ```ts
 * .use(qqWebhookInput("qq-webhook", "qq-env"), {});
 * // in the hono route: return kernel.ctx["qq-webhook"].handle(c.req.raw);
 * ```
 */
export function qqWebhookInput<TCap extends string, TEnvCap extends string>(
    capability: TCap,
    env: TEnvCap,
): InputPlugin<
    QqEvents,
    QqWebhookConfig,
    `qq-webhook:${TCap}`,
    QqWebhookCapability<TCap>,
    QqEnvNeeds<TEnvCap>
> {
    return {
        role: "input",
        name: `qq-webhook:${capability}`,
        inject: [env],
        apply(ctx, config) {
            const credentials = readQqCredentials(ctx[env], config.keys);
            // The bot secret seeds the ed25519 keypair: repeat to 32 bytes.
            let seed = credentials.clientSecret;
            while (seed.length < 32) seed += seed;
            const keyPair = nacl.sign.keyPair.fromSeed(new TextEncoder().encode(seed.slice(0, 32)));

            const webhook: QqWebhook = {
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
                        if (decoded)
                            await ctx.ingest(decoded.kind, decoded.payload, decoded.address);
                    }
                    return Response.json({});
                },
            };

            // See `wsTransport` in @lambdot/websocket for why `provide` is pinned here.
            return (ctx.provide as (name: TCap, value: QqWebhook) => Disposer).call(
                ctx,
                capability,
                webhook,
            );
        },
    };
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
