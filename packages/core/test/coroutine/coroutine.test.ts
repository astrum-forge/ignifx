import { afterEach, describe, expect, it } from "vitest";
import { Script, waitFixedUpdate, waitSeconds, waitSecondsRealtime, waitUntil, waitWhile } from "../../src/index.js";
import { createTestApp } from "../support/app-harness.js";
import type { CoroutineHandle } from "../../src/index.js";
import type { TestAppHarness } from "../support/app-harness.js";

/**
 * Coroutine semantics (`docs/architecture/01-lifecycle-and-time.md` §5, ADR-0010). Every resume
 * point is a test, and so is every rule about pausing, cancellation, and promise bridging.
 */

const FRAME = 1 / 60;

let harness: TestAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The placeholder a deferred promise's resolver starts as, hoisted so it captures nothing. */
function notSettledYet(): void {
  // Replaced by the promise executor before anything calls it.
}

// A coroutine that appends a label to a log every frame, forever. Plain comments rather than a doc
// block: `jsdoc/require-yields` would then demand a `@yields` tag, which TSDoc does not define and
// `jsdoc/no-types` forbids annotating.
function* ticker(log: string[], label: string): Generator<null, void, unknown> {
  for (;;) {
    log.push(label);
    yield null;
  }
}

// A coroutine that throws on its second segment, for the error-reporting tests.
function* thrower(): Generator<null, void, unknown> {
  yield null;
  throw new Error("coroutine boom");
}

// A coroutine that waits on a predicate which throws.
function* badPredicate(): Generator<ReturnType<typeof waitUntil>, void, unknown> {
  yield waitUntil((): boolean => {
    throw new Error("predicate boom");
  });
}

/** A script that exposes the shared log and starts coroutines on demand. */
class Host extends Script {
  static typeId = "test/CoroutineHost";

  /** The shared log every coroutine in this suite appends to. */
  log: string[] = [];

  /**
   * Appends an entry.
   *
   * @param entry - What happened.
   */
  record(entry: string): void {
    this.log.push(entry);
  }

  update(): void {
    this.log.push("update");
  }
}

/**
 * Builds an app with one host script already awake and started.
 *
 * @returns The harness and the host.
 */
async function createHost(): Promise<{ app: TestAppHarness; host: Host; log: string[] }> {
  const app = await createTestApp();
  harness = app;
  const host = app.world.createEntity("Host").addComponent(Host);
  const log: string[] = [];
  host.log = log;
  app.step(FRAME);
  log.length = 0;
  return { app, host, log };
}

