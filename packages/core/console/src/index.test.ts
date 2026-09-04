import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { createScope } from "@lambdot/core";

import { consoleIo } from "./index.ts";

function sink(): { stream: Writable; written: string[] } {
    const written: string[] = [];
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            written.push(String(chunk));
            callback();
        },
    });
    return { stream, written };
}

void test("consoleIo delivers stdin lines to listeners and unsubscribes on disposer", async () => {
    const input = new Readable({ read() {} });
    const stdout = sink();
    const scope = createScope();
    const io = await consoleIo().apply(undefined, scope, {
        input,
        stdout: stdout.stream,
        stderr: sink().stream,
    });

    const lines: string[] = [];
    const unsubscribe = io.onLine((line) => lines.push(line));
    input.push("hello\nworld\n");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(lines, ["hello", "world"]);

    void unsubscribe();
    input.push("ignored\n");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(lines, ["hello", "world"]);

    await scope.dispose();
});

void test("consoleIo print writes to stdout by default and stderr on request", async () => {
    const stdout = sink();
    const stderr = sink();
    const scope = createScope();
    const io = await consoleIo().apply(undefined, scope, {
        input: new Readable({ read() {} }),
        stdout: stdout.stream,
        stderr: stderr.stream,
    });

    io.print("out");
    io.print("err", "stderr");
    assert.deepEqual(stdout.written, ["out\n"]);
    assert.deepEqual(stderr.written, ["err\n"]);

    await scope.dispose();
});
