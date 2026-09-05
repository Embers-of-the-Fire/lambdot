import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

import { readQqCredentials, type QqCredentialKeys, type QqCredentials } from "./credentials.ts";

/**
 * The reply context of a send, provided by the caller — usually taken from a
 * decoded event (`event.context`). The union enforces the platform's mutual
 * exclusions at the type level: a passive reply carries either a `msgId`
 * (a message event's `d.id`) or an `eventId` (the dispatch's outer `id`,
 * supported by `INTERACTION_CREATE`, `FRIEND_ADD`, `C2C_MSG_RECEIVE`,
 * `GROUP_ADD_ROBOT`, `GROUP_MSG_RECEIVE`), and an interaction-recall message
 * (`wakeup`) excludes both. Conflicting fields are also rejected at runtime.
 * Omitting the context sends an active message.
 */
export type QqMessageContext =
    | {
          /** Passive reply to a message (`msg_id`). */
          readonly msgId: string;
          /** `msg_seq`; defaults to 1 on the platform. Repeating a `msg_id + msg_seq` pair fails. */
          readonly msgSeq?: number | undefined;
          readonly eventId?: never;
          readonly wakeup?: never;
      }
    | {
          /** Passive reply to an event (`event_id`). */
          readonly eventId: string;
          readonly msgId?: never;
          readonly msgSeq?: never;
          readonly wakeup?: never;
      }
    | {
          /** Interaction-recall message (`is_wakeup`), for re-engaging a user within a cycle. */
          readonly wakeup: true;
          readonly msgId?: never;
          readonly msgSeq?: never;
          readonly eventId?: never;
      };

/** Markdown payload (`msg_type` 2). */
export interface QqMarkdown {
    readonly content: string;
    /** Fail the send when an image transfer fails; defaults to false. */
    readonly forceVerifyImageResource?: boolean | undefined;
}

export interface QqKeyboardButtonRenderData {
    /** Button text, at most 10 characters. */
    readonly label: string;
    /** Text after the button was clicked; unchanged when omitted. */
    readonly visitedLabel?: string | undefined;
    /** 0 grey outline, 1 blue outline, 3 white on red, 4 blue on white. */
    readonly style?: 0 | 1 | 3 | 4 | undefined;
}

export interface QqKeyboardButtonPermission {
    /** 0 specified users, 1 admins, 2 everyone. */
    readonly type: 0 | 1 | 2;
    readonly specifyUserIds?: readonly string[] | undefined;
    /** Guild roles only; meaningless in C2C/group scenes. */
    readonly specifyRoleIds?: readonly string[] | undefined;
}

export interface QqKeyboardButtonModal {
    /** Confirmation text; the click is confirmed in a modal when non-empty. */
    readonly content?: string | undefined;
    readonly confirmText?: string | undefined;
    readonly cancelText?: string | undefined;
}

export interface QqKeyboardButtonAction {
    /** 0 jump (http/miniapp), 1 callback to the backend, 2 insert `@bot data` into the input box. */
    readonly type: 0 | 1 | 2;
    readonly permission?: QqKeyboardButtonPermission | undefined;
    /** Callback data; required for type 1/2. */
    readonly data?: string | undefined;
    /** Shown on clients too old for inline keyboards. */
    readonly unsupportTips?: string | undefined;
    /** Type 2: send `data` immediately on click (C2C only). */
    readonly enter?: boolean | undefined;
    /** Type 2: quote-reply to the keyboard's message. */
    readonly reply?: boolean | undefined;
    /** Type 2, C2C mobile only: 1 opens the image picker. */
    readonly anchor?: number | undefined;
    readonly modal?: QqKeyboardButtonModal | undefined;
}

export interface QqKeyboardButton {
    /** Button id, unique within the keyboard. */
    readonly id?: string | undefined;
    readonly renderData: QqKeyboardButtonRenderData;
    readonly action: QqKeyboardButtonAction;
    /** Group id: after one button of a group is acted on, the others grey out (action type 1 only). */
    readonly groupId?: string | undefined;
}

