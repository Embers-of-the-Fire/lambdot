import { consolePlatform, type ConsoleLine } from "@lambdot/console";
import type { Stream } from "@lambdot/core";
import { createKernel, definePlugin, mapStream } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { "console/lines": Stream<ConsoleLine> }) {
        return mapStream(input["console/lines"], (event) => ({
            address: event.address,
            content: `echo: ${event.payload}`,
        }));
    },
});

const cli = consolePlatform();

const kernel = createKernel()
    .use(cli.lines)
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo)
    .bind(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });

await kernel.start();

process.on("SIGINT", () => {
    void kernel.stop().then(() => process.exit(0));
});
