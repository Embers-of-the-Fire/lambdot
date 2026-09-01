import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import type { DurableObjectStorage } from "./index.ts";
import { doStorage, wsHub } from "./index.ts";

void test("doStorage emits the instance storage as-is", async () => {
    const storage = {
        get: async <T>(_key: string) => undefined as T | undefined,
        put: async () => {},
        delete: async () => true,
    } as DurableObjectStorage;
    const scope = createScope();
    assert.equal(await doStorage().apply(undefined, scope, { storage }), storage);
    await scope.dispose();
});

class FakeSocket {
    readonly sent: string[] = [];
    accepted = false;
    private readonly listeners: Record<string, Array<(event: { data: unknown }) => void>> = {};

    accept(): void {
        this.accepted = true;
    }

    addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
        const listeners = this.listeners[type] ?? [];
        listeners.push(listener);
        this.listeners[type] = listeners;
    }

    send(data: string): void {
        this.sent.push(data);
    }

    emitMessage(data: unknown): void {
        for (const listener of this.listeners["message"] ?? []) listener({ data });
    }

    emitClose(): void {
        for (const listener of this.listeners["close"] ?? []) listener({ data: undefined });
    }
}

void test("wsHub fans out pushes and listens across accepted sockets", async () => {
    const { hub, plugin } = wsHub("room");
    const scope = createScope();
    const emitted = await plugin.apply(undefined, scope, { url: "https://room.test/" });
    assert.equal(emitted, hub as unknown);
    assert.equal(hub.url, "https://room.test/");

    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.accept(a as never);
    hub.accept(b as never);
    assert.equal(a.accepted, true);

    hub.push("broadcast");
    assert.deepEqual(a.sent, ["broadcast"]);
    assert.deepEqual(b.sent, ["broadcast"]);

    const received: string[] = [];
    const unsubscribe = hub.listen((data) => received.push(data));
    a.emitMessage("from a");
    b.emitMessage("from b");
    a.emitMessage(new Uint8Array([1])); // non-string frames are dropped
    assert.deepEqual(received, ["from a", "from b"]);

    void unsubscribe();
    a.emitMessage("ignored");
    assert.deepEqual(received, ["from a", "from b"]);

    // a closed socket leaves the fan-out set
    b.emitClose();
    hub.push("after close");
    assert.deepEqual(b.sent, ["broadcast"]);

    await scope.dispose();
});
