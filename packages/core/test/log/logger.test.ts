import { describe, expect, it, vi } from "vitest";
import { LOG_LEVEL_SEVERITY } from "../../src/log/log-level.js";
import { createLogger } from "../../src/log/logger.js";
import { createMemorySink } from "../../src/log/memory-sink.js";

/** A deterministic clock: 0, 1, 2, … milliseconds, one tick per record. */
function createCounterClock(): () => number {
  let value = 0;
  return () => {
    const current = value;
    value += 1;
    return current;
  };
}

describe("log levels", () => {
  it("orders the thresholds from debug to silent", () => {
    expect(LOG_LEVEL_SEVERITY.debug).toBeLessThan(LOG_LEVEL_SEVERITY.info);
    expect(LOG_LEVEL_SEVERITY.info).toBeLessThan(LOG_LEVEL_SEVERITY.warn);
    expect(LOG_LEVEL_SEVERITY.warn).toBeLessThan(LOG_LEVEL_SEVERITY.error);
    expect(LOG_LEVEL_SEVERITY.error).toBeLessThan(LOG_LEVEL_SEVERITY.silent);
  });
});

describe("logger", () => {
  it("writes a record carrying the level, scope, message, data, and clock reading", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, level: "debug", scope: "app", now: () => 42 });
    log.info("loaded {scene}", { scene: "boot" });
    expect(sink.at(0)).toEqual({
      level: "info",
      scope: "app",
      message: "loaded {scene}",
      data: [{ scene: "boot" }],
      timeMs: 42,
    });
  });

  it("defaults to the info threshold", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, now: () => 0 });
    expect(log.level).toBe("info");
    log.debug("hidden");
    log.info("shown");
    expect(sink.length).toBe(1);
  });

  it("drops records below the threshold without touching the sink", () => {
    const write = vi.fn(() => {});
    const log = createLogger({ sink: { write }, level: "warn", now: () => 0 });
    log.debug("no");
    log.info("no");
    log.warn("yes");
    log.error("yes");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("drops everything at the silent threshold", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, level: "silent", now: () => 0 });
    log.error("not even errors");
    expect(sink.length).toBe(0);
  });

  it("answers isEnabled so hot paths can skip building their arguments", () => {
    const log = createLogger({ sink: createMemorySink(), level: "warn", now: () => 0 });
    expect(log.isEnabled("debug")).toBe(false);
    expect(log.isEnabled("warn")).toBe(true);
  });

  it("moves the threshold for the whole tree when setLevel is called on any logger", () => {
    const sink = createMemorySink();
    const root = createLogger({ sink, now: () => 0 });
    const child = root.child("physics");
    child.setLevel("debug");
    expect(root.level).toBe("debug");
    root.debug("visible now");
    expect(sink.length).toBe(1);
  });

  it("prefixes child scopes with a dot and leaves the root scope null", () => {
    const sink = createMemorySink();
    const root = createLogger({ sink, now: () => 0 });
    expect(root.scope).toBeNull();
    root.child("physics").child("solver").warn("slow");
    expect(sink.at(0)?.scope).toBe("physics.solver");
  });

  it("nests a child under an explicit root scope", () => {
    const sink = createMemorySink();
    createLogger({ sink, scope: "app", now: () => 0 })
      .child("assets")
      .warn("missing");
    expect(sink.at(0)?.scope).toBe("app.assets");
  });

  it("records an empty data array when no extras are passed", () => {
    const sink = createMemorySink();
    createLogger({ sink, now: () => 0 }).warn("bare");
    expect(sink.at(0)?.data).toEqual([]);
  });

  it("stamps records with the injected clock", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, now: createCounterClock() });
    log.warn("first");
    log.warn("second");
    expect(sink.at(0)?.timeMs).toBe(0);
    expect(sink.at(1)?.timeMs).toBe(1);
  });

  it("falls back to a host clock when none is injected", () => {
    const sink = createMemorySink();
    createLogger({ sink }).warn("timed");
    expect(sink.at(0)?.timeMs).toBeTypeOf("number");
  });

  it("uses Date.now on a host without a performance clock", () => {
    const sink = createMemorySink();
    vi.stubGlobal("performance", undefined);
    try {
      createLogger({ sink }).warn("timed");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sink.at(0)?.timeMs).toBeGreaterThan(0);
  });

  it("uses Date.now on a host whose performance object has no now", () => {
    const sink = createMemorySink();
    vi.stubGlobal("performance", {});
    try {
      createLogger({ sink }).warn("timed");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sink.at(0)?.timeMs).toBeGreaterThan(0);
  });

  it("routes every level to the sink with its own name", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, level: "debug", now: () => 0 });
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    expect(sink.toArray().map((record) => record.level)).toEqual(["debug", "info", "warn", "error"]);
  });
});

describe("warnOnce", () => {
  it("writes the first call and drops later calls with the same key", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, now: () => 0 });
    for (let frame = 0; frame < 100; frame += 1) {
      log.warnOnce("no-atlas", "sprite has no atlas");
    }
    expect(sink.length).toBe(1);
    expect(sink.at(0)?.level).toBe("warn");
  });

  it("treats different keys independently", () => {
    const sink = createMemorySink();
    const log = createLogger({ sink, now: () => 0 });
    log.warnOnce("a", "first");
    log.warnOnce("b", "second");
    expect(sink.length).toBe(2);
  });

  it("scopes keys so two subsystems can use the same key", () => {
    const sink = createMemorySink();
    const root = createLogger({ sink, now: () => 0 });
    root.child("physics").warnOnce("slow", "physics is slow");
    root.child("audio").warnOnce("slow", "audio is slow");
    expect(sink.length).toBe(2);
  });

  it("shares its memory with children of the same root", () => {
    const sink = createMemorySink();
    const root = createLogger({ sink, now: () => 0 });
    const physics = root.child("physics");
    physics.warnOnce("slow", "first");
    physics.warnOnce("slow", "second");
    expect(sink.length).toBe(1);
  });

  it("stays silent when the threshold excludes warnings", () => {
    const sink = createMemorySink();
    createLogger({ sink, level: "error", now: () => 0 }).warnOnce("k", "hidden");
    expect(sink.length).toBe(0);
  });
});
