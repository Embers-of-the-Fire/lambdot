import type { QqMessageContext } from "./api.ts";

/** A user reference carried by an event (`User`). */
export interface QqEventUser {
    /** The platform-wide id (openid format). */
    readonly id?: string | undefined;
    readonly username?: string | undefined;
    readonly bot?: boolean | undefined;
    /** Cross-app unified openid; may be empty. */
    readonly unionOpenid?: string | undefined;
    /** User openid, present in C2C scenes. */
    readonly userOpenid?: string | undefined;
    /** Member openid, present in group scenes. */
    readonly memberOpenid?: string | undefined;
    /** `member`, `admin`, or `owner`. */
    readonly memberRole?: string | undefined;
}

/** A rich-media attachment on an incoming message (`MessageAttachment`). */
export interface QqMessageAttachment {
    /** Download URL. */
    readonly url?: string | undefined;
    readonly filename?: string | undefined;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    /** Size in bytes. */
    readonly size?: number | undefined;
    /** MIME-ish type: `voice`, `image/jpeg`, `video/mp4`, `file`, … */
    readonly contentType?: string | undefined;
    /** WAV conversion of a voice message. */
    readonly voiceWavUrl?: string | undefined;
    /** ASR transcript of a voice message. */
    readonly asrReferText?: string | undefined;
}

/** The message's scene context (`MessageScene`). */
export interface QqMessageScene {
    readonly source?: string | undefined;
    /**
     * The `ext` list decoded from its `key=value` wire form —
     * `msg_idx` (the quote-reference index), `ref_msg_idx`, `auth_token`, …
     */
    readonly ext: Readonly<Record<string, string>>;
}

/**
 * One incoming message, shared by the C2C and group message events.
 * `content` is delivered verbatim: for `GROUP_AT_MESSAGE_CREATE` the platform
 * has already stripped the `@bot` prefix, padding included.
 */
export interface QqIncomingMessage {
    /** Message id (`msg_id`) — the passive-reply and recall handle. */
    readonly id: string;
    readonly content: string;
    /** RFC3339. */
    readonly timestamp: string;
    /** 0 text, 3 ark card, 101 parallel, 102 chat history, 103 quote. */
    readonly messageType: number;
    readonly author: QqEventUser;
    readonly attachments: readonly QqMessageAttachment[];
    /** Users @-mentioned in the message (the bot itself excluded). */
    readonly mentions: readonly QqEventUser[];
    readonly scene?: QqMessageScene | undefined;
}

/** `C2C_MESSAGE_CREATE` — a user messaged the bot directly. */
export interface QqC2cMessageEvent {
    readonly type: "C2C_MESSAGE_CREATE";
    readonly message: QqIncomingMessage;
    /** The author's user openid — the `sendC2cMessage` target. */
    readonly userOpenid: string;
    /** Passive-reply context for this message (`{ msgId }`). */
    readonly context: QqMessageContext;
}

/**
 * `GROUP_AT_MESSAGE_CREATE` — the bot was @-mentioned in a group — or
 * `GROUP_MESSAGE_CREATE` — full-mode, every group message.
 */
export interface QqGroupMessageEvent {
    readonly type: "GROUP_AT_MESSAGE_CREATE" | "GROUP_MESSAGE_CREATE";
    readonly message: QqIncomingMessage;
    /** The group's openid — the `sendGroupMessage` target. */
    readonly groupOpenid: string;
    /** Passive-reply context for this message (`{ msgId }`). */
    readonly context: QqMessageContext;
}

/**
 * `INTERACTION_CREATE` — a button click, quick-menu callback, feedback,
 * authorization, and so on. Only the C2C and group scenes are decoded; guild
 * interactions are dropped by {@link decodeQqEvent}. Type 11 (button) and 12
 * (quick menu) must be acknowledged with `ackInteraction`.
 */
