# @lambdot/console

stdin/stdout processing as an ordinary plugin: a terminal needs no external
service, so the console is where the framework's contracts are exercised
first. It exposes one plugin, `consoleIo`, whose item map is the console
service — lines read from stdin, text written to stdout/stderr.

## What it provides

`consoleIo()` emits a `ConsoleIo` under the `console` namespace:

- `onLine(listener): Disposer` — subscribe to lines read from stdin (via
  `node:readline/promises`, line mode, no TTY echo handling). The returned
  disposer unsubscribes; consumers register it on their scope.
- `print(text, target?)` — write one line to `"stdout"` (default) or
  `"stderr"`.

The readline interface is owned by the plugin: it opens at application and
closes when the owning scope disposes. The streams behind the service are
config (`input`, `stdout`, `stderr`), defaulting to the process streams —
inject fakes in tests.

## Usage

```ts
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
    .use(echo);

const scope = createScope();
await app.apply({}, scope, undefined);
// ... later: await scope.dispose();
```

`consoleIo` is hermetic (`with`): the console observes nothing of its
surroundings. `option` is required (even as `{}`) because the config type
is non-void.

## API

- `consoleIo()` — a `Plugin<void, ConsoleIo, ConsoleIoConfig, "console">`.
- `ConsoleIo` — the service: `onLine(listener): Disposer`,
  `print(text, target?)`.
- `ConsoleIoConfig` — `{ input?, stdout?, stderr? }` stream overrides.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
