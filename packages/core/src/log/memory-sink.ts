import type { LogRecord, LogSink } from "./log-level.js";

/**
 * A {@link LogSink} that keeps the most recent records in a fixed-size ring buffer. Used by the
 * devtools console panel, which needs scrollback without unbounded growth, and by unit tests, which
 * assert on what was logged.
 *
 * @public
 */
export interface MemorySink extends LogSink {
  /** The maximum number of records retained. */
  readonly limit: number;
  /** How many records are currently retained, never more than {@link MemorySink.limit}. */
  readonly length: number;

  /**
   * Reads one retained record without copying the buffer.
   *
   * @param index - `0` is the oldest retained record, `length - 1` the newest.
   * @returns The record, or `null` when the index is out of range.
   */
  at(index: number): LogRecord | null;

  /**
   * Copies the retained records, oldest first.
   *
   * @returns A new array; allocating here is fine because only tests and devtools call it.
   */
  toArray(): readonly LogRecord[];

  /** Drops every retained record. */
  clear(): void;
}

/**
 * How many records {@link createMemorySink} keeps when no limit is given.
 *
 * @public
 */
export const DEFAULT_MEMORY_SINK_LIMIT = 200;

class MemorySinkImpl implements MemorySink {
  readonly limit: number;
  readonly #records: (LogRecord | null)[];
  #head = 0;
  #count = 0;

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
    this.#records = Array.from<LogRecord | null>({ length: this.limit }).fill(null);
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
  }

  at(index: number): LogRecord | null {
    if (index < 0 || index >= this.#count) {
      return null;
    }
    const oldest = (this.#head - this.#count + this.limit) % this.limit;
    return this.#records[(oldest + index) % this.limit] ?? null;
  }

  toArray(): readonly LogRecord[] {
    const out: LogRecord[] = [];
    for (let index = 0; index < this.#count; index += 1) {
      const record = this.at(index);
      if (record !== null) {
        out.push(record);
      }
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
 * Creates an in-memory ring-buffer sink.
 *
 * @param limit - How many records to retain. Defaults to {@link DEFAULT_MEMORY_SINK_LIMIT}; values
 * below one are clamped to one.
 * @returns The sink, with the retained records readable through {@link MemorySink.at}.
 *
 * @example
 * ```ts
 * const sink = createMemorySink(4);
 * const log = createLogger({ sink, now: () => 0 });
 * log.warn("no atlas");
 * sink.at(0)?.level; // "warn"
 * ```
 *
 * @public
 */
export function createMemorySink(limit: number = DEFAULT_MEMORY_SINK_LIMIT): MemorySink {
  return new MemorySinkImpl(limit);
}
