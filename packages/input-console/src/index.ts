import { createInterface } from "node:readline/promises";

import type { EventDef, InputPlugin } from "@lambdot/core";
import type { ConsoleAddress } from "@lambdot/output-console";

/**
 * Events produced by the console input: one per line read from stdin.
 * A type alias (not an interface extending `EventMap`) so `keyof` stays
 * exactly these kinds — an interface extending `Record` would inherit a
 * string index signature and make every kind subscribable.
 */
export type ConsoleEvents = {
    "console.line": EventDef<string, ConsoleAddress>;
};

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
