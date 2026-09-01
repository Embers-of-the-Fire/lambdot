import type { ConsoleIo } from "@lambdot/console";
import { definePlugin } from "@lambdot/core";
import type { WsConnection } from "@lambdot/websocket";

/**
 * The point of this example: one echo behavior, two services. The feature
 * declares both as its input — the console and the websocket connection —
 * subscribes to each, and replies through whichever service the input
 * arrived on. Each listener's closure knows its own reply channel; there is
 * no envelope and no routing tag.
 */
export const echo = definePlugin({
    name: "echo",
    apply(input: { console: ConsoleIo; socket: WsConnection }, scope) {
        scope.onDispose(input.console.onLine((line) => input.console.print(`echo: ${line}`)));
        scope.onDispose(input.socket.listen((data) => input.socket.push(`echo: ${data}`)));
    },
});