describe("coroutine resume points", () => {
  it("runs the first segment immediately and resumes a bare yield after every update", async () => {
    const { app, host, log } = await createHost();
    const second = app.world.createEntity("Other").addComponent(Host);
    second.log = log;

    host.startCoroutine(
      (function* routine(): Generator<null, void, unknown> {
        log.push("first");
        yield null;
        log.push("resumed");
      })(),
    );
    expect(log).toEqual(["first"]);

    app.step(FRAME);
    // §3 step 6: coroutines resume after **all** scripts' `update`, never between two of them.
    expect(log).toEqual(["first", "update", "update", "resumed"]);
  });

  it("waits scaled seconds, inclusively", async () => {
    const { app, host, log } = await createHost();
    host.startCoroutine(
      (function* routine(): Generator<ReturnType<typeof waitSeconds>, void, unknown> {
        yield waitSeconds(2 / 60);
        log.push("done");
      })(),
    );

    app.step(FRAME);
    expect(log).not.toContain("done");
    app.step(FRAME);
    expect(log).toContain("done");
  });

  it("scales waitSeconds with timeScale but not waitSecondsRealtime", async () => {
    const { app, host, log } = await createHost();
    app.app.time.timeScale = 0.5;
    host.startCoroutine(
      (function* routine(): Generator<ReturnType<typeof waitSeconds>, void, unknown> {
        yield waitSeconds(2 / 60);
        log.push("scaled");
      })(),
    );
    host.startCoroutine(
      (function* routine(): Generator<ReturnType<typeof waitSeconds>, void, unknown> {
        yield waitSecondsRealtime(2 / 60);
        log.push("realtime");
      })(),
    );

    app.step(FRAME);
    app.step(FRAME);
    expect(log).toContain("realtime");
    expect(log).not.toContain("scaled");
    app.step(FRAME);
    app.step(FRAME);
    expect(log).toContain("scaled");
  });

  it("resumes waitFixedUpdate after each fixed step, not at Update", async () => {
    const { app, host, log } = await createHost();
    host.startCoroutine(
      (function* routine(): Generator<ReturnType<typeof waitFixedUpdate>, void, unknown> {
        yield waitFixedUpdate();
        log.push("after-first-step");
        yield waitFixedUpdate();
        log.push("after-second-step");
      })(),
    );

    // Two fixed steps in one frame: both resumptions happen inside the fixed loop, before `update`.
    app.step(2 * FRAME);
    expect(log).toEqual(["after-first-step", "after-second-step", "update"]);
  });

  it("evaluates waitUntil and waitWhile at the Update resume point", async () => {
    const { app, host, log } = await createHost();
    let gate = false;
    host.startCoroutine(
      (function* routine(): Generator<ReturnType<typeof waitUntil>, void, unknown> {
        yield waitUntil(() => gate);
        log.push("opened");
        yield waitWhile(() => gate);
        log.push("closed");
      })(),
    );

    app.step(FRAME);
    expect(log).toEqual(["update"]);
    gate = true;
    app.step(FRAME);
    expect(log).toEqual(["update", "update", "opened"]);
    gate = false;
    app.step(FRAME);
    expect(log).toContain("closed");
  });

  it("waits for another coroutine's handle", async () => {
    const { app, host, log } = await createHost();
    const inner = host.startCoroutine(
      (function* routine(): Generator<null, void, unknown> {
        yield null;
        log.push("inner-done");
      })(),
    );
    host.startCoroutine(
      (function* routine(): Generator<CoroutineHandle, void, unknown> {
        yield inner;
        log.push("outer-done");
      })(),
    );

    app.step(FRAME);
    // Resumed in the same Update the inner coroutine finished in, and the result does not depend on
    // which of the two was started first.
    expect(inner.isDone).toBe(true);
    expect(log).toEqual(["update", "inner-done", "outer-done"]);
  });

  it("delegates to a nested generator with yield*", async () => {
    const { app, host, log } = await createHost();

    function* inner(): Generator<null, void, unknown> {
      log.push("inner");
      yield null;
      log.push("inner-resumed");
    }

    host.startCoroutine(
      (function* outer(): Generator<null, void, unknown> {
        yield* inner();
        log.push("outer-resumed");
      })(),
    );

    expect(log).toEqual(["inner"]);
    app.step(FRAME);
    expect(log).toEqual(["inner", "update", "inner-resumed", "outer-resumed"]);
  });
});

describe("coroutine promise bridging", () => {
  it("resumes on the first Update after settlement with the resolved value", async () => {
    const { app, host, log } = await createHost();
    let settle: (value: string) => void = notSettledYet;
    const promise = new Promise<string>((resolve) => {
      settle = resolve;
    });

    host.startCoroutine(
      (function* routine(): Generator<Promise<string>, void, unknown> {
        const value = yield promise;
        log.push(`resolved:${String(value)}`);
      })(),
    );

    app.step(FRAME);
    expect(log).toEqual(["update"]);

    settle("payload");
    // The microtask that records the settlement runs before the next frame, but the coroutine
    // itself only resumes inside `Update` (ADR-0010).
    await Promise.resolve();
    expect(log).toEqual(["update"]);

    app.step(FRAME);
    expect(log).toEqual(["update", "update", "resolved:payload"]);
  });

  it("throws a rejection into the generator", async () => {
    const { app, host, log } = await createHost();
    const failure = new Error("nope");
    const promise = Promise.reject(failure);

    host.startCoroutine(
      (function* routine(): Generator<Promise<never>, void, unknown> {
        try {
          yield promise;
        } catch (error) {
          log.push(`caught:${(error as Error).message}`);
        }
      })(),
    );

    await Promise.resolve();
    await Promise.resolve();
    app.step(FRAME);
    expect(log).toContain("caught:nope");
  });

  it("detaches a pending promise when the app is disposed", async () => {
    const { app, host, log } = await createHost();
    let settle: (value: string) => void = notSettledYet;
    const promise = new Promise<string>((resolve) => {
      settle = resolve;
    });
    host.startCoroutine(
      (function* routine(): Generator<Promise<string>, void, unknown> {
        yield promise;
        log.push("never");
      })(),
    );

    app.dispose();
    harness = null;
    settle("late");
    await Promise.resolve();
    await Promise.resolve();

    expect(log).not.toContain("never");
  });
});

