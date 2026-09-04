import assert from "node:assert/strict";
import test from "node:test";

import { decodeMessageEvent } from "./events.ts";

void test("decodeMessageEvent decodes a group message", () => {
    const decoded = decodeMessageEvent("GROUP_AT_MESSAGE_CREATE", {
        id: "msg-1",
        content: "  hello  ",
        group_openid: "group-1",
        timestamp: "2026-09-01T00:00:00Z",
        author: { member_openid: "user-1" },
    });
    assert.deepEqual(decoded, {
        message: {
            id: "msg-1",
            content: "hello",
            authorOpenid: "user-1",
            timestamp: "2026-09-01T00:00:00Z",
        },
        address: { scope: "group", openid: "group-1", msgId: "msg-1" },
    });
});

void test("decodeMessageEvent decodes a c2c message", () => {
    const decoded = decodeMessageEvent("C2C_MESSAGE_CREATE", {
        id: "msg-2",
        content: "hi",
        author: { user_openid: "user-2" },
    });
    assert.deepEqual(decoded, {
        message: { id: "msg-2", content: "hi", authorOpenid: "user-2", timestamp: "" },
        address: { scope: "c2c", openid: "user-2", msgId: "msg-2" },
    });
});

void test("decodeMessageEvent ignores unknown types and malformed bodies", () => {
    assert.equal(decodeMessageEvent("SOMETHING_ELSE", {}), null);
    assert.equal(decodeMessageEvent("GROUP_AT_MESSAGE_CREATE", null), null);
    assert.equal(decodeMessageEvent("GROUP_AT_MESSAGE_CREATE", { id: "x" }), null);
    assert.equal(decodeMessageEvent("C2C_MESSAGE_CREATE", { id: 1, content: "x" }), null);
});