export interface QqInteractionEvent {
    readonly type: "INTERACTION_CREATE";
    /** The interaction id (`d.id`) — the `ackInteraction` handle. */
    readonly id: string;
    /** 11 button, 12 quick menu, 13 feedback, 14 clear session, 15 story, 16 model switch, 18–20 authorization. */
    readonly interactionType: number;
    readonly scene: "c2c" | "group";
    readonly timestamp: string;
    readonly userOpenid?: string | undefined;
    readonly groupOpenid?: string | undefined;
    readonly groupMemberOpenid?: string | undefined;
    /** The button's `id`, for type 11. */
    readonly buttonId?: string | undefined;
    /** The button's `data`, for type 11; callback data for type 13. */
    readonly buttonData?: string | undefined;
    /** The menu's feature id, for type 12. */
    readonly featureId?: string | undefined;
    /** The message the interaction targets, for type 11/13. */
    readonly messageId?: string | undefined;
    /** Passive-reply context for this interaction (`{ eventId }`). */
    readonly context: QqMessageContext;
}

/** `FRIEND_ADD` — a user added the bot as a friend. */
export interface QqFriendAddEvent {
    readonly type: "FRIEND_ADD";
    readonly userOpenid: string;
    /** Unix seconds. */
    readonly timestamp: number;
    /** Where the add came from (1000 default, 1003 group, 2003 shared link, …). */
    readonly scene?: number | undefined;
    /** The developer-provided `callback_data` of the source. */
    readonly sceneParam?: string | undefined;
    readonly unionOpenid?: string | undefined;
    /** Passive-reply context (`{ eventId }`); present when the dispatch carried an outer id. */
    readonly context?: QqMessageContext | undefined;
}

/** `FRIEND_DEL` — a user removed the bot. */
export interface QqFriendDelEvent {
    readonly type: "FRIEND_DEL";
    readonly userOpenid: string;
    /** Unix seconds. */
    readonly timestamp: number;
    readonly unionOpenid?: string | undefined;
}

/**
 * `C2C_MSG_RECEIVE` / `C2C_MSG_REJECT` — the user toggled the bot's
 * active-message push switch on their profile card.
 */
export interface QqC2cMsgGateEvent {
    readonly type: "C2C_MSG_RECEIVE" | "C2C_MSG_REJECT";
    readonly userOpenid: string;
    /** Unix seconds. */
    readonly timestamp: number;
    /** Passive-reply context (`{ eventId }`, receive only); present when the dispatch carried an outer id. */
    readonly context?: QqMessageContext | undefined;
}

/** `GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT` — the bot joined or left a group. */
export interface QqGroupRobotEvent {
    readonly type: "GROUP_ADD_ROBOT" | "GROUP_DEL_ROBOT";
    readonly groupOpenid: string;
    /** The member who operated, when the platform reports one. */
    readonly opMemberOpenid?: string | undefined;
    /** Unix seconds. */
    readonly timestamp: number;
    /** Passive-reply context (`{ eventId }`, add only); present when the dispatch carried an outer id. */
    readonly context?: QqMessageContext | undefined;
}

/**
 * `GROUP_MSG_RECEIVE` / `GROUP_MSG_REJECT` — a group admin toggled the bot's
 * notifications in its profile page.
 */
export interface QqGroupMsgGateEvent {
    readonly type: "GROUP_MSG_RECEIVE" | "GROUP_MSG_REJECT";
    readonly groupOpenid: string;
    readonly opMemberOpenid?: string | undefined;
    /** Unix seconds. */
    readonly timestamp: number;
    /** Passive-reply context (`{ eventId }`, receive only); present when the dispatch carried an outer id. */
    readonly context?: QqMessageContext | undefined;
}

/** `GROUP_MEMBER_ADD` / `GROUP_MEMBER_REMOVE` — group membership changed. */
export interface QqGroupMemberEvent {
    readonly type: "GROUP_MEMBER_ADD" | "GROUP_MEMBER_REMOVE";
    readonly groupOpenid: string;
    readonly memberOpenid: string;
    /** The member's cross-app user openid; may be empty. */
    readonly userOpenid?: string | undefined;
    /** Unix seconds. */
    readonly timestamp: number;
}

