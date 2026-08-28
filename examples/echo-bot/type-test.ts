/**
 * Compile-time assertions for the kernel's generic fold. Run by `typecheck`;
 * every `@ts-expect-error` must stay a genuine error.
 */
import { createKernel, definePlugin } from "@lambdot/core";
import { consoleInput, type ConsoleEvents } from "@lambdot/input-console";
import { consoleOutput, type ConsoleAddress, type ConsoleOutputs } from "@lambdot/output-console";

const echo = definePlugin<ConsoleEvents, ConsoleOutputs>({
    name: "echo",
    apply(ctx) {
        return ctx.on("console.line", (event) => {
            // payload is typed string
            const text: string = event.payload;
            // address is typed ConsoleAddress
            const address: ConsoleAddress = event.address;
            return ctx.send(address, `echo: ${text}`);
        });
    },
});

const kernel = createKernel().use(consoleInput()).use(consoleOutput()).use(echo);

// send rejects content that doesn.t match the platform's contract
void kernel.ctx.send({ platform: "console", target: "stdout" }, "ok");
// @ts-expect-error console content is string, not an object
void kernel.ctx.send({ platform: "console", target: "stdout" }, { text: "nope" });

// send rejects addresses of unregistered platforms
// @ts-expect-error no "discord" output is registered
void kernel.ctx.send({ platform: "discord", channel: "123" }, "hello");

// handlers can only subscribe to registered event kinds
// @ts-expect-error "message.create" was never registered by an input
void kernel.ctx.on("message.create", () => {});

// state is unavailable when no plugin declared a schema
// @ts-expect-error ctx.state is NoStateDeclared — stateless by default
void kernel.ctx.state.for("echo");

// registration order is enforced: echo needs console.line + console output
// @ts-expect-error unregistered event kinds / output platforms
void createKernel().use(echo);

// registering the output before the input still gates on the missing kind
// @ts-expect-error unregistered event kinds
void createKernel().use(consoleOutput()).use(echo);
