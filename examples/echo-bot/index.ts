import { consoleIo, type ConsoleIo } from "@lambdot/console";
import { createScope, definePlugin } from "@lambdot/core";

const echo = definePlugin({
    name: "echo",
    apply(input: { console: ConsoleIo }, scope) {
        scope.onDispose(input.console.onLine((line) => input.console.print(`echo: ${line}`)));
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleIo(), { option: {} })
    // identity wiring: echo's input keys already match the visible ctx
    .use(echo);

const scope = createScope();
await app.apply({}, scope, undefined);

process.on("SIGINT", () => {
    void scope.dispose().then(() => process.exit(0));
});