/** `GROUP_JOIN_REQUEST` — a user applied to join (bot must be a group admin). */
export interface QqGroupJoinRequestEvent {
    readonly type: "GROUP_JOIN_REQUEST";
    readonly groupOpenid: string;
    /** The application id, to be echoed to the approval interface. */
    readonly joinRequestId: string;
    readonly memberOpenid: string;
    readonly username?: string | undefined;
    /** RFC3339. */
    readonly applyAt?: string | undefined;
    /** `self_apply` or `invited`. */
    readonly applySource?: string | undefined;
    /** The inviter's openid, when `applySource` is `invited`. */
    readonly invitedBy?: string | undefined;
    /** The applicant's verification message, when the group requires one. */
    readonly verifyMessage?: string | undefined;
}

/** One decoded C2C/group dispatch. Guild-scene dispatches never appear here. */
export type QqEvent =
    | QqC2cMessageEvent
    | QqGroupMessageEvent
    | QqInteractionEvent
    | QqFriendAddEvent
    | QqFriendDelEvent
    | QqC2cMsgGateEvent
    | QqGroupRobotEvent
    | QqGroupMsgGateEvent
    | QqGroupMemberEvent
    | QqGroupJoinRequestEvent;

/**
 * The wire shape of an op-0 dispatch frame: `t` names the event, `d` is the
 * event body, and the outer `id` is the `event_id` passive-reply reference
 * where the platform supports one.
 */
export interface QqDispatchFrame {
    readonly id?: unknown;
    readonly t?: unknown;
    readonly d?: unknown;
}

/**
 * Decode an op-0 dispatch frame into a {@link QqEvent}, or null to ignore it
 * — unknown event types, guild-scene interactions, and malformed bodies.
 */
export function decodeQqEvent(frame: QqDispatchFrame): QqEvent | null {
    const { t, d } = frame;
    if (typeof t !== "string" || typeof d !== "object" || d === null) return null;
    const eventId = typeof frame.id === "string" ? frame.id : undefined;
    const eventContext = eventId !== undefined ? { eventId } : undefined;

    switch (t) {
        case "C2C_MESSAGE_CREATE": {
            const message = decodeMessage(d);
            const userOpenid = stringField(d, "author", "user_openid");
            if (message === null || userOpenid === undefined) return null;
            return { type: t, message, userOpenid, context: { msgId: message.id } };
        }
        case "GROUP_AT_MESSAGE_CREATE":
        case "GROUP_MESSAGE_CREATE": {
            const message = decodeMessage(d);
            const groupOpenid = stringField(d, "group_openid");
            if (message === null || groupOpenid === undefined) return null;
            return { type: t, message, groupOpenid, context: { msgId: message.id } };
        }
        case "INTERACTION_CREATE":
            return decodeInteraction(d, eventId);
        case "FRIEND_ADD": {
            const userOpenid = stringField(d, "openid");
            if (userOpenid === undefined) return null;
            return {
                type: t,
                userOpenid,
                timestamp: numberField(d, "timestamp") ?? 0,
                ...(numberField(d, "scene") !== undefined
                    ? { scene: numberField(d, "scene") }
                    : {}),
                ...(stringField(d, "scene_param") !== undefined
                    ? { sceneParam: stringField(d, "scene_param") }
                    : {}),
                ...(stringField(d, "author", "union_openid") !== undefined
                    ? { unionOpenid: stringField(d, "author", "union_openid") }
                    : {}),
                ...(eventContext !== undefined ? { context: eventContext } : {}),
            };
        }
        case "FRIEND_DEL": {
            const userOpenid = stringField(d, "openid");
            if (userOpenid === undefined) return null;
            return {
                type: t,
                userOpenid,
                timestamp: numberField(d, "timestamp") ?? 0,
                ...(stringField(d, "author", "union_openid") !== undefined
                    ? { unionOpenid: stringField(d, "author", "union_openid") }
                    : {}),
            };
        }
        case "C2C_MSG_RECEIVE":
        case "C2C_MSG_REJECT": {
            const userOpenid = stringField(d, "openid");
            if (userOpenid === undefined) return null;
            return {
                type: t,
                userOpenid,
                timestamp: numberField(d, "timestamp") ?? 0,
                ...(t === "C2C_MSG_RECEIVE" && eventContext !== undefined
                    ? { context: eventContext }
                    : {}),
            };
        }
        case "GROUP_ADD_ROBOT":
        case "GROUP_DEL_ROBOT": {
            const groupOpenid = stringField(d, "group_openid");
            if (groupOpenid === undefined) return null;
            return {
                type: t,
                groupOpenid,
                ...(stringField(d, "op_member_openid") !== undefined
                    ? { opMemberOpenid: stringField(d, "op_member_openid") }
                    : {}),
                timestamp: numberField(d, "timestamp") ?? 0,
                ...(t === "GROUP_ADD_ROBOT" && eventContext !== undefined
                    ? { context: eventContext }
                    : {}),
            };
        }
        case "GROUP_MSG_RECEIVE":
        case "GROUP_MSG_REJECT": {
            const groupOpenid = stringField(d, "group_openid");
            if (groupOpenid === undefined) return null;
            return {
                type: t,
                groupOpenid,
                ...(stringField(d, "op_member_openid") !== undefined
                    ? { opMemberOpenid: stringField(d, "op_member_openid") }
                    : {}),
                timestamp: numberField(d, "timestamp") ?? 0,
                ...(t === "GROUP_MSG_RECEIVE" && eventContext !== undefined
                    ? { context: eventContext }
                    : {}),
            };
        }
        case "GROUP_MEMBER_ADD":
        case "GROUP_MEMBER_REMOVE": {
            const groupOpenid = stringField(d, "group_openid");
            const memberOpenid = stringField(d, "member_openid");
            if (groupOpenid === undefined || memberOpenid === undefined) return null;
            return {
                type: t,
                groupOpenid,
                memberOpenid,
                ...(stringField(d, "user_openid") !== undefined
                    ? { userOpenid: stringField(d, "user_openid") }
                    : {}),
                timestamp: numberField(d, "timestamp") ?? 0,
            };
        }
        case "GROUP_JOIN_REQUEST": {
            const groupOpenid = stringField(d, "group_openid");
            const joinRequestId = stringField(d, "join_request_id");
            const memberOpenid = stringField(d, "member_openid");
            if (
                groupOpenid === undefined ||
                joinRequestId === undefined ||
                memberOpenid === undefined
            )
                return null;
            return {
                type: t,
                groupOpenid,
                joinRequestId,
                memberOpenid,
                ...(stringField(d, "username") !== undefined
                    ? { username: stringField(d, "username") }
                    : {}),
                ...(stringField(d, "apply_at") !== undefined
                    ? { applyAt: stringField(d, "apply_at") }
                    : {}),
                ...(stringField(d, "apply_source") !== undefined
                    ? { applySource: stringField(d, "apply_source") }
                    : {}),
                ...(stringField(d, "invited_by") !== undefined
                    ? { invitedBy: stringField(d, "invited_by") }
                    : {}),
                ...(stringField(d, "verify_info", "verify_message") !== undefined
                    ? { verifyMessage: stringField(d, "verify_info", "verify_message") }
                    : {}),
            };
        }
        default:
            return null;
    }
}

