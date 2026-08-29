import { consolePlatform, type ConsoleEvents, type ConsoleOutputs } from "@lambdot/console";
import { createKernel, definePlugin } from "@lambdot/core";
import { memoryState } from "@lambdot/state-memory";

interface CounterSchema {
    count: number;
}

const counter = definePlugin<ConsoleEvents, ConsoleOutputs, CounterSchema>({
    name: "counter",
    inject: ["state"],
    apply(ctx) {
        return ctx.on("console.line", async (event) => {
            const state = ctx.state.for("counter");
            const count = ((await state.get("count")) ?? 0) + 1;
            await state.set("count", count);
            await ctx.send(event.address, `#${count}: ${event.payload}`);
        });
    },
});

const cli = consolePlatform();

const kernel = createKernel().use(cli.input).use(cli.output).use(memoryState()).use(counter);

await kernel.start();
