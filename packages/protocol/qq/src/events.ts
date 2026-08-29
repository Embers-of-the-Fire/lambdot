import type { Address, EventDef, OutputContract } from "@lambdot/core";

/**
 * Where a qq message goes. Owned by the output half of the qq platform —
 * outputs consume addresses, inputs produce them. `msgId`/`msgSeq` carry the
 * passive-reply reference (`msg_id`/`msg_seq`) from the triggering message;
 * omit both for an active (proactive) message.
 */
export interface QqAddress extends Address<"qq"> {
    /** Which conversation the message belongs to. */
    readonly scope: "group" | "c2c";
    /** `group_openid` for groups, the user's openid for C2C. */
    readonly openid: string;
    /** Passive-reply reference, from the triggering event's `d.id`. */
    readonly msgId?: string;
    /** Passive-reply sequence; the output auto-increments it per reply. */
    readonly msgSeq?: number;
}

/** The payload produced by qq message events: plain-text content only. */
export interface QqMessage {
    /** Message id (`msg_id`), reused as the passive-reply reference. */
    readonly id: string;
    readonly content: string;
    readonly authorOpenid: string;
    readonly timestamp: string;
}

/**
 * Events produced by qq inputs (gateway and webhook alike): one kind per
 * conversation scope. A type alias (not an interface extending `EventMap`)
 * so `keyof` stays exactly these kinds.
 */
export type QqEvents = {
    "qq.group-message": EventDef<QqMessage, QqAddress>;
    "qq.c2c-message": EventDef<QqMessage, QqAddress>;
};

/** The qq platform's output contract: plain text (msg_type 0). */
export type QqOutputs = {
    qq: OutputContract<QqAddress, string>;
};

/** The wire shape of a `GROUP_AT_MESSAGE_CREATE` dispatch body. */
interface QqRawGroupMessage {
    id?: unknown;
    content?: unknown;
    group_openid?: unknown;
    timestamp?: unknown;
    author?: { member_openid?: unknown };
}

/** The wire shape of a `C2C_MESSAGE_CREATE` dispatch body. */
interface QqRawC2cMessage {
    id?: unknown;
    content?: unknown;
    timestamp?: unknown;
    author?: { user_openid?: unknown };
}

/**
 * Decode a dispatch (`t`, `d`) pair into an ingestible event, or null to
 * ignore it. Shared by the gateway and webhook inputs — both transports
 * deliver the same `{op, t, d}` envelope.
 */
export function decodeMessageEvent(
    t: string,
    d: unknown,
): { kind: keyof QqEvents; payload: QqMessage; address: QqAddress } | null {
    if (typeof d !== "object" || d === null) return null;

    if (t === "GROUP_AT_MESSAGE_CREATE") {
        const raw = d as QqRawGroupMessage;
        if (
            typeof raw.id !== "string" ||
            typeof raw.content !== "string" ||
            typeof raw.group_openid !== "string" ||
            typeof raw.author?.member_openid !== "string"
        )
            return null;
        return {
            kind: "qq.group-message",
            payload: {
                id: raw.id,
                // The platform strips the @bot prefix but leaves padding.
                content: raw.content.trim(),
                authorOpenid: raw.author.member_openid,
                timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
            },
            address: {
                platform: "qq",
                scope: "group",
                openid: raw.group_openid,
                msgId: raw.id,
            },
        };
    }

    if (t === "C2C_MESSAGE_CREATE") {
        const raw = d as QqRawC2cMessage;
        if (
            typeof raw.id !== "string" ||
            typeof raw.content !== "string" ||
            typeof raw.author?.user_openid !== "string"
        )
            return null;
        return {
            kind: "qq.c2c-message",
            payload: {
                id: raw.id,
                content: raw.content.trim(),
                authorOpenid: raw.author.user_openid,
                timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
            },
            address: {
                platform: "qq",
                scope: "c2c",
                openid: raw.author.user_openid,
                msgId: raw.id,
            },
        };
    }

    return null;
}
