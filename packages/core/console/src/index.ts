import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { Disposer, Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

/**
 * The console service, emitted as the plugin's item map: stdin lines in,
 * stdout/stderr writes out. Consumers subscribe to lines and print text;
 * where the streams actually go is the plugin's config, not the consumer's.
 */
export interface ConsoleIo {
    /** Subscribe to lines read from stdin. The disposer unsubscribes. */
    onLine(listener: (line: string) => void): Disposer;
    /** Write one line (a trailing newline is added) to a console target. */
    print(text: string, target?: "stdout" | "stderr"): void;
}

/** Config for {@link consoleIo}: the streams behind the service. */
export interface ConsoleIoConfig {
    /** Line source; defaults to `process.stdin`. */
    readonly input?: Readable;
    /** Defaults to `process.stdout`. */
    readonly stdout?: Writable;
    /** Defaults to `process.stderr`. */
    readonly stderr?: Writable;
}

/**
 * The console as an ordinary plugin: read stdin line by line, write to
 * stdout/stderr. A terminal needs no external service, so this is where the
 * framework's contracts are exercised first. The readline interface closes
 * when the owning scope disposes.
 *
 * ```ts
 * const echo = definePlugin({
 *     name: "echo",
 *     apply(input: { console: ConsoleIo }, scope) {
 *         scope.onDispose(input.console.onLine((line) => input.console.print(`echo: ${line}`)));
 *     },
 * });
 *
 * app.with(consoleIo(), { option: {} }).use(echo);
 * ```
 */
export function consoleIo(): Plugin<void, ConsoleIo, ConsoleIoConfig, "console"> {
    return definePlugin({
        name: "console",
        apply(_input, scope, config) {
            const stdout = config.stdout ?? process.stdout;
            const stderr = config.stderr ?? process.stderr;
            const rl = createInterface({
                input: config.input ?? process.stdin,
                terminal: false,
            });
            scope.onDispose(() => {
                rl.close();
            });
            return {
                onLine(listener) {
                    rl.on("line", listener);
                    return () => {
                        rl.off("line", listener);
                    };
                },
                print(text, target = "stdout") {
                    (target === "stderr" ? stderr : stdout).write(`${text}\n`);
                },
            };
        },
    });
}
