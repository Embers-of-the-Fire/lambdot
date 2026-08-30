import type { Plugin } from "@lambdot/core";
import { definePlugin, pumpStream } from "@lambdot/core";

import type { QqApi } from "./api.ts";
import type { QqCommandStream } from "./events.ts";

/**
 * The output half of the qq platform: consumes a command stream and sends
 * each command as plain text (msg_type 0) through the REST client. Sending
 * is transport-independent — the gateway and webhook infras share this
 * output. Terminal: wire it last, after the features it consumes.
 */
export function qqOutput<const TName extends string>(
    name: TName,
): Plugin<{ api: QqApi; commands: QqCommandStream }, void, void, TName> {
    return definePlugin({
        name,
        apply(input, scope) {
            const { api } = input;
            scope.onDispose(
                pumpStream(
                    input.commands,
                    (cmd) => api.sendMessage(cmd.address, cmd.content),
                    (error) => scope.onError(error),
                ),
            );
        },
    });
}
