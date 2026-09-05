// oxlint-disable no-console -- Coding standards §5.5 and §6 (`ignifx/no-console`): this file *is*
// the console sink. It is the single place in `src/` allowed to touch the host console; every other
// module logs through `app.log` / `ctx.log`.
import { assertNever } from "../errors/ignifx-error.js";
import { LogLevel, type LogRecord, type LogSink } from "./log-level.js";

/**
 * The part of the host `console` a {@link LogSink} needs. Declaring it keeps the sink testable and
 * keeps ignifx off the DOM `Console` type, which Node's console does not implement in full.
 *
 * @public
 */
export interface ConsoleLike {
  /**
   * Writes a debug line.
   *
   * @param data - The message followed by its structured extras.
   */
  debug(...data: readonly unknown[]): void;

  /**
   * Writes an info line.
   *
   * @param data - The message followed by its structured extras.
   */
  info(...data: readonly unknown[]): void;

  /**
   * Writes a warning line.
   *
   * @param data - The message followed by its structured extras.
   */
  warn(...data: readonly unknown[]): void;

  /**
   * Writes an error line.
   *
   * @param data - The message followed by its structured extras.
   */
  error(...data: readonly unknown[]): void;
}

/**
 * Options for {@link createConsoleSink}.
 *
 * @public
 */
export interface ConsoleSinkOptions {
  /** The console to write to. Defaults to the host `console`. */
  readonly target?: ConsoleLike;
}

/**
 * Creates the default log sink: one console line per record, prefixed with the logger scope and
 * routed to the console method matching the record's level.
 *
 * @param options - An alternative console, for tests and for the Electron main process.
 * @returns A sink for {@link createLogger}.
 *
 * @example
 * ```ts
 * const log = createLogger({ sink: createConsoleSink(), level: "warn" });
 * ```
 *
 * @public
 */
export function createConsoleSink(options?: ConsoleSinkOptions): LogSink {
  const target: ConsoleLike = options?.target ?? console;
  return {
    write(record: LogRecord): void {
      const text = record.scope === null ? record.message : `[${record.scope}] ${record.message}`;
      switch (record.level) {
        case LogLevel.debug:
          target.debug(text, ...record.data);
          return;
        case LogLevel.info:
          target.info(text, ...record.data);
          return;
        case LogLevel.warn:
          target.warn(text, ...record.data);
          return;
        case LogLevel.error:
          target.error(text, ...record.data);
          return;
        default:
          assertNever(record.level, "log level");
      }
    },
  };
}
