import assert from "node:assert/strict";
import test from "node:test";

import type { Disposer, Scope } from "./index.ts";
import { createKernel, definePlugin } from "./index.ts";

function makeScope(disposers: Disposer[]): Scope {
    return {
        onDispose: (disposer) => {
            disposers.push(disposer);
        },
        onError: () => {},
    };
}

void test("engine.apply activates the chain and returns its visible context", async () => {
    const greet = definePlugin<void, string>({
        name: "greet",
        apply: () => "hello",
    });
    const engine = createKernel().use(greet).expose("greeter");

    const disposers: Disposer[] = [];
    const output = await engine.apply(undefined, makeScope(disposers), undefined);
    assert.deepEqual(output, { greet: "hello" });
    assert.deepEqual(engine.ctx, { greet: "hello" });

    // Applying the engine registered its teardown with the caller's scope.
    for (const dispose of disposers.splice(0)) await dispose();
    assert.deepEqual(engine.ctx, {});
});

void test("engine.apply feeds the external input through the chain", async () => {
    const echo = definePlugin<{ value: string }, string>({
        name: "echo",
        apply: (input) => input.value.toUpperCase(),
    });
    const engine = createKernel()
        .use(echo, { mapping: (ctx) => ctx as unknown as { value: string } })
        .expose("upper");

    const output = await engine.apply({ value: "hi" } as unknown as void, makeScope([]), undefined);
    assert.deepEqual(output, { echo: "HI" });
});
