import assert from "node:assert/strict";
import test from "node:test";

import { decodeQqEvent } from "./events.ts";

void test("decodeQqEvent decodes a group @ message verbatim, with its reply context", () => {
    const event = decodeQqEvent({
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
            id: "msg-1",
            content: " /today ",
            group_openid: "group-1",
            timestamp: "2026-09-01T00:00:00+08:00",
            message_type: 0,
            author: { member_openid: "user-1", member_role: "admin", username: "tester" },
            mentions: [{ member_openid: "user-2" }],
            attachments: [{ content_type: "image/jpeg", url: "https://img.test/1", width: 10 }],
            message_scene: { source: "default", ext: ["msg_idx=REFIDX_abc==", "auth_token=tok"] },
        },
    });
    assert.deepEqual(event, {
        type: "GROUP_AT_MESSAGE_CREATE",
        groupOpenid: "group-1",
        context: { msgId: "msg-1" },
        message: {
            id: "msg-1",
            // Verbatim: the platform strips the @bot prefix, padding stays.
            content: " /today ",
            timestamp: "2026-09-01T00:00:00+08:00",
            messageType: 0,
            author: { memberOpenid: "user-1", memberRole: "admin", username: "tester" },
            mentions: [{ memberOpenid: "user-2" }],
            attachments: [{ contentType: "image/jpeg", url: "https://img.test/1", width: 10 }],
            scene: {
                source: "default",
                ext: { msg_idx: "REFIDX_abc==", auth_token: "tok" },
            },
        },
    });
});

void test("decodeQqEvent decodes full-mode group messages and c2c messages", () => {
    const fullMode = decodeQqEvent({
        t: "GROUP_MESSAGE_CREATE",
        d: {
            id: "msg-2",
            content: "morning",
            group_openid: "group-1",
            author: { member_openid: "user-1" },
        },
    });
    assert.deepEqual(event0(fullMode), {
        type: "GROUP_MESSAGE_CREATE",
        groupOpenid: "group-1",
        context: { msgId: "msg-2" },
    });

    const c2c = decodeQqEvent({
        t: "C2C_MESSAGE_CREATE",
        d: {
            id: "msg-3",
            content: "hi",
            message_type: 103,
            author: { user_openid: "user-9", union_openid: "" },
        },
    });
    assert.deepEqual(c2c, {
        type: "C2C_MESSAGE_CREATE",
        userOpenid: "user-9",
        context: { msgId: "msg-3" },
        message: {
            id: "msg-3",
            content: "hi",
            timestamp: "",
            messageType: 103,
            author: { userOpenid: "user-9" },
            attachments: [],
            mentions: [],
        },
    });
});

/** An event minus its message payload, for compact assertions. */
function event0(event: unknown): unknown {
    if (typeof event !== "object" || event === null) return event;
    const { message: _message, ...rest } = event as Record<string, unknown>;
    return rest;
}

void test("decodeQqEvent decodes interactions and resolves their event context", () => {
    const event = decodeQqEvent({
        id: "INTERACTION_CREATE:uuid-1",
        t: "INTERACTION_CREATE",
        d: {
            id: "uuid-1",
            type: 11,
            scene: "c2c",
            chat_type: 2,
            timestamp: "2026-07-20T21:53:54+08:00",
            user_openid: "user-1",
            data: { type: 11, resolved: { button_data: "confirm:once", button_id: "allow-once" } },
        },
    });
    assert.deepEqual(event, {
        type: "INTERACTION_CREATE",
        id: "uuid-1",
        interactionType: 11,
        scene: "c2c",
        timestamp: "2026-07-20T21:53:54+08:00",
        userOpenid: "user-1",
        buttonId: "allow-once",
        buttonData: "confirm:once",
        context: { eventId: "INTERACTION_CREATE:uuid-1" },
    });

    // Without an outer id the interaction id itself is the event reference.
    const bare = decodeQqEvent({
        t: "INTERACTION_CREATE",
        d: { id: "uuid-2", type: 12, scene: "group", group_openid: "group-1" },
    });
    assert.deepEqual(event0(bare), {
        type: "INTERACTION_CREATE",
        id: "uuid-2",
        interactionType: 12,
        scene: "group",
        timestamp: "",
        groupOpenid: "group-1",
        context: { eventId: "uuid-2" },
    });

    // Guild-scene interactions are dropped: no guild infra.
    assert.equal(
        decodeQqEvent({
            t: "INTERACTION_CREATE",
            d: { id: "uuid-3", type: 11, scene: "guild", guild_id: "g" },
        }),
        null,
    );
});

