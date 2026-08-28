import type { Address, OutputContract, OutputPlugin } from "@lambdot/core";

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
