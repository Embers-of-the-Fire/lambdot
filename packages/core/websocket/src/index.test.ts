import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import { wsConnection, type WebSocketLike } from "./index.ts";

class FakeSocket implements WebSocketLike {
    readonly sent: string[] = [];
    closed = false;
    private readonly openListeners: Array<(event: { data: unknown }) => void> = [];
    private readonly errorListeners: Array<(event: { data: unknown }) => void> = [];
    private readonly messageListeners: Array<(event: { data: unknown }) => void> = [];

    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
        if (type === "open") this.openListeners.push(listener);
        else if (type === "error") this.errorListeners.push(listener);
        else if (type === "message") this.messageListeners.push(listener);
    }

    removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
        if (type !== "message") return;
        const index = this.messageListeners.indexOf(listener);
        if (index >= 0) this.messageListeners.splice(index, 1);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
    }

    emitOpen(): void {
        for (const listener of this.openListeners) listener({ data: undefined });
    }

    emitError(): void {
        for (const listener of this.errorListeners) listener({ data: undefined });
    }

    emitMessage(data: unknown): void {
        for (const listener of this.messageListeners) listener({ data });
    }
}

void test("wsConnection opens, echoes pushes, listens, and closes with the scope", async () => {
    const socket = new FakeSocket();
    const scope = createScope();
    const pending = wsConnection("socket").apply(undefined, scope, {
        url: "wss://example.test/ws",
        create: () => socket,
    });
    socket.emitOpen();
    const connection = await pending;

    assert.equal(connection.url, "wss://example.test/ws");

    const received: string[] = [];
    const unsubscribe = connection.listen((data) => received.push(data));
    socket.emitMessage("hello");
    socket.emitMessage(new Uint8Array([1, 2])); // binary frames are dropped
    assert.deepEqual(received, ["hello"]);

    connection.push("hi");
    assert.deepEqual(socket.sent, ["hi"]);

    void unsubscribe();
    socket.emitMessage("ignored");
    assert.deepEqual(received, ["hello"]);

    assert.equal(socket.closed, false);
    await scope.dispose();
    assert.equal(socket.closed, true);
});

void test("wsConnection fails the application when the socket errors before open", async () => {
    const socket = new FakeSocket();
    const scope = createScope();
    const pending = wsConnection("socket").apply(undefined, scope, {
        url: "wss://example.test/ws",
        create: () => socket,
    });
    socket.emitError();
    await assert.rejects(async () => {
        await pending;
    }, /failed to connect/);
});