export interface QqKeyboardRow {
    readonly buttons: readonly QqKeyboardButton[];
}

/** An inline keyboard: a platform template by `id`, or a custom layout. */
export type QqKeyboard =
    | { readonly id: string }
    | { readonly content: { readonly rows: readonly QqKeyboardRow[] } };

/**
 * One outgoing message, discriminated by the wire `msg_type`. `reference`
 * carries the quoted message's `msg_idx`/`ref_idx` (`message_reference`).
 */
export type QqOutgoingMessage =
    | {
          readonly msgType: 0;
          readonly content: string;
          readonly keyboard?: QqKeyboard | undefined;
          readonly reference?: string | undefined;
      }
    | {
          readonly msgType: 2;
          readonly markdown: QqMarkdown;
          readonly keyboard?: QqKeyboard | undefined;
          readonly reference?: string | undefined;
      }
    | {
          /** "Typing…" state, C2C only. */
          readonly msgType: 6;
          /** How long the state lasts, at most 60 seconds. */
          readonly inputSeconds: number;
      }
    | {
          /** Rich media; `fileInfo` comes from the matching scene's file-upload call. */
          readonly msgType: 7;
          readonly fileInfo: string;
          readonly content?: string | undefined;
          readonly reference?: string | undefined;
      };

/** What the platform returns for a successful send. */
export interface QqSentMessage {
    /** Message id — the handle for a later recall. */
    readonly id: string;
    readonly timestamp: string;
    /** Quote index, usable as another message's `reference`. */
    readonly refIdx?: string | undefined;
}

/**
 * A rich-media upload; C2C and group uploads are not interchangeable. The
 * platform requires an upload source: either a public `url` it downloads and
 * re-hosts, or the `uploadId` of a chunked-upload task from `upload_prepare`
 * (the merge path). The union enforces this at the type level; source-less
 * objects are also rejected at runtime.
 */
export type QqFileUpload = QqFileUploadBase &
    (
        | {
              /** Public URL the platform downloads and re-hosts. */
              readonly url: string;
              readonly uploadId?: never;
          }
        | {
              /** Chunked-upload task id from `upload_prepare`; takes the merge path. */
              readonly uploadId: string;
              readonly url?: never;
          }
    );

interface QqFileUploadBase {
    /** 1 image (png/jpg), 2 video (mp4), 3 voice (silk), 4 file. */
    readonly fileType: 1 | 2 | 3 | 4;
    readonly fileName?: string | undefined;
    /** Send the message immediately on upload, consuming an active-message quota. */
    readonly srvSendMsg?: boolean | undefined;
}

export interface QqUploadedFile {
    readonly fileUuid?: string | undefined;
    /** Opaque handle for `media.file_info` in a send; expires after `ttl` seconds (0 = no expiry). */
    readonly fileInfo: string;
    readonly ttl: number;
    /** The sent message's id; present only when `srvSendMsg` was set. */
    readonly messageId?: string | undefined;
    /** Pre-signed download URL; chunked merges of image/video/voice only. */
    readonly rawUrl?: string | undefined;
}

/**
 * The REST half of the qq protocol: every send is an authenticated HTTPS call
 * against the open platform. Owns the access-token lifecycle: tokens are
 * cached and refreshed ahead of expiry (the platform hands out ~7200s tokens
 * and keeps the old one valid for a 60s overlap). Sends resolve their
 * passive/active nature from the caller-provided {@link QqMessageContext} —
 * the client holds no per-message reply state.
 */
