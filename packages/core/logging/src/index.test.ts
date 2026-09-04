import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import type { LogRecord } from "./index.ts";
import { consoleLogger, formatLogRecord, loggerFrom } from "./index.ts";

void test("loggerFrom stamps records with level, message, timestamp, and data", () => {
    const records: LogRecord[] = [];
    const log = loggerFrom((record) => records.push(record));
    log.debug("d", { n: 1 });
    log.info("i");
    log.warn("w");
    log.error("e", "extra");
    assert.deepEqual(
        records.map((r) => [r.level, r.message]),
        [
            ["debug", "d"],
            ["info", "i"],
            ["warn", "w"],
            ["error", "e"],
        ],
    );
    assert.equal(records[0]!.data && (records[0]!.data as { n: number }).n, 1);
    assert.equal(records[3]!.data, "extra");
    for (const record of records) assert.equal(typeof record.timestamp, "number");
});

void test("formatLogRecord renders time, level, message, and json data", () => {
    const line = formatLogRecord({
        level: "warn",
        message: "careful",
        timestamp: Date.UTC(2026, 8, 1),
        data: { code: 42 },
    });
    assert.equal(line, `2026-09-01T00:00:00.000Z WARN careful {"code":42}`);
});

void test("formatLogRecord tolerates unserializable data", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const line = formatLogRecord({
        level: "error",
        message: "boom",
        timestamp: Date.UTC(2026, 8, 1),
        data: circular,
    });
    assert.equal(line, "2026-09-01T00:00:00.000Z ERROR boom [unserializable]");
});

void test("consoleLogger prints warn/error to stderr and debug/info to stdout", async () => {
    const writes: { stream: string; text: string }[] = [];
    const originalOut = process.stdout.write.bind(process.stdout);
    const originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown) => {
        writes.push({ stream: "stdout", text: String(chunk) });
        return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
        writes.push({ stream: "stderr", text: String(chunk) });
        return true;
    }) as typeof process.stderr.write;
    try {
        const scope = createScope();
        const log = await consoleLogger().apply(undefined, scope, undefined);
        log.info("hello");
        log.error("bad");
        await scope.dispose();
    } finally {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
    }
    assert.equal(writes.length, 2);
    assert.equal(writes[0]!.stream, "stdout");
    assert.match(writes[0]!.text, /INFO hello\n$/);
    assert.equal(writes[1]!.stream, "stderr");
    assert.match(writes[1]!.text, /ERROR bad\n$/);
});
