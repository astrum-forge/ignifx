/**
 * Severity levels and the record shape the logging sinks receive
 * (`docs/architecture/15-devtools-and-diagnostics.md` §2).
 */

/**
 * The severity of a log record.
 *
 * @remarks
 * `as const` object plus derived union rather than an `enum` (coding standards §5.2, §5.3).
 *
 * @public
 */
export const LogLevel = {
  /** Verbose engine tracing; off by default. */
  debug: "debug",
  /** Lifecycle milestones a developer wants to see once. */
  info: "info",
  /** Something is wrong but the frame continues. */
  warn: "warn",
  /** Something failed; usually paired with an `app.onError` report. */
  error: "error",
} as const;

/**
 * The union of the four severities a {@link LogRecord} can carry.
 *
 * @public
 */
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * What a {@link Logger} is set to. A threshold is a `LogLevel` or `"silent"`, which drops
 * everything; `"silent"` is never the level of a record.
 *
 * @public
 */
export type LogThreshold = LogLevel | "silent";

/**
 * The numeric severity of each threshold. A record is written when its level's severity is greater
 * than or equal to the logger's threshold severity, which is why `"silent"` sits above `"error"`.
 *
 * @public
 */
export const LOG_LEVEL_SEVERITY: Readonly<Record<LogThreshold, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

/**
 * One line of log output, as handed to a {@link LogSink}.
 *
 * @public
 */
export interface LogRecord {
  /** The severity of the line. */
  readonly level: LogLevel;
  /** The dotted scope of the logger that produced it, or `null` for the root logger. */
  readonly scope: string | null;
  /** The human-readable message. */
  readonly message: string;
  /** Structured extras passed after the message. Empty when there were none. */
  readonly data: readonly unknown[];
  /** The logger clock's reading when the line was produced, in milliseconds. */
  readonly timeMs: number;
}

/**
 * Where log records go: the console, a devtools panel, a file in Electron, or an in-memory buffer
 * in tests. A sink is passed to {@link createLogger} and is never discovered globally.
 *
 * @public
 */
export interface LogSink {
  /**
   * Writes one record. Called synchronously from the logging call site, so implementations must be
   * cheap and must not throw.
   *
   * @param record - The record to write.
   */
  write(record: LogRecord): void;
}
