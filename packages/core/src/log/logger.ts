import { LOG_LEVEL_SEVERITY, LogLevel, type LogRecord, type LogSink, type LogThreshold } from "./log-level.js";

/**
 * The logging front end reached as `app.log` and, per extension, as `ctx.log`
 * (`docs/architecture/15-devtools-and-diagnostics.md` §2).
 *
 * @remarks
 * Calls below the current threshold return before any record is built, so a disabled `debug()` costs
 * one numeric comparison. The rest parameter itself is still materialised by the JavaScript engine,
 * so per-frame call sites guard with {@link Logger.isEnabled} instead (coding standards §7).
 *
 * @example
 * ```ts
 * const log = app.log.child("physics");
 * log.info("stepping at {hz}Hz", 60);
 * if (log.isEnabled("debug")) {
 *   log.debug("contacts", collectContacts());
 * }
 * ```
 *
 * @public
 */
export interface Logger {
  /** The threshold below which records are dropped. Shared with every child logger. */
  readonly level: LogThreshold;

  /** The dotted scope prefix of this logger, or `null` for the root. */
  readonly scope: string | null;

  /**
   * Reports whether a record at this level would be written.
   *
   * @param level - The level to test.
   * @returns `true` when the level passes the current threshold.
   */
  isEnabled(level: LogLevel): boolean;

  /**
   * Raises or lowers the threshold for this logger, its parents, and its children — they share one
   * setting so devtools can turn `debug` on for the whole app at once.
   *
   * @param level - The new threshold.
   */
  setLevel(level: LogThreshold): void;

  /**
   * Writes a `debug` record.
   *
   * @param message - The message.
   * @param data - Structured extras.
   */
  debug(message: string, ...data: readonly unknown[]): void;

  /**
   * Writes an `info` record.
   *
   * @param message - The message.
   * @param data - Structured extras.
   */
  info(message: string, ...data: readonly unknown[]): void;

  /**
   * Writes a `warn` record.
   *
   * @param message - The message.
   * @param data - Structured extras.
   */
  warn(message: string, ...data: readonly unknown[]): void;

  /**
   * Writes an `error` record.
   *
   * @param message - The message.
   * @param data - Structured extras.
   */
  error(message: string, ...data: readonly unknown[]): void;

  /**
   * Writes a `warn` record the first time this key is seen and drops every later call with the same
   * key. This is the rate limiter for warnings that would otherwise repeat every frame.
   *
   * @param key - The de-duplication key, scoped to this logger's scope.
   * @param message - The message, used on the first call only.
   * @param data - Structured extras, used on the first call only.
   */
  warnOnce(key: string, message: string, ...data: readonly unknown[]): void;

  /**
   * Creates a logger that prefixes its records with an additional scope segment and shares this
   * logger's sink, threshold, clock, and `warnOnce` memory.
   *
   * @param scope - The segment to append, for example `"physics"`.
   * @returns The scoped logger.
   */
  child(scope: string): Logger;
}

/**
 * Options for {@link createLogger}.
 *
 * @public
 */
export interface LoggerOptions {
  /** Where records go. */
  readonly sink: LogSink;
  /** The initial threshold. Defaults to `"info"`. */
  readonly level?: LogThreshold;
  /** The root scope. Defaults to `null`. */
  readonly scope?: string | null;
  /**
   * The clock used for {@link LogRecord.timeMs}. Defaults to `performance.now` when the host has
   * it and `Date.now` otherwise; tests pass a counter so records are deterministic.
   */
  readonly now?: () => number;
}

/** State every logger in one tree shares, so `setLevel` on any of them moves all of them. */
interface LoggerState {
  readonly sink: LogSink;
  readonly now: () => number;
  readonly seen: Set<string>;
  level: LogThreshold;
  threshold: number;
}

/** The separator between scope segments. */
const SCOPE_SEPARATOR = ".";

/**
 * Picks the default clock: the high-resolution monotonic one when the host exposes it.
 *
 * @returns A function returning milliseconds.
 */
function defaultNow(): () => number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => performance.now();
  }
  return () => Date.now();
}

class LoggerImpl implements Logger {
  readonly #state: LoggerState;
  readonly #scope: string | null;

  constructor(state: LoggerState, scope: string | null) {
    this.#state = state;
    this.#scope = scope;
  }

  get level(): LogThreshold {
    return this.#state.level;
  }

  get scope(): string | null {
    return this.#scope;
  }

  isEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= this.#state.threshold;
  }

  setLevel(level: LogThreshold): void {
    this.#state.level = level;
    this.#state.threshold = LOG_LEVEL_SEVERITY[level];
  }

  debug(message: string, ...data: readonly unknown[]): void {
    this.#write(LogLevel.debug, message, data);
  }

  info(message: string, ...data: readonly unknown[]): void {
    this.#write(LogLevel.info, message, data);
  }

  warn(message: string, ...data: readonly unknown[]): void {
    this.#write(LogLevel.warn, message, data);
  }

  error(message: string, ...data: readonly unknown[]): void {
    this.#write(LogLevel.error, message, data);
  }

  warnOnce(key: string, message: string, ...data: readonly unknown[]): void {
    const scopedKey = this.#scope === null ? key : `${this.#scope}${SCOPE_SEPARATOR}${key}`;
    if (this.#state.seen.has(scopedKey)) {
      return;
    }
    this.#state.seen.add(scopedKey);
    this.#write(LogLevel.warn, message, data);
  }

  child(scope: string): Logger {
    const nested = this.#scope === null ? scope : `${this.#scope}${SCOPE_SEPARATOR}${scope}`;
    return new LoggerImpl(this.#state, nested);
  }

  #write(level: LogLevel, message: string, data: readonly unknown[]): void {
    if (LOG_LEVEL_SEVERITY[level] < this.#state.threshold) {
      return;
    }
    const record: LogRecord = {
      level,
      scope: this.#scope,
      message,
      data,
      timeMs: this.#state.now(),
    };
    this.#state.sink.write(record);
  }
}

/**
 * Creates the root logger of one app.
 *
 * @param options - The sink, and optionally the threshold, root scope, and clock.
 * @returns The root logger; call {@link Logger.child} for scoped loggers.
 *
 * @example
 * ```ts
 * const log = createLogger({ sink: createConsoleSink(), level: "debug" });
 * log.child("assets").warnOnce("missing-atlas", "No atlas for sprite {id}.");
 * ```
 *
 * @public
 */
export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? LogLevel.info;
  const state: LoggerState = {
    sink: options.sink,
    now: options.now ?? defaultNow(),
    seen: new Set<string>(),
    level,
    threshold: LOG_LEVEL_SEVERITY[level],
  };
  return new LoggerImpl(state, options.scope ?? null);
}
