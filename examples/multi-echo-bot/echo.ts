import type { BotEvent } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";
import type { ConsoleEvents } from "@lambdot/input-console";
import type { ConsoleAddress, ConsoleOutputs } from "@lambdot/output-console";

import type { EchoEvents, EchoOutputs, WsEchoAddress } from "./echo-spec.ts";

/**
 * The point of this example: one echo behavior, two platforms. The feature
 * declares the union of both platforms' event kinds and output contracts;
 * the kernel's type fold checks at `use()` time that all four platform
 * halves were registered first.
 *
 * The handler is platform-agnostic because the envelope carries its own
 * return address: `ctx.send(event.address, ...)` routes back through
 * whichever output owns the address's `platform` tag. `ContentFor`
 * distributes over the address union, so `send` type-checks for both
 * platforms through the same handler (both contracts accept `string`).
 */
export const echo = definePlugin<ConsoleEvents & EchoEvents, ConsoleOutputs & EchoOutputs>({
    name: "echo",
    apply(ctx) {
        function reply(event: BotEvent<string, string, ConsoleAddress | WsEchoAddress>) {
            return ctx.send(event.address, `echo: ${event.payload}`);
        }

        return [ctx.on("console.line", reply), ctx.on("wsecho.message", reply)];
    },
});
