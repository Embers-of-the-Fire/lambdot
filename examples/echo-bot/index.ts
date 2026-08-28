import { createKernel, definePlugin } from "@lambdot/core";
import { consoleInput, type ConsoleEvents } from "@lambdot/input-console";
import { consoleOutput, type ConsoleOutputs } from "@lambdot/output-console";

const echo = definePlugin<ConsoleEvents, ConsoleOutputs>({
    name: "echo",
    apply(ctx) {
        return ctx.on("console.line", (event) => ctx.send(event.address, `echo: ${event.payload}`));
    },
});

const kernel = createKernel().use(consoleInput()).use(consoleOutput()).use(echo);

await kernel.start();

process.on("SIGINT", () => {
    void kernel.stop().then(() => process.exit(0));
});
