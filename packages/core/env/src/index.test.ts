import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import { envVars } from "./index.ts";

void test("envVars snapshots the requested variables", async () => {
    process.env.LAMBDOT_TEST_A = "alpha";
    process.env.LAMBDOT_TEST_B = "beta";
    try {
        const snapshot = await envVars("test-env", ["LAMBDOT_TEST_A", "LAMBDOT_TEST_B"]).apply(
            undefined,
            createScope(),
            undefined,
        );
        assert.deepEqual(snapshot, { LAMBDOT_TEST_A: "alpha", LAMBDOT_TEST_B: "beta" });
    } finally {
        delete process.env.LAMBDOT_TEST_A;
        delete process.env.LAMBDOT_TEST_B;
    }
});

void test("envVars fails loudly on missing or empty variables", async () => {
    delete process.env.LAMBDOT_TEST_MISSING;
    const plugin = envVars("test-env", ["LAMBDOT_TEST_MISSING"]);
    await assert.rejects(async () => {
        await plugin.apply(undefined, createScope(), undefined);
    }, /"LAMBDOT_TEST_MISSING" is not set/);

    process.env.LAMBDOT_TEST_EMPTY = "";
    try {
        const emptyPlugin = envVars("test-env", ["LAMBDOT_TEST_EMPTY"]);
        await assert.rejects(async () => {
            await emptyPlugin.apply(undefined, createScope(), undefined);
        }, /"LAMBDOT_TEST_EMPTY" is not set/);
    } finally {
        delete process.env.LAMBDOT_TEST_EMPTY;
    }
});
