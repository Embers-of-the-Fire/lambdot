import { createInterface } from "node:readline/promises";

import type { Address, EventDef, InputPlugin, OutputContract, OutputPlugin } from "@lambdot/core";

/**
 * Where a console message goes. Owned by the output half of the console
 * platform pair — outputs consume addresses, inputs produce them.
 */
export interface ConsoleAddress extends Address<"console"> {
    readonly target: "stdout" | "stderr";
}

/** The console platform's output contract: plain text. */
export type ConsoleOutputs = {
    console: OutputContract<ConsoleAddress, string>;
};

/**
 * Events produced by the console input: one per line read from stdin.
 * A type alias (not an interface extending `EventMap`) so `keyof` stays
 * exactly these kinds — an interface extending `Record` would inherit a
 * string index signature and make every kind subscribable.
 */
export type ConsoleEvents = {
    "console.line": EventDef<string, ConsoleAddress>;
};

/** The input half of the console platform: one `console.line` event per line read from stdin. */
export function consoleInput(): InputPlugin<ConsoleEvents, void, "console-input"> {
    return {
        role: "input",
        name: "console-input",
        apply(ctx) {
            const rl = createInterface({ input: process.stdin, terminal: false });
            rl.on("line", (line) => {
                void ctx.ingest("console.line", line, { platform: "console", target: "stdout" });
            });
            return () => {
                rl.close();
            };
        },
    };
}

/** The output half of the console platform: writes plain text to stdout or stderr. */
export function consoleOutput(): OutputPlugin<
    "console",
    ConsoleAddress,
    string,
    void,
    "console-output"
> {
    return {
        role: "output",
        name: "console-output",
        platform: "console",
        send(to, content) {
            const stream = to.target === "stderr" ? process.stderr : process.stdout;
            stream.write(`${content}\n`);
        },
    };
}

/**
 * One console platform, bundled: the stdin input and stdout/stderr output
 * halves. The pair stays separate (rather than one fused plugin) so the
 * type fold can keep enforcing registration order — input and output before
 * the feature plugins that consume them.
 *
 * ```ts
 * const cli = consolePlatform();
 * createKernel()
 *     .use(cli.input)
 *     .use(cli.output);
 * ```
 */
export interface ConsolePlatform {
    readonly input: InputPlugin<ConsoleEvents, void, "console-input">;
    readonly output: OutputPlugin<"console", ConsoleAddress, string, void, "console-output">;
}

/** Build a whole console platform (stdin input + stdout/stderr output). */
export function consolePlatform(): ConsolePlatform {
    return {
        input: consoleInput(),
        output: consoleOutput(),
    };
}
