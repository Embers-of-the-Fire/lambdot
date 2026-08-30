# @lambdot/logging

Logging as ordinary plugins: a `Logger` hook that features consume through
their input, and a choice of what sits under the namespace — a direct
console logger, or a record stream pointed at any sink the composition
wires in.

## What it provides

- **A logging hook.** `Logger` exposes four level methods —
  `debug`/`info`/`warn`/`error`, each taking a message and optional
  structured `data`. A feature declares `{ log: Logger }` in its input and
  logs through `input.log.info(...)`; which logger implementation sits
  under the namespace is the composition's choice, not the feature's.
- **The unregistered console logger.** `consoleLogger()` emits a `Logger`
  whose methods print directly to the console — no record stream is
  registered and no sink is wired. The zero-composition choice.
- **The higher-ranked logger.** `logger()` emits the same hooks as a
  `LoggerSource`: records flow onto a broadcast `records` stream instead
  of to the console, so the user points another logging plugin (a sink) at
  it. Nothing is printed until a sink is wired; because the stream is
  shared, several sinks may each subscribe.
- **A console sink.** `consoleLogSink()` consumes any
  `Stream<LogRecord>` and prints each record (warn/error to stderr,
  debug/info to stdout) — the sink half of the routed setup, and the
  reference for writing custom sinks (a file, a chat platform, ...).

## Usage

Direct console logging — no wiring:

```ts
import { createKernel, definePlugin } from "@lambdot/core";
import { consoleLogger, type Logger } from "@lambdot/logging";

const feature = definePlugin({
    name: "feature",
    apply(input: { log: Logger }) {
        input.log.info("activated", { plugin: "feature" });
    },
});

const kernel = createKernel().use(consoleLogger()).use(feature);
await kernel.start();
```

Routed logging — hooks stay, output goes through a sink (continues the
previous example, reusing its `feature`):

```ts
import { createKernel } from "@lambdot/core";
import { consoleLogSink, logger } from "@lambdot/logging";

// `feature` is the plugin defined in the previous example.
const kernel = createKernel()
    .use(logger()) // ctx.log: LoggerSource
    .use(feature) // identity wiring: { log: Logger } matches
    .bind(consoleLogSink(), { mapping: (ctx) => ({ records: ctx.log.records }) });
await kernel.start();
```

Filtering by level is an ordinary stream transform, not logger config:

```ts
import { filterStream } from "@lambdot/core";

.bind(consoleLogSink(), {
    mapping: (ctx) => ({
        records: filterStream(ctx.log.records, (r) => r.level !== "debug"),
    }),
});
```

`consoleLogger()` and `logger()` share the namespace name (`log`) and emit
values assignable to `Logger`, so swapping the direct logger for the routed
one — or pointing the stream at a different sink — touches only the
composition, never the features.

## API

- `consoleLogger()` — `Plugin<void, Logger, void, "log">`. Prints each call
  directly; warn/error go to stderr, debug/info to stdout.
- `logger()` — `Plugin<void, LoggerSource, void, "log">`. The hook methods
  push records onto `records`, a shared (broadcast) stream; the plugin's
  disposer closes it.
- `consoleLogSink()` —
  `Plugin<{ records: Stream<LogRecord> }, void, void, "log/console">`.
  Pumps `records` in the background and prints each one.
- `formatLogRecord(record)` — renders one record as a single line
  (`<iso-time> <LEVEL> <message> <json-data?>`), the format both console
  implementations write.
- Types: `LogLevel`, `LogRecord`, `Logger`, `LoggerSource`.

## License

Dual-licensed under [Apache-2.0](../../../LICENSE-APACHE) and [MIT](../../../LICENSE-MIT).
