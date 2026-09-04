import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import type { KVNamespace } from "./index.ts";
import { d1Database, envVars, kvNamespace, r2Bucket } from "./index.ts";

void test("binding providers emit the binding as-is", async () => {
    const kv = { get: async () => null } as unknown as KVNamespace;
    const scope = createScope();
    assert.equal(await kvNamespace("cache").apply(undefined, scope, { binding: kv }), kv);

    const db = { prepare: () => ({}) };
    assert.equal(
        await d1Database("db").apply(undefined, scope, {
            binding: db as never,
        }),
        db,
    );

    const bucket = { get: async () => null };
    assert.equal(
        await r2Bucket("uploads").apply(undefined, scope, { binding: bucket as never }),
        bucket,
    );
    await scope.dispose();
});

void test("envVars reads a typed snapshot from the worker bindings", async () => {
    const scope = createScope();
    const snapshot = await envVars("bot-env", ["TOKEN", "REGION"]).apply(undefined, scope, {
        source: { TOKEN: "secret", REGION: "earth", PINGS: {} },
    });
    assert.deepEqual(snapshot, { TOKEN: "secret", REGION: "earth" });
    await scope.dispose();
});

void test("envVars fails loudly on missing, empty, or non-string vars", async () => {
    const plugin = envVars("bot-env", ["TOKEN"]);
    await assert.rejects(async () => {
        await plugin.apply(undefined, createScope(), { source: {} });
    }, /"TOKEN" is not set/);
    await assert.rejects(async () => {
        await plugin.apply(undefined, createScope(), { source: { TOKEN: "" } });
    }, /"TOKEN" is not set/);
    await assert.rejects(async () => {
        await plugin.apply(undefined, createScope(), { source: { TOKEN: 42 } });
    }, /"TOKEN" is not set/);
});
