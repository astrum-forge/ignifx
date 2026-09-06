import { LOG_LEVEL_SEVERITY } from "@ignifx/core";
import type { LogLevel, LogRecord, LogSink, LogThreshold } from "@ignifx/core";

/**
 * The sink behind the Console panel (`docs/architecture/15-devtools-and-diagnostics.md` §2, §4).
 *
 * ## Why a game has to install it
 *
 * `app.log`'s sink is fixed when the app is built — `createApp({ logSink })` hands it to
 * `createLogger` once and `Logger` exposes no way to add a second one
 * (`packages/core/src/app/app.ts`, `packages/core/src/log/logger.ts`). An extension that registers
 * later therefore cannot intercept log records at all. Until core grows a sink list, the Console
 * panel is fed by a sink the *game* installs:
 *
 * ```ts
 * const sink = createDevtoolsLogSink({ tee: createConsoleSink() });
 * const app = await createApp({ canvas, logSink: sink, extensions: [devtools({ logSink: sink })] });
 * ```
 *
 * Without it the panel still shows `app.onError` reports and hot-reload reports, which is
 * everything devtools can see on its own; it says so in place of the log lines.
 */

/**
 * A `LogSink` that keeps the most recent records for the Console panel and, optionally,
 * forwards each one to a second sink so the browser console keeps working.
 *
 * @example
 * ```ts
 * const sink = createDevtoolsLogSink({ limit: 500 });
 * const app = await createApp({ headless: true, logSink: sink, extensions: [devtools({ logSink: sink })] });
 * ```
 *
 * @public
 */
export interface DevtoolsLogSink extends LogSink {
  /** The maximum number of records retained. */
  readonly limit: number;
  /** How many records are currently retained, never more than {@link DevtoolsLogSink.limit}. */
  readonly length: number;
  /**
   * Reads one retained record.
   *
   * @param index - `0` is the oldest retained record, `length - 1` the newest.
   * @returns The record, or `null` when the index is out of range.
   */
  at(index: number): LogRecord | null;
  /**
   * Copies the records that pass a level threshold and a case-insensitive substring search, newest
   * first, into a caller-owned array.
   *
   * @param level - The lowest severity to keep; `"silent"` keeps nothing.
   * @param search - A substring matched against the scope and the message; `""` matches everything.
   * @param out - The array to fill. It is truncated first, so one array serves every refresh.
   * @param max - How many records to copy at most.
   * @returns The same `out` array.
   */
  query(level: LogThreshold, search: string, out: LogRecord[], max: number): LogRecord[];
  /** Drops every retained record. */
  clear(): void;
}

/**
 * What {@link createDevtoolsLogSink} accepts.
 *
 * @public
 */
export interface DevtoolsLogSinkOptions {
  /** How many records to retain. Defaults to {@link DEFAULT_DEVTOOLS_LOG_LIMIT}. */
  readonly limit?: number;
  /** A second sink every record is also written to — the console sink, in a normal game. */
  readonly tee?: LogSink;
}

/**
 * How many records {@link createDevtoolsLogSink} keeps when no limit is given. Five hundred lines
 * is about a screenful of scrollback at the Console panel's row height and costs a few tens of
 * kilobytes.
 *
 * @public
 */
export const DEFAULT_DEVTOOLS_LOG_LIMIT = 500;

/**
 * Reports whether a record matches a search string.
 *
 * @param record - The record to test.
 * @param needle - The already lower-cased search string.
 * @returns `true` when the scope or the message contains it.
 */
function matches(record: LogRecord, needle: string): boolean {
  if (needle === "") {
    return true;
  }
  if (record.message.toLowerCase().includes(needle)) {
    return true;
  }
  const scope = record.scope;
  return scope !== null && scope.toLowerCase().includes(needle);
}

class DevtoolsLogSinkImpl implements DevtoolsLogSink {
  readonly limit: number;
  readonly #records: (LogRecord | null)[];
  readonly #tee: LogSink | null;
  #head = 0;
  #count = 0;

  constructor(options: DevtoolsLogSinkOptions) {
    this.limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_DEVTOOLS_LOG_LIMIT));
    this.#records = Array.from<LogRecord | null>({ length: this.limit }).fill(null);
    this.#tee = options.tee ?? null;
  }

  get length(): number {
    return this.#count;
  }

  write(record: LogRecord): void {
    this.#records[this.#head] = record;
    this.#head = (this.#head + 1) % this.limit;
    if (this.#count < this.limit) {
      this.#count += 1;
    }
    this.#tee?.write(record);
  }

  at(index: number): LogRecord | null {
    if (index < 0 || index >= this.#count) {
      return null;
    }
    const oldest = (this.#head - this.#count + this.limit) % this.limit;
    return this.#records[(oldest + index) % this.limit] ?? null;
  }

  query(level: LogThreshold, search: string, out: LogRecord[], max: number): LogRecord[] {
    out.length = 0;
    const threshold = LOG_LEVEL_SEVERITY[level];
    const needle = search.toLowerCase();
    for (let index = this.#count - 1; index >= 0 && out.length < max; index -= 1) {
      const record = this.at(index);
      if (record === null) {
        continue;
      }
      if (LOG_LEVEL_SEVERITY[record.level] < threshold || !matches(record, needle)) {
        continue;
      }
      out.push(record);
    }
    return out;
  }

  clear(): void {
    this.#records.fill(null);
    this.#head = 0;
    this.#count = 0;
  }
}

/**
 * Creates the Console panel's sink.
 *
 * @param options - The retention limit and the sink to tee to.
 * @returns The sink, to pass to both `createApp({ logSink })` and `devtools({ logSink })`.
 *
 * @example
 * ```ts
 * const sink = createDevtoolsLogSink();
 * sink.write({ level: "warn", scope: "physics", message: "no collider", data: [], timeMs: 0 });
 * sink.length; // 1
 * ```
 *
 * @public
 */
export function createDevtoolsLogSink(options: DevtoolsLogSinkOptions = {}): DevtoolsLogSink {
  return new DevtoolsLogSinkImpl(options);
}

/**
 * The levels the Console panel's filter offers, lowest first.
 *
 * @public
 */
export const DEVTOOLS_LOG_LEVELS: readonly LogLevel[] = Object.freeze(["debug", "info", "warn", "error"]);
