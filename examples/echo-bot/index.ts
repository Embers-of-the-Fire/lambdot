import { consolePlatform, type ConsoleEvents, type ConsoleOutputs } from "@lambdot/console";
import { createKernel, definePlugin } from "@lambdot/core";

const echo = definePlugin<ConsoleEvents, ConsoleOutputs>({
    name: "echo",
    apply(ctx) {
        return ctx.on("console.line", (event) => ctx.send(event.address, `echo: ${event.payload}`));
    },
});

const cli = consolePlatform();

const kernel = createKernel().use(cli.input).use(cli.output).use(echo);

await kernel.start();

process.on("SIGINT", () => {
    void kernel.stop().then(() => process.exit(0));
});
