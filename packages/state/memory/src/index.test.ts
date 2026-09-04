import assert from "node:assert/strict";
import test from "node:test";

import { createScope } from "@lambdot/core";

import { memoryState } from "./index.ts";

void test("memoryState emits a usable plain Map", async () => {
    const scope = createScope();
    const state = await memoryState().apply(undefined, scope, undefined);
    state.set("count", 1);
    assert.equal(state.get("count"), 1);
    await scope.dispose();
});

void test("each application starts from an independent empty map", async () => {
    const plugin = memoryState();
    const first = await plugin.apply(undefined, createScope(), undefined);
    first.set("key", "value");
    const second = await plugin.apply(undefined, createScope(), undefined);
    assert.equal(second.get("key"), undefined);
    assert.notEqual(first, second);
});
