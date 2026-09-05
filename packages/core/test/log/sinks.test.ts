import { describe, expect, it, vi } from "vitest";
import { createConsoleSink, type ConsoleLike } from "../../src/log/console-sink.js";
import { createLogger } from "../../src/log/logger.js";
import { createMemorySink, DEFAULT_MEMORY_SINK_LIMIT } from "../../src/log/memory-sink.js";
import type { LogRecord } from "../../src/log/log-level.js";

/** Builds a record without going through a logger. */
function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return { level: "info", scope: null, message: "message", data: [], timeMs: 0, ...overrides };
}

/** A console double that records which method each line went to. */
function createConsoleSpy(): ConsoleLike & { calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  return {
    calls,
    debug: (...data: unknown[]): void => {
      calls.push(["debug", data]);
    },
    info: (...data: unknown[]): void => {
      calls.push(["info", data]);
    },
    warn: (...data: unknown[]): void => {
      calls.push(["warn", data]);
    },
    error: (...data: unknown[]): void => {
      calls.push(["error", data]);
    },
  };
}

describe("console sink", () => {
  it("routes each level to the matching console method", () => {
    const target = createConsoleSpy();
    const sink = createConsoleSink({ target });
    sink.write(record({ level: "debug" }));
    sink.write(record({ level: "info" }));
    sink.write(record({ level: "warn" }));
    sink.write(record({ level: "error" }));
    expect(target.calls.map((call) => call[0])).toEqual(["debug", "info", "warn", "error"]);
  });

  it("prefixes the message with the scope when there is one", () => {
    const target = createConsoleSpy();
    createConsoleSink({ target }).write(record({ scope: "physics", message: "slow" }));
    expect(target.calls[0]?.[1]).toEqual(["[physics] slow"]);
  });

  it("passes the message through unprefixed for the root logger", () => {
    const target = createConsoleSpy();
    createConsoleSink({ target }).write(record({ message: "boot" }));
    expect(target.calls[0]?.[1]).toEqual(["boot"]);
  });

  it("forwards structured extras after the message", () => {
    const target = createConsoleSpy();
    createConsoleSink({ target }).write(record({ data: [1, "two"] }));
    expect(target.calls[0]?.[1]).toEqual(["message", 1, "two"]);
  });

  it("refuses a record whose level is not one of the four", () => {
    const target = createConsoleSpy();
    const sink = createConsoleSink({ target });
    // The union is closed at compile time; the guard exists for data crossing a runtime boundary.
    expect(() => sink.write({ ...record(), level: "trace" as "info" })).toThrow(/IGX-1505/u);
  });

  it("writes to the host console when no target is given", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      createLogger({ sink: createConsoleSink(), now: () => 0 }).warn("to the host console");
      expect(spy).toHaveBeenCalledWith("to the host console");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("memory sink", () => {
  it("retains records oldest first", () => {
    const sink = createMemorySink(4);
    sink.write(record({ message: "a" }));
    sink.write(record({ message: "b" }));
    expect(sink.length).toBe(2);
    expect(sink.at(0)?.message).toBe("a");
    expect(sink.at(1)?.message).toBe("b");
  });

  it("drops the oldest record once the limit is reached", () => {
    const sink = createMemorySink(3);
    for (const message of ["a", "b", "c", "d", "e"]) {
      sink.write(record({ message }));
    }
    expect(sink.length).toBe(3);
    expect(sink.toArray().map((entry) => entry.message)).toEqual(["c", "d", "e"]);
  });

  it("returns null outside the retained range", () => {
    const sink = createMemorySink(2);
    sink.write(record());
    expect(sink.at(-1)).toBeNull();
    expect(sink.at(1)).toBeNull();
  });

  it("empties on clear", () => {
    const sink = createMemorySink(2);
    sink.write(record());
    sink.clear();
    expect(sink.length).toBe(0);
    expect(sink.toArray()).toEqual([]);
  });

  it("clamps a limit below one", () => {
    const sink = createMemorySink(0);
    expect(sink.limit).toBe(1);
    sink.write(record({ message: "a" }));
    sink.write(record({ message: "b" }));
    expect(sink.toArray().map((entry) => entry.message)).toEqual(["b"]);
  });

  it("defaults to the documented limit", () => {
    expect(createMemorySink().limit).toBe(DEFAULT_MEMORY_SINK_LIMIT);
  });

  it("keeps working as a ring buffer over many writes", () => {
    const sink = createMemorySink(8);
    for (let index = 0; index < 1000; index += 1) {
      sink.write(record({ message: String(index) }));
    }
    expect(sink.length).toBe(8);
    expect(sink.at(0)?.message).toBe("992");
    expect(sink.at(7)?.message).toBe("999");
  });
});
