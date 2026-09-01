# @lambdot/logging

Logging as ordinary plugins: a `Logger` hook that features consume through
their input, and sinks that are plain functions. The specification's
abstract/handler pattern: the feature declares the requirement, the
composition decides what handles it.

## What it provides

- **A logging hook.** `Logger` exposes four level methods —
  `debug`/`info`/`warn`/`error`, each taking a message and optional
  structured `data`. A feature declares `{ log: Logger }` in its input and
  logs through `input.log.info(...)`; which logger implementation sits
  under the namespace is the composition's choice, not the feature's.
- **A sink factory.** `loggerFrom(emit)` builds a `Logger` from a plain
  function over `LogRecord` — a file writer, a level filter, a test
  recorder — with no plugin machinery of its own.
- **The console logger.** `consoleLogger()` is the ready-made handler: a
  plugin emitting a `Logger` under the `log` namespace whose methods print
  to the console (warn/error to stderr, debug/info to stdout).

## Usage

```ts
import { createScope, definePlugin } from "@lambdot/core";
import { consoleLogger, type Logger } from "@lambdot/logging";

const feature = definePlugin({
    name: "feature",
    apply(input: { log: Logger }) {
        input.log.info("activated", { plugin: "feature" });
    },
});

const app = definePlugin({ name: "app", apply: () => ({}) })
    .with(consoleLogger())
    .use(feature);

const scope = createScope();
await app.apply({}, scope, undefined);
```

A custom sink is a plain function, wrapped in whatever plugin shape the
composition needs — filtering by level is ordinary code, not logger config:

```ts
import { definePlugin } from "@lambdot/core";
import { loggerFrom } from "@lambdot/logging";

const warningsOnly = definePlugin({
    name: "log",
    apply() {
        return loggerFrom((record) => {
            if (record.level === "warn" || record.level === "error")
                process.stderr.write(`${formatLogRecord(record)}\n`);
        });
    },
});
```

Both loggers share the namespace name (`log`) and emit values assignable to
`Logger`, so swapping one handler for another touches only the composition,
never the features.

## API

- `consoleLogger()` — `Plugin<void, Logger, void, "log">`. Prints each call
  directly; warn/error go to stderr, debug/info to stdout.
- `loggerFrom(emit)` — build a `Logger` from `(record: LogRecord) => void`;
  each level method stamps a record and hands it to `emit`.
- `formatLogRecord(record)` — renders one record as a single line
  (`<iso-time> <LEVEL> <message> <json-data?>`), the format `consoleLogger`
  writes.
- Types: `LogLevel`, `LogRecord`, `Logger`.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