function decodeInteraction(d: object, eventId: string | undefined): QqInteractionEvent | null {
    // Guild-scene interactions are out of scope: no guild infra.
    const scene = stringField(d, "scene");
    if (scene !== "c2c" && scene !== "group") return null;
    const id = stringField(d, "id");
    const interactionType = numberField(d, "type");
    if (id === undefined || interactionType === undefined) return null;
    return {
        type: "INTERACTION_CREATE",
        id,
        interactionType,
        scene,
        timestamp: stringField(d, "timestamp") ?? "",
        ...(stringField(d, "user_openid") !== undefined
            ? { userOpenid: stringField(d, "user_openid") }
            : {}),
        ...(stringField(d, "group_openid") !== undefined
            ? { groupOpenid: stringField(d, "group_openid") }
            : {}),
        ...(stringField(d, "group_member_openid") !== undefined
            ? { groupMemberOpenid: stringField(d, "group_member_openid") }
            : {}),
        ...(stringField(d, "data", "resolved", "button_id") !== undefined
            ? { buttonId: stringField(d, "data", "resolved", "button_id") }
            : {}),
        ...(stringField(d, "data", "resolved", "button_data") !== undefined
            ? { buttonData: stringField(d, "data", "resolved", "button_data") }
            : {}),
        ...(stringField(d, "data", "resolved", "feature_id") !== undefined
            ? { featureId: stringField(d, "data", "resolved", "feature_id") }
            : {}),
        ...(stringField(d, "data", "resolved", "message_id") !== undefined
            ? { messageId: stringField(d, "data", "resolved", "message_id") }
            : {}),
        context: { eventId: eventId ?? id },
    };
}