export interface QqApi {
    readonly appId: string;
    /** A valid access token; refreshed automatically ahead of expiry. */
    accessToken(): Promise<string>;
    /** The websocket gateway URL (`GET /gateway`). */
    gatewayUrl(): Promise<string>;
    /** Send to a C2C conversation (`POST /v2/users/{user_openid}/messages`). */
    sendC2cMessage(
        userOpenid: string,
        message: QqOutgoingMessage,
        context?: QqMessageContext,
    ): Promise<QqSentMessage>;
    /** Send to a group (`POST /v2/groups/{group_openid}/messages`). */
    sendGroupMessage(
        groupOpenid: string,
        message: QqOutgoingMessage,
        context?: QqMessageContext,
    ): Promise<QqSentMessage>;
    /**
     * Recall a C2C message (`DELETE /v2/users/{user_openid}/messages/{message_id}`).
     * Only the bot's own messages, at most 2 minutes old.
     */
    recallC2cMessage(userOpenid: string, messageId: string): Promise<void>;
    /**
     * Recall a group message (`DELETE /v2/groups/{group_openid}/messages/{message_id}`).
     * Group admins may also recall ordinary members' messages.
     */
    recallGroupMessage(groupOpenid: string, messageId: string): Promise<void>;
    /** Upload rich media for a C2C conversation (`POST /v2/users/{user_openid}/files`). */
    uploadC2cFile(userOpenid: string, file: QqFileUpload): Promise<QqUploadedFile>;
    /** Upload rich media for a group (`POST /v2/groups/{group_openid}/files`). */
    uploadGroupFile(groupOpenid: string, file: QqFileUpload): Promise<QqUploadedFile>;
    /**
     * Acknowledge an `INTERACTION_CREATE` event
     * (`PUT /interactions/{interaction_id}`); required for button (type 11)
     * and quick-menu (type 12) interactions, each answerable exactly once.
     */
    ackInteraction(interactionId: string, code?: 0 | 1 | 2 | 3 | 4 | 5): Promise<void>;
}

export interface QqApiConfig {
    /** Open-platform base URL; override to point at a mock in tests (also used for token calls). */
    readonly apiBase?: string | undefined;
    /** Which env variables carry the credentials. */
    readonly keys?: QqCredentialKeys | undefined;
}

const DEFAULT_API_BASE = "https://api.bot.qq.com";
/**
 * Token acquisition goes to a different host than the OpenAPI endpoints;
 * Tencent requires `bots.qq.com` for `/app/getAppAccessToken`.
 */
const DEFAULT_TOKEN_BASE = "https://bots.qq.com";
/** Refresh a token once it is within this margin of its expiry. */
const EXPIRY_MARGIN_MS = 60_000;

