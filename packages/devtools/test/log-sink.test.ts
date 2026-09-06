import { describe, expect, it, vi } from "vitest";
import { createDevtoolsLogSink, DEFAULT_DEVTOOLS_LOG_LIMIT } from "../src/log-sink.js";
import type { LogRecord } from "@ignifx/core";

/**
 * The Console panel's sink: a ring buffer with a level filter and a search, plus the tee that keeps
 * the browser console working when a game installs it as `createApp({ logSink })`.
 */

/**
 * Builds a record.
 *
 * @param level - The severity.
 * @param message - The message.
 * @param scope - The scope.
 * @returns The record.
 */
function record(level: LogRecord["level"], message: string, scope: string | null = null): LogRecord {
  return { level, scope, message, data: [], timeMs: 0 };
}

describe("createDevtoolsLogSink", () => {
  it("retains records up to its limit, oldest first", () => {
    const sink = createDevtoolsLogSink({ limit: 2 });
    sink.write(record("info", "one"));
    sink.write(record("info", "two"));
    sink.write(record("info", "three"));

    expect(sink.limit).toBe(2);
    expect(sink.length).toBe(2);
    expect(sink.at(0)?.message).toBe("two");
    expect(sink.at(1)?.message).toBe("three");
    expect(sink.at(2)).toBeNull();
    expect(sink.at(-1)).toBeNull();
  });

  it("defaults to five hundred records and clamps a silly limit to one", () => {
    expect(createDevtoolsLogSink().limit).toBe(DEFAULT_DEVTOOLS_LOG_LIMIT);
    expect(createDevtoolsLogSink({ limit: 0 }).limit).toBe(1);
  });

  it("tees every record to a second sink", () => {
    const write = vi.fn();
    const sink = createDevtoolsLogSink({ tee: { write } });
    sink.write(record("warn", "teed"));

    expect(write).toHaveBeenCalledTimes(1);
  });

  it("filters by level and by a case-insensitive search over scope and message", () => {
    const sink = createDevtoolsLogSink();
    sink.write(record("debug", "quiet"));
    sink.write(record("warn", "no atlas", "assets"));
    sink.write(record("error", "boom"));
    const out: LogRecord[] = [];

    expect(sink.query("warn", "", out, 10).map((entry: LogRecord): string => entry.message)).toEqual([
      "boom",
      "no atlas",
    ]);
    expect(sink.query("debug", "ATLAS", out, 10)).toHaveLength(1);
    expect(sink.query("debug", "assets", out, 10)).toHaveLength(1);
    expect(sink.query("silent", "", out, 10)).toHaveLength(0);
    expect(sink.query("debug", "", out, 1)).toHaveLength(1);
  });

  it("reuses the caller's array rather than allocating one per refresh", () => {
    const sink = createDevtoolsLogSink();
    sink.write(record("info", "one"));
    const out: LogRecord[] = [];

    expect(sink.query("debug", "", out, 10)).toBe(out);
    expect(sink.query("debug", "nothing-matches", out, 10)).toHaveLength(0);
  });

  it("drops everything on clear", () => {
    const sink = createDevtoolsLogSink();
    sink.write(record("info", "one"));
    sink.clear();

    expect(sink.length).toBe(0);
    expect(sink.at(0)).toBeNull();
  });
});