void test("decodeQqEvent decodes friend lifecycle and c2c gate events", () => {
    const added = decodeQqEvent({
        id: "event-1",
        t: "FRIEND_ADD",
        d: {
            openid: "user-1",
            timestamp: 1784570600,
            scene: 2003,
            scene_param: "callback_abc123",
            author: { union_openid: "union-1" },
        },
    });
    assert.deepEqual(added, {
        type: "FRIEND_ADD",
        userOpenid: "user-1",
        timestamp: 1784570600,
        scene: 2003,
        sceneParam: "callback_abc123",
        unionOpenid: "union-1",
        context: { eventId: "event-1" },
    });

    assert.deepEqual(
        decodeQqEvent({ t: "FRIEND_DEL", d: { openid: "user-1", timestamp: 1784570524 } }),
        { type: "FRIEND_DEL", userOpenid: "user-1", timestamp: 1784570524 },
    );

    assert.deepEqual(
        decodeQqEvent({
            id: "event-2",
            t: "C2C_MSG_RECEIVE",
            d: { openid: "user-1", timestamp: 1784570617 },
        }),
        {
            type: "C2C_MSG_RECEIVE",
            userOpenid: "user-1",
            timestamp: 1784570617,
            context: { eventId: "event-2" },
        },
    );

    assert.deepEqual(
        decodeQqEvent({
            id: "event-3",
            t: "C2C_MSG_REJECT",
            d: { openid: "user-1", timestamp: 1784570618 },
        }),
        { type: "C2C_MSG_REJECT", userOpenid: "user-1", timestamp: 1784570618 },
    );
});

void test("decodeQqEvent decodes group robot, gate, member, and join-request events", () => {
    assert.deepEqual(
        decodeQqEvent({
            id: "event-1",
            t: "GROUP_ADD_ROBOT",
            d: { group_openid: "group-1", op_member_openid: "user-1", timestamp: 1784570534 },
        }),
        {
            type: "GROUP_ADD_ROBOT",
            groupOpenid: "group-1",
            opMemberOpenid: "user-1",
            timestamp: 1784570534,
            context: { eventId: "event-1" },
        },
    );

    assert.deepEqual(
        decodeQqEvent({
            t: "GROUP_MSG_RECEIVE",
            d: { group_openid: "group-1", op_member_openid: "user-1", timestamp: 1784276800 },
        }),
        {
            type: "GROUP_MSG_RECEIVE",
            groupOpenid: "group-1",
            opMemberOpenid: "user-1",
            timestamp: 1784276800,
        },
    );

    assert.deepEqual(
        decodeQqEvent({
            t: "GROUP_MEMBER_ADD",
            d: {
                group_openid: "group-1",
                member_openid: "user-2",
                user_openid: "user-2",
                timestamp: 1784276757,
            },
        }),
        {
            type: "GROUP_MEMBER_ADD",
            groupOpenid: "group-1",
            memberOpenid: "user-2",
            userOpenid: "user-2",
            timestamp: 1784276757,
        },
    );

    assert.deepEqual(
        decodeQqEvent({
            t: "GROUP_JOIN_REQUEST",
            d: {
                group_openid: "group-1",
                join_request_id: "req-1",
                member_openid: "user-3",
                username: "applicant",
                apply_at: "2026-08-05T16:21:40+08:00",
                apply_source: "self_apply",
                verify_info: { method: "verify_message", verify_message: "let me in" },
            },
        }),
        {
            type: "GROUP_JOIN_REQUEST",
            groupOpenid: "group-1",
            joinRequestId: "req-1",
            memberOpenid: "user-3",
            username: "applicant",
            applyAt: "2026-08-05T16:21:40+08:00",
            applySource: "self_apply",
            verifyMessage: "let me in",
        },
    );
});

void test("decodeQqEvent ignores unknown types and malformed bodies", () => {
    assert.equal(decodeQqEvent({ t: "GUILD_CREATE", d: {} }), null);
    assert.equal(decodeQqEvent({ t: "GROUP_AT_MESSAGE_CREATE", d: null }), null);
    assert.equal(decodeQqEvent({ t: "GROUP_AT_MESSAGE_CREATE", d: { id: "x" } }), null);
    assert.equal(decodeQqEvent({ t: "C2C_MESSAGE_CREATE", d: { id: 1, content: "x" } }), null);
    assert.equal(
        decodeQqEvent({ t: "C2C_MESSAGE_CREATE", d: { id: "m", content: "x" } }),
        null,
        "c2c messages require the author's user_openid",
    );
    assert.equal(decodeQqEvent({ d: {} }), null);
});