/** Build the REST client directly, outside a composition. */
export function createQqApi(
    credentials: QqCredentials,
    options?: { apiBase?: string | undefined },
): QqApi {
    const apiBase = options?.apiBase ?? DEFAULT_API_BASE;
    // An apiBase override (e.g. a mock in tests) serves both API and token
    // calls; only the defaults differ.
    const tokenBase = options?.apiBase ?? DEFAULT_TOKEN_BASE;

    let cached: { token: string; expiresAt: number } | undefined;
    let pending: Promise<string> | undefined;
    const accessToken = (): Promise<string> => {
        if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.token);
        pending ??= fetch(`${tokenBase}/app/getAppAccessToken`, {
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
        if (!res.ok) throw new Error(`qq api ${path} failed: ${res.status} ${await res.text()}`);
        return res;
    };

    const send = async (
        scene: "c2c" | "group",
        openid: string,
        message: QqOutgoingMessage,
        context: QqMessageContext | undefined,
    ): Promise<QqSentMessage> => {
        if (scene === "group" && message.msgType === 6)
            throw new Error("qq group messages do not support msg_type 6 (input_notify)");
        const path =
            scene === "group" ? `/v2/groups/${openid}/messages` : `/v2/users/${openid}/messages`;
        const res = await authed(path, {
            method: "POST",
            body: JSON.stringify(encodeMessage(message, context)),
        });
        const body = (await res.json()) as {
            id?: unknown;
            timestamp?: unknown;
            ext_info?: { ref_idx?: unknown };
        };
        if (typeof body.id !== "string")
            throw new Error(`qq send to ${path} returned no message id`);
        return {
            id: body.id,
            timestamp: typeof body.timestamp === "string" ? body.timestamp : "",
            ...(typeof body.ext_info?.ref_idx === "string"
                ? { refIdx: body.ext_info.ref_idx }
                : {}),
        };
    };

    const upload = async (
        scene: "c2c" | "group",
        openid: string,
        file: QqFileUpload,
    ): Promise<QqUploadedFile> => {
        if (file.url === undefined && file.uploadId === undefined)
            throw new Error("qq file upload requires a source: url or uploadId");
        if (file.url !== undefined && file.uploadId !== undefined)
            throw new Error("qq file upload accepts only one source: url or uploadId, not both");
        const path = scene === "group" ? `/v2/groups/${openid}/files` : `/v2/users/${openid}/files`;
        const res = await authed(path, {
            method: "POST",
            body: JSON.stringify({
                file_type: file.fileType,
                ...(file.url !== undefined ? { url: file.url } : {}),
                ...(file.uploadId !== undefined ? { upload_id: file.uploadId } : {}),
                ...(file.fileName !== undefined ? { file_name: file.fileName } : {}),
                ...(file.srvSendMsg !== undefined ? { srv_send_msg: file.srvSendMsg } : {}),
            }),
        });
        const body = (await res.json()) as {
            file_uuid?: unknown;
            file_info?: unknown;
            ttl?: unknown;
            id?: unknown;
            raw_url?: unknown;
        };
        if (typeof body.file_info !== "string")
            throw new Error(`qq upload to ${path} returned no file_info`);
        return {
            ...(typeof body.file_uuid === "string" ? { fileUuid: body.file_uuid } : {}),
            fileInfo: body.file_info,
            ttl: typeof body.ttl === "number" ? body.ttl : 0,
            ...(typeof body.id === "string" ? { messageId: body.id } : {}),
            ...(typeof body.raw_url === "string" ? { rawUrl: body.raw_url } : {}),
        };
    };

    return {
        appId: credentials.appId,
        accessToken,
        async gatewayUrl() {
            const res = await authed("/gateway");
            const body = (await res.json()) as { url?: unknown };
            if (typeof body.url !== "string") throw new Error("qq gateway response is missing url");
            return body.url;
        },
        sendC2cMessage: (userOpenid, message, context) => send("c2c", userOpenid, message, context),
        sendGroupMessage: (groupOpenid, message, context) =>
            send("group", groupOpenid, message, context),
        async recallC2cMessage(userOpenid, messageId) {
            await authed(`/v2/users/${userOpenid}/messages/${messageId}`, { method: "DELETE" });
        },
        async recallGroupMessage(groupOpenid, messageId) {
            await authed(`/v2/groups/${groupOpenid}/messages/${messageId}`, { method: "DELETE" });
        },
        uploadC2cFile: (userOpenid, file) => upload("c2c", userOpenid, file),
        uploadGroupFile: (groupOpenid, file) => upload("group", groupOpenid, file),
        async ackInteraction(interactionId, code = 0) {
            await authed(`/interactions/${interactionId}`, {
                method: "PUT",
                body: JSON.stringify({ code }),
            });
        },
    };
}

/** Resolve a message + caller-provided context into the wire body. */
function encodeMessage(
    message: QqOutgoingMessage,
    context: QqMessageContext | undefined,
): Record<string, unknown> {
    const body: Record<string, unknown> = { msg_type: message.msgType };
    switch (message.msgType) {
        case 0:
            body.content = message.content;
            break;
        case 2:
            body.markdown = {
                content: message.markdown.content,
                ...(message.markdown.forceVerifyImageResource !== undefined
                    ? { force_verify_image_resource: message.markdown.forceVerifyImageResource }
                    : {}),
            };
            break;
        case 6:
            body.input_notify = { input_type: 1, input_second: message.inputSeconds };
            break;
        case 7:
            body.media = { file_info: message.fileInfo };
            if (message.content !== undefined) body.content = message.content;
            break;
    }
    if ("keyboard" in message && message.keyboard !== undefined)
        body.keyboard = encodeKeyboard(message.keyboard);
    if ("reference" in message && message.reference !== undefined)
        body.message_reference = { message_id: message.reference };
    if (context !== undefined) {
        const fields = (["msgId", "eventId", "wakeup"] as const).filter(
            (key) => context[key] !== undefined,
        );
        if (fields.length > 1)
            throw new Error(
                `qq message context fields are mutually exclusive, got: ${fields.join(", ")}`,
            );
        if (context.msgId !== undefined) {
            body.msg_id = context.msgId;
            if (context.msgSeq !== undefined) body.msg_seq = context.msgSeq;
        } else if (context.eventId !== undefined) {
            body.event_id = context.eventId;
        } else {
            body.is_wakeup = true;
        }
    }
    return body;
}

function encodeKeyboard(keyboard: QqKeyboard): Record<string, unknown> {
    if ("id" in keyboard) return { id: keyboard.id };
    return {
        content: {
            rows: keyboard.content.rows.map((row) => ({
                buttons: row.buttons.map((button) => ({
                    ...(button.id !== undefined ? { id: button.id } : {}),
                    render_data: {
                        label: button.renderData.label,
                        ...(button.renderData.visitedLabel !== undefined
                            ? { visited_label: button.renderData.visitedLabel }
                            : {}),
                        ...(button.renderData.style !== undefined
                            ? { style: button.renderData.style }
                            : {}),
                    },
                    action: {
                        type: button.action.type,
                        ...(button.action.permission !== undefined
                            ? {
                                  permission: {
                                      type: button.action.permission.type,
                                      ...(button.action.permission.specifyUserIds !== undefined
                                          ? {
                                                specify_user_ids:
                                                    button.action.permission.specifyUserIds,
                                            }
                                          : {}),
                                      ...(button.action.permission.specifyRoleIds !== undefined
                                          ? {
                                                specify_role_ids:
                                                    button.action.permission.specifyRoleIds,
                                            }
                                          : {}),
                                  },
                              }
                            : {}),
                        ...(button.action.data !== undefined ? { data: button.action.data } : {}),
                        ...(button.action.unsupportTips !== undefined
                            ? { unsupport_tips: button.action.unsupportTips }
                            : {}),
                        ...(button.action.enter !== undefined
                            ? { enter: button.action.enter }
                            : {}),
                        ...(button.action.reply !== undefined
                            ? { reply: button.action.reply }
                            : {}),
                        ...(button.action.anchor !== undefined
                            ? { anchor: button.action.anchor }
                            : {}),
                        ...(button.action.modal !== undefined
                            ? {
                                  modal: {
                                      ...(button.action.modal.content !== undefined
                                          ? { content: button.action.modal.content }
                                          : {}),
                                      ...(button.action.modal.confirmText !== undefined
                                          ? { confirm_text: button.action.modal.confirmText }
                                          : {}),
                                      ...(button.action.modal.cancelText !== undefined
                                          ? { cancel_text: button.action.modal.cancelText }
                                          : {}),
                                  },
                              }
                            : {}),
                    },
                    ...(button.groupId !== undefined ? { group_id: button.groupId } : {}),
                })),
            })),
        },
    };
}

/**
 * The qq REST client as a plugin, reading credentials from an env snapshot
 * (see `@lambdot/env`). Wire the env namespace through the mapping:
 *
 * ```ts
 * app.use(envVars("qq-env", ["QQ_BOT_APP_ID", "QQ_BOT_APP_SECRET"]))
 *    .use(qqApi("qq-api"), { option: {}, mapping: (ctx) => ({ env: ctx["qq-env"] }) });
 * ```
 */
export function qqApi<const TName extends string>(
    name: TName,
): Plugin<{ env: Readonly<Record<string, string>> }, QqApi, QqApiConfig, TName> {
    return definePlugin({
        name,
        apply(input, _scope, config) {
            const credentials = readQqCredentials(input.env, config.keys);
            return createQqApi(credentials, config);
        },
    });
}
