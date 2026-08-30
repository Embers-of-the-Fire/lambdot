import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

import { readQqCredentials, type QqCredentialKeys } from "./credentials.ts";
import type { QqAddress } from "./events.ts";

/**
 * The REST half of the qq protocol, emitted as the plugin's namespace value.
 * Both receiving transports (gateway, webhook) deliver messages only;
 * sending a message is always an HTTPS call against the open platform. Owns
 * the access-token lifecycle: tokens are cached and refreshed ahead of
 * expiry (the platform hands out ~7200s tokens and keeps the old one valid
 * for a 60s overlap).
 */
export interface QqApi {
    readonly appId: string;
    /** A valid access token; refreshed automatically ahead of expiry. */
    accessToken(): Promise<string>;
    /** The websocket gateway URL (`GET /gateway`). */
    gatewayUrl(): Promise<string>;
    /**
     * Send a plain-text message (`msg_type` 0). Passive reply when the
     * address carries a `msgId`: `msg_seq` is taken from the address, or
     * auto-incremented per `msgId` when omitted (the platform rejects a
     * repeated `msg_id` + `msg_seq` pair).
     */
    sendMessage(to: QqAddress, content: string): Promise<void>;
}

export interface QqApiConfig {
    /** Open-platform base URL; override to point at a mock in tests. */
    readonly apiBase?: string;
    /** Which env variables carry the credentials. */
    readonly keys?: QqCredentialKeys;
}

const DEFAULT_API_BASE = "https://api.bot.qq.com";
/** Refresh a token once it is within this margin of its expiry. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * The qq REST client as a plugin, reading credentials from an env snapshot
 * (see `@lambdot/env`). Wire the env namespace through the mapping:
 *
 * ```ts
 * createKernel()
 *     .use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *     .bind(qqApi("qq/api"), { mapping: (ctx) => ({ env: ctx["qq-env"] }) });
 * ```
 */
export function qqApi<const TName extends string>(
    name: TName,
): Plugin<{ env: Readonly<Record<string, string>> }, QqApi, QqApiConfig, TName> {
    return definePlugin({
        name,
        apply(input, _scope, config) {
            const credentials = readQqCredentials(input.env, config.keys);
            const apiBase = config.apiBase ?? DEFAULT_API_BASE;

            let cached: { token: string; expiresAt: number } | undefined;
            let pending: Promise<string> | undefined;
            const accessToken = (): Promise<string> => {
                if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.token);
                pending ??= fetch(`${apiBase}/app/getAppAccessToken`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        appId: credentials.appId,
                        clientSecret: credentials.clientSecret,
                    }),
                })
                    .then(async (res) => {
                        if (!res.ok)
                            throw new Error(
                                `qq access token request failed: ${res.status} ${await res.text()}`,
                            );
                        const body = (await res.json()) as {
                            access_token?: unknown;
                            expires_in?: unknown;
                        };
                        if (typeof body.access_token !== "string")
                            throw new Error("qq access token response is missing access_token");
                        return {
                            token: body.access_token,
                            expiresAt:
                                Date.now() +
                                // The docs' examples show expires_in as a string.
                                Number(body.expires_in ?? 7200) * 1000 -
                                EXPIRY_MARGIN_MS,
                        };
                    })
                    .then(
                        (next) => {
                            cached = next;
                            pending = undefined;
                            return next.token;
                        },
                        (error: unknown) => {
                            pending = undefined;
                            throw error;
                        },
                    );
                return pending;
            };

            const authed = async (path: string, init?: RequestInit): Promise<Response> => {
                const headers = new Headers(init?.headers);
                headers.set("content-type", "application/json");
                headers.set("authorization", `QQBot ${await accessToken()}`);
                const res = await fetch(`${apiBase}${path}`, { ...init, headers });
                if (!res.ok)
                    throw new Error(`qq api ${path} failed: ${res.status} ${await res.text()}`);
                return res;
            };

            // Passive replies to one msg_id must increment msg_seq.
            const msgSeqs = new Map<string, number>();

            return {
                appId: credentials.appId,
                accessToken,
                async gatewayUrl() {
                    const res = await authed("/gateway");
                    const body = (await res.json()) as { url?: unknown };
                    if (typeof body.url !== "string")
                        throw new Error("qq gateway response is missing url");
                    return body.url;
                },
                async sendMessage(to, content) {
                    const path =
                        to.scope === "group"
                            ? `/v2/groups/${to.openid}/messages`
                            : `/v2/users/${to.openid}/messages`;
                    const body: Record<string, unknown> = { msg_type: 0, content };
                    if (to.msgId !== undefined) {
                        body.msg_id = to.msgId;
                        const seq = (msgSeqs.get(to.msgId) ?? 0) + 1;
                        msgSeqs.set(to.msgId, seq);
                        body.msg_seq = to.msgSeq ?? seq;
                    }
                    await authed(path, { method: "POST", body: JSON.stringify(body) });
                },
            };
        },
    });
}
