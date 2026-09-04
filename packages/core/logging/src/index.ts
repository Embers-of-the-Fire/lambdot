import type { Plugin } from "@lambdot/core";
import { definePlugin } from "@lambdot/core";

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

/**
 * Build a `Logger` from a plain function: each level method stamps a
 * {@link LogRecord} and hands it to `emit`. This is how sinks are written —
 * a file writer, a level filter, a test recorder — with no plugin machinery
 * of their own:
 *
 * ```ts
 * const fileLogger = loggerFrom((record) => appendFileSync(path, `${formatLogRecord(record)}\n`));
 * const warningsUp = loggerFrom((record) => {
 *     if (record.level !== "debug" && record.level !== "info") writeToConsole(record);
 * });
 * ```
 */
export function loggerFrom(emit: (record: LogRecord) => void): Logger {
    const at =
        (level: LogLevel) =>
        (message: string, data?: unknown): void => {
            emit({ level, message, timestamp: Date.now(), data });
        };
    return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}

/**
 * The console logger: a `Logger` whose methods print to the console
 * (warn/error to stderr, debug/info to stdout). The zero-composition
 * handler: wire it under `log` and features declaring `{ log: Logger }`
 * work:
 *
 * ```ts
 * app.with(consoleLogger()).use(myFeature); // myFeature takes { log: Logger }
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
