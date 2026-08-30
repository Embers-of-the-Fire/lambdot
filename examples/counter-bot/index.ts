import { consolePlatform, type ConsoleLine } from "@lambdot/console";
import type { StateBackend, Stream } from "@lambdot/core";
import { createKernel, createStateAccessor, definePlugin, mapStream } from "@lambdot/core";
import { memoryState } from "@lambdot/state-memory";

interface CounterSchema {
    count: number;
}

const counter = definePlugin({
    name: "counter",
    apply(input: { "console/lines": Stream<ConsoleLine>; state: StateBackend }) {
        const state = createStateAccessor<CounterSchema>(input.state, "counter");
        return mapStream(input["console/lines"], async (event) => {
            const count = ((await state.get("count")) ?? 0) + 1;
            await state.set("count", count);
            return { address: event.address, content: `#${count}: ${event.payload}` };
        });
    },
});

const cli = consolePlatform();

const kernel = createKernel()
    .use(cli.lines)
    .use(memoryState())
    // identity wiring: counter's inputs match the visible ctx
    .use(counter)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.counter }) });

await kernel.start();