describe("coroutine ownership", () => {
  it("pauses with its script and resumes when it is enabled again", async () => {
    const { app, host, log } = await createHost();
    host.startCoroutine(
      (function* routine(): Generator<null, void, unknown> {
        for (let index = 0; index < 10; index += 1) {
          log.push(`tick:${String(index)}`);
          yield null;
        }
      })(),
    );

    app.step(FRAME);
    expect(log.filter((entry) => entry.startsWith("tick")).length).toBe(2);

    host.enabled = false;
    app.step(FRAME);
    app.step(FRAME);
    expect(log.filter((entry) => entry.startsWith("tick")).length).toBe(2);

    host.enabled = true;
    app.step(FRAME);
    expect(log.filter((entry) => entry.startsWith("tick")).length).toBe(3);
  });

  it("cancels every coroutine when the owner is destroyed", async () => {
    const { app, host, log } = await createHost();
    const handle = host.startCoroutine(
      (function* routine(): Generator<null, void, unknown> {
        yield null;
        log.push("never");
      })(),
    );

    host.entity.destroy();
    app.step(FRAME);
    app.step(FRAME);

    expect(handle.isDone).toBe(true);
    expect(handle.isRunning).toBe(false);
    expect(log).not.toContain("never");
  });

  it("stops one coroutine and stops them all", async () => {
    const { app, host, log } = await createHost();

    const first = host.startCoroutine(ticker(log, "a"));
    host.startCoroutine(ticker(log, "b"));
    log.length = 0;

    host.stopCoroutine(first);
    expect(first.isDone).toBe(true);
    app.step(FRAME);
    expect(log.filter((entry) => entry === "a")).toHaveLength(0);
    expect(log.filter((entry) => entry === "b")).toHaveLength(1);

    host.stopAllCoroutines();
    log.length = 0;
    app.step(FRAME);
    expect(log.filter((entry) => entry === "b")).toHaveLength(0);
  });

  it("starts paused when the owner is not effectively enabled", async () => {
    const { app, host, log } = await createHost();
    host.enabled = false;
    host.startCoroutine(
      (function* routine(): Generator<null, void, unknown> {
        log.push("started");
        yield null;
      })(),
    );

    expect(log).not.toContain("started");
    host.enabled = true;
    app.step(FRAME);
    expect(log).toContain("started");
  });

  it("reports an exception through app.onError and cancels the coroutine", async () => {
    const { app, host, log } = await createHost();
    const reports: string[] = [];
    app.app.onError.connect((report) => {
      reports.push(`${report.source}:${report.entity?.name ?? "-"}:${report.component?.constructor.name ?? "-"}`);
    });

    const handle = host.startCoroutine(thrower());

    app.step(FRAME);

    expect(reports).toEqual(["coroutine:Host:Host"]);
    expect(handle.isDone).toBe(true);
    expect(log).toContain("update");
  });

  it("reports a throwing predicate and cancels the coroutine", async () => {
    const { app, host } = await createHost();
    const reports: string[] = [];
    app.app.onError.connect((report) => {
      reports.push(report.source);
    });

    const handle = host.startCoroutine(badPredicate());

    app.step(FRAME);

    expect(reports).toEqual(["coroutine"]);
    expect(handle.isDone).toBe(true);
  });

  it("counts resumed coroutines in the frame diagnostics", async () => {
    const { app, host, log } = await createHost();

    host.startCoroutine(ticker(log, "tick"));
    host.startCoroutine(ticker(log, "tick"));
    app.step(FRAME);

    expect(app.app.diagnostics.frame.coroutinesResumed).toBe(2);
  });
});
