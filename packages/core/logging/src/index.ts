import type { Plugin, Stream } from "@lambdot/core";
import { channel, definePlugin, pumpStream, shareStream } from "@lambdot/core";

/** Severity of a {@link LogRecord}, ordered: debug < info < warn < error. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** One logged event. `data` carries optional structured context. */
export interface LogRecord {
    readonly level: LogLevel;
    readonly message: string;
    /** Milliseconds since the epoch, stamped at the logging call. */
    readonly timestamp: number;
    readonly data?: unknown;
}

/**
 * The logging hook plugins consume: four level methods, each taking a
 * message and optional structured data. Emitted as a namespace value, so a
 * feature declares `{ log: Logger }` in its input and logs through
 * `input.log.info(...)` — which logger implementation sits under the
 * namespace is the composition's choice, not the feature's.
 */
export interface Logger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}

/**
 * A logger whose records are also exposed as a broadcast stream — the
 * wiring point for sinks. The `records` stream is shared: several sinks
 * (console, file, a chat platform) may each subscribe to it.
 */
export interface LoggerSource extends Logger {
    readonly records: Stream<LogRecord>;
}

/** Render a record as one human-readable line (no trailing newline). */
export function formatLogRecord(record: LogRecord): string {
    const time = new Date(record.timestamp).toISOString();
    const level = record.level.toUpperCase();
    let data = "";
    if (record.data !== undefined) {
        try {
            data = ` ${JSON.stringify(record.data)}`;
        } catch {
            // circular or otherwise unserializable payload
            data = " [unserializable]";
        }
    }
    return `${time} ${level} ${record.message}${data}`;
}

/** The console sink's write: warn/error to stderr, debug/info to stdout. */
function writeToConsole(record: LogRecord): void {
    const stream =
        record.level === "warn" || record.level === "error" ? process.stderr : process.stdout;
    stream.write(`${formatLogRecord(record)}\n`);
}

function loggerFrom(emit: (record: LogRecord) => void): Logger {
    const at =
        (level: LogLevel) =>
        (message: string, data?: unknown): void => {
            emit({ level, message, timestamp: Date.now(), data });
        };
    return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

/**
 * The unregistered console logger: a `Logger` whose methods print directly
 * to the console — no record stream is registered and no sink is wired.
 * The zero-composition choice: drop it in and `ctx.log` works.
 *
 * ```ts
 * createKernel().use(consoleLogger()).use(myFeature); // myFeature takes { log: Logger }
 * ```
 */
export function consoleLogger(): Plugin<void, Logger, void, "log"> {
    return definePlugin({
        name: "log",
        apply() {
            return loggerFrom(writeToConsole);
        },
    });
}

/**
 * The higher-ranked logger: emits the same `Logger` hooks as
 * {@link consoleLogger}, but records flow onto a broadcast stream instead
 * of to the console — the user points another logging plugin (a sink) at
 * `ctx.log.records`. Nothing is printed until a sink is wired; records
 * logged before the first sink attaches buffer in the stream.
 *
 * ```ts
 * createKernel()
 *     .use(logger())
 *     .use(myFeature) // takes { log: Logger }
 *     .bind(consoleLogSink(), { mapping: (ctx) => ({ records: ctx.log.records }) });
 * ```
 */
export function logger(): Plugin<void, LoggerSource, void, "log"> {
    return definePlugin({
        name: "log",
        apply(_input, scope) {
            const records = channel<LogRecord>();
            scope.onDispose(() => records.close());
            return {
                ...loggerFrom((record) => records.push(record)),
                records: shareStream(records.stream),
            };
        },
    });
}

/**
 * The console sink: consumes a record stream and prints each record
 * (warn/error to stderr, debug/info to stdout). Wire it to a {@link logger}
 * namespace with a mapping, or to any `Stream<LogRecord>` — filtering by
 * level is an ordinary stream transform:
 *
 * ```ts
 * .bind(consoleLogSink(), {
 *     mapping: (ctx) => ({
 *         records: filterStream(ctx.log.records, (r) => r.level !== "debug"),
 *     }),
 * })
 * ```
 */
export function consoleLogSink(): Plugin<
    { records: Stream<LogRecord> },
    void,
    void,
    "log/console"
> {
    return definePlugin({
        name: "log/console",
        apply(input, scope) {
            scope.onDispose(
                pumpStream(input.records, writeToConsole, (error) => scope.onError(error)),
            );
        },
    });
}
