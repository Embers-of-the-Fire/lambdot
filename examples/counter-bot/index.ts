import { consoleIo, type ConsoleIo } from "@lambdot/console";
import { createScope, definePlugin } from "@lambdot/core";
import { memoryState } from "@lambdot/state-memory";

const counter = definePlugin({
    name: "counter",
    apply(input: { console: ConsoleIo; state: Map<string, unknown> }, scope) {
        scope.onDispose(
            input.console.onLine((line) => {
                const count = ((input.state.get("count") as number | undefined) ?? 0) + 1;
                input.state.set("count", count);
                input.console.print(`#${count}: ${line}`);
            }),
        );
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    .with(memoryState())
    // identity wiring: counter's inputs match the visible ctx
    .use(counter);

const scope = createScope();
await app.apply({}, scope, undefined);

process.on("SIGINT", () => {
    void scope.dispose().then(() => process.exit(0));
});
