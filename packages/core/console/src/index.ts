import { createInterface } from "node:readline/promises";

import type { Address, Command, Message, Plugin, Stream } from "@lambdot/core";
import { channel, definePlugin, message, pumpStream, shareStream } from "@lambdot/core";

/**
 * Where a console message goes. Owned by the printer half of the console
 * platform — printers consume addresses, line sources produce them.
 */
export interface ConsoleAddress extends Address<"console"> {
    readonly target: "stdout" | "stderr";
}

/** One line read from stdin. */
export type ConsoleLine = Message<string, ConsoleAddress>;

/** One line to print: plain text to a console target. */
export type ConsoleReply = Command<ConsoleAddress, string>;

/** The input half of the console platform: a stream of lines read from stdin. */
export function consoleLines(): Plugin<void, Stream<ConsoleLine>, void, "console/lines"> {
    return definePlugin({
        name: "console/lines",
        apply(_input, scope) {
            const lines = channel<ConsoleLine>();
            const rl = createInterface({ input: process.stdin, terminal: false });
            rl.on("line", (line) => {
                lines.push(message(line, { platform: "console", target: "stdout" }));
            });
            scope.onDispose(() => {
                rl.close();
                lines.close();
            });
            // Shared: several consumers (features, loggers, supervisors) may
            // each subscribe to the line stream.
            return shareStream(lines.stream);
        },
    });
}

/** The output half of the console platform: prints a reply stream to stdout/stderr. */
export function consolePrinter(): Plugin<
    { replies: Stream<ConsoleReply> },
    void,
    void,
    "console/printer"
> {
    return definePlugin({
        name: "console/printer",
        apply(input, scope) {
            scope.onDispose(
                pumpStream(
                    input.replies,
                    ({ address, content }) => {
                        const stream =
                            address.target === "stderr" ? process.stderr : process.stdout;
                        stream.write(`${content}\n`);
                    },
                    (error) => scope.onError(error),
                ),
            );
        },
    });
}

/**
 * One console platform, bundled: the stdin line source and the stdout/stderr
 * printer. The printer is terminal — it consumes a reply stream produced by
 * later feature plugins, so it is wired last with a mapping:

 * ```ts
 * const cli = consolePlatform();
 * createKernel()
 *     .use(cli.lines)
 *     .use(echo)
 *     .use(cli.printer, { mapping: (ctx) => ({ replies: ctx.echo }) });
 * ```
 */
export interface ConsolePlatform {
    readonly lines: Plugin<void, Stream<ConsoleLine>, void, "console/lines">;
    readonly printer: Plugin<{ replies: Stream<ConsoleReply> }, void, void, "console/printer">;
}

/** Build a whole console platform (stdin lines + stdout/stderr printer). */
export function consolePlatform(): ConsolePlatform {
    return {
        lines: consoleLines(),
        printer: consolePrinter(),
    };
}
