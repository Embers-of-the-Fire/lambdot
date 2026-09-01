/**
 * Where a qq message goes. `msgId`/`msgSeq` carry the passive-reply
 * reference (`msg_id`/`msg_seq`) from the triggering message; omit both for
 * an active (proactive) message.
 */
export interface QqAddress {
    /** Which conversation the message belongs to. */
    readonly scope: "group" | "c2c";
    /** `group_openid` for groups, the user's openid for C2C. */
    readonly openid: string;
    /** Passive-reply reference, from the triggering event's `d.id`. */
    readonly msgId?: string;
    /** Passive-reply sequence; auto-incremented per reply when omitted. */
    readonly msgSeq?: number;
}

/** One decoded qq message: plain-text content only. */
export interface QqMessage {
    /** Message id (`msg_id`), reused as the passive-reply reference. */
    readonly id: string;
    readonly content: string;
    readonly authorOpenid: string;
    readonly timestamp: string;
}

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
 * Decode a dispatch (`t`, `d`) pair into a message and its reply address,
 * or null to ignore it.
 */
export function decodeMessageEvent(
    t: string,
    d: unknown,
): { message: QqMessage; address: QqAddress } | null {
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
            message: {
                id: raw.id,
                // The platform strips the @bot prefix but leaves padding.
                content: raw.content.trim(),
                authorOpenid: raw.author.member_openid,
                timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
            },
            address: {
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
            message: {
                id: raw.id,
                content: raw.content.trim(),
                authorOpenid: raw.author.user_openid,
                timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
            },
            address: {
                scope: "c2c",
                openid: raw.author.user_openid,
                msgId: raw.id,
            },
        };
    }

    return null;
}