function decodeMessage(d: object): QqIncomingMessage | null {
    const id = stringField(d, "id");
    const content = stringField(d, "content");
    if (id === undefined || content === undefined) return null;
    return {
        id,
        content,
        timestamp: stringField(d, "timestamp") ?? "",
        messageType: numberField(d, "message_type") ?? 0,
        author: decodeUser((d as Record<string, unknown>).author),
        attachments: arrayField(d, "attachments").map(decodeAttachment),
        mentions: arrayField(d, "mentions").map(decodeUser),
        ...decodeScene((d as Record<string, unknown>).message_scene),
    };
}

function decodeUser(raw: unknown): QqEventUser {
    if (typeof raw !== "object" || raw === null) return {};
    const d = raw as Record<string, unknown>;
    return {
        ...(typeof d.id === "string" ? { id: d.id } : {}),
        ...(typeof d.username === "string" ? { username: d.username } : {}),
        ...(typeof d.bot === "boolean" ? { bot: d.bot } : {}),
        ...(typeof d.union_openid === "string" && d.union_openid !== ""
            ? { unionOpenid: d.union_openid }
            : {}),
        ...(typeof d.user_openid === "string" ? { userOpenid: d.user_openid } : {}),
        ...(typeof d.member_openid === "string" ? { memberOpenid: d.member_openid } : {}),
        ...(typeof d.member_role === "string" ? { memberRole: d.member_role } : {}),
    };
}

function decodeAttachment(raw: unknown): QqMessageAttachment {
    if (typeof raw !== "object" || raw === null) return {};
    const d = raw as Record<string, unknown>;
    return {
        ...(typeof d.url === "string" ? { url: d.url } : {}),
        ...(typeof d.filename === "string" ? { filename: d.filename } : {}),
        ...(typeof d.width === "number" ? { width: d.width } : {}),
        ...(typeof d.height === "number" ? { height: d.height } : {}),
        ...(typeof d.size === "number" ? { size: d.size } : {}),
        ...(typeof d.content_type === "string" ? { contentType: d.content_type } : {}),
        ...(typeof d.voice_wav_url === "string" ? { voiceWavUrl: d.voice_wav_url } : {}),
        ...(typeof d.asr_refer_text === "string" ? { asrReferText: d.asr_refer_text } : {}),
    };
}

function decodeScene(raw: unknown): { scene?: QqMessageScene } {
    if (typeof raw !== "object" || raw === null) return {};
    const d = raw as Record<string, unknown>;
    const ext: Record<string, string> = {};
    if (Array.isArray(d.ext))
        for (const entry of d.ext) {
            if (typeof entry !== "string") continue;
            const separator = entry.indexOf("=");
            if (separator > 0) ext[entry.slice(0, separator)] = entry.slice(separator + 1);
        }
    return {
        scene: {
            ...(typeof d.source === "string" ? { source: d.source } : {}),
            ext,
        },
    };
}

/** Read a string at a nested path, or undefined. */
function stringField(raw: object, ...path: readonly string[]): string | undefined {
    let value: unknown = raw;
    for (const key of path) {
        if (typeof value !== "object" || value === null) return undefined;
        value = (value as Record<string, unknown>)[key];
    }
    return typeof value === "string" ? value : undefined;
}

/** Read a number at a nested path, or undefined. */
function numberField(raw: object, ...path: readonly string[]): number | undefined {
    let value: unknown = raw;
    for (const key of path) {
        if (typeof value !== "object" || value === null) return undefined;
        value = (value as Record<string, unknown>)[key];
    }
    return typeof value === "number" ? value : undefined;
}

/** Read an array at a path, or []. */
function arrayField(raw: object, ...path: readonly string[]): readonly unknown[] {
    let value: unknown = raw;
    for (const key of path) {
        if (typeof value !== "object" || value === null) return [];
        value = (value as Record<string, unknown>)[key];
    }
    return Array.isArray(value) ? value : [];
}
