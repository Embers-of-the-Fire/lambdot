import type { ConsoleLine } from "@lambdot/console";
import type { Message, Stream } from "@lambdot/core";
import { definePlugin, mapStream, mergeStreams } from "@lambdot/core";

import type { WsEchoAddress } from "./echo-spec.ts";

/**
 * The point of this example: one echo behavior, two platforms. The feature
 * declares both platforms' message streams as its input and merges them into
 * one command stream; each output filters the commands back down to its own
 * platform tag at wiring time.
 *
 * The handler is platform-agnostic because the envelope carries its own
 * return address: the command's `address` routes the reply back through
 * whichever output claims the address's `platform` tag.
 */
export const echo = definePlugin({
    name: "echo",
    apply(input: {
        "console/lines": Stream<ConsoleLine>;
        wsecho: Stream<Message<string, WsEchoAddress>>;
    }) {
        function reply(event: Message<string, ConsoleLine["address"] | WsEchoAddress>) {
            return { address: event.address, content: `echo: ${event.payload}` };
        }

        return mergeStreams(
            mapStream(input["console/lines"], reply),
            mapStream(input.wsecho, reply),
        );
    },
});
