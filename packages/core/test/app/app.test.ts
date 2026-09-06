import { afterEach, describe, expect, it, vi } from "vitest";
import { Script, createApp, createManualClock, createMemorySink, defineExtension } from "../../src/index.js";
import type { App, IgnifxError } from "../../src/index.js";

/**
 * `createApp` and the `App` surface (`docs/architecture/00-overview.md` §1,
 * `01-lifecycle-and-time.md` §7–§8, `07-rendering.md` §7, `14-platform-electron.md` §1, §5).
 */

const FRAME = 1 / 60;

let created: App | null = null;

afterEach(() => {
  created?.dispose();
  created = null;
});

/**
 * Builds a headless app on a manual clock and a memory sink.
 *
 * @returns The app.
 */
async function build(): Promise<App> {
  const app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
  created = app;
  return app;
}

/**
 * The `IgnifxError` code a thunk throws.
 *
 * @param thunk - What should throw.
 * @returns The code, or `"no-error"`.
 */
function codeOf(thunk: () => unknown): string {
  try {
    thunk();
  } catch (error) {
    return (error as IgnifxError).code;
  }
  return "no-error";
}

describe("createApp", () => {
  it("defaults to headless when no canvas is given", async () => {
    const app = await build();
    expect(app.isHeadless).toBe(true);
    expect(app.isRunning).toBe(false);
    expect(app.version).toBe("0.0.0");
    expect(app.platform.kind).toBe("node");
    expect(app.lite.engine).toBeDefined();
    expect(app.lite.scene).toBeDefined();
    expect(app.world.scenes).toHaveLength(1);
    expect(app.world.activeScene.name).toBe("default");
  });

  it("registers Transform through the implicit core extension", async () => {
    const app = await build();
    expect(app.world.registry.get("ignifx/Transform")).not.toBeNull();
  });

  it("starts and stops without a render loop in headless mode", async () => {
    const app = await build();
    await app.start();
    expect(app.isRunning).toBe(true);
    app.step(FRAME);
    expect(app.time.frameCount).toBe(1);
    app.stop();
    expect(app.isRunning).toBe(false);
    // Stopping twice is a no-op, and a stopped app can be started again.
    app.stop();
    await app.start();
    expect(app.isRunning).toBe(true);
  });

  it("keeps two apps in one process fully independent", async () => {
    // CONSTITUTION.md §3.6: no ambient singletons.
    const first = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
    const second = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
    try {
      first.step(FRAME);
      first.step(FRAME);
      second.step(FRAME);
      expect(first.time.frameCount).toBe(2);
      expect(second.time.frameCount).toBe(1);
      expect(first.world).not.toBe(second.world);
      expect(first.lite.scene).not.toBe(second.lite.scene);
      expect(first.services).not.toBe(second.services);
      first.world.createEntity("Only in the first");
      expect(second.world.findByName("Only in the first")).toBeNull();
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("throws IGX-0107 when the world is read from inside register", async () => {
    let code = "no-error";
    const app = await createApp({
      headless: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
      extensions: [
        defineExtension(() => ({
          name: "game/early",
          version: "1.0.0",
          register(ctx): void {
            code = codeOf(() => ctx.app.world);
          },
        }))(),
      ],
    });
    created = app;
    expect(code).toBe("IGX-0107");
  });
});

describe("stepping and disposal", () => {
  it("throws IGX-0106 once the app has been disposed", async () => {
    const app = await build();
    app.dispose();
    created = null;
    expect(codeOf(() => app.step(FRAME))).toBe("IGX-0106");
    expect(codeOf(() => app.world)).toBe("IGX-0106");
    expect(codeOf(() => app.lite)).toBe("IGX-0106");
    expect(codeOf(() => app.registerComponents([]))).toBe("IGX-0106");
    await expect(app.start()).rejects.toThrow(/disposed/u);
  });

  it("disposes twice without complaining", async () => {
    const app = await build();
    app.dispose();
    created = null;
    expect(() => app.dispose()).not.toThrow();
  });

  it("destroys every entity when the app is disposed", async () => {
    const app = await build();
    const log: string[] = [];

    class Farewell extends Script {
      static typeId = "test/Farewell";
      onDisable(): void {
        log.push("onDisable");
      }
      onDestroy(): void {
        log.push("onDestroy");
      }
    }

    const entity = app.world.createEntity("A");
    entity.addComponent(Farewell);
    app.step(FRAME);

    app.dispose();
    created = null;
    expect(log).toEqual(["onDisable", "onDestroy"]);
    expect(entity.isDestroyed).toBe(true);
  });

  it("pauses and resumes the clock", async () => {
    const app = await build();
    expect(app.time.paused).toBe(false);
    app.pause();
    expect(app.time.paused).toBe(true);
    app.resume();
    expect(app.time.paused).toBe(false);
  });
});

describe("component registration", () => {
  it("throws IGX-0203 when two classes claim one typeId", async () => {
    const app = await build();

    class First extends Script {
      static typeId = "test/Collide";
    }
    class Second extends Script {
      static typeId = "test/Collide";
    }

    app.registerComponents([First]);
    expect(codeOf(() => app.registerComponents([Second]))).toBe("IGX-0203");
  });
});

describe("app.onError", () => {
  it("logs every report through the default handler", async () => {
    const sink = createMemorySink();
    const app = await createApp({ headless: true, clock: createManualClock(), logSink: sink });
    created = app;

    class Thrower extends Script {
      static typeId = "test/Thrower";
      update(): void {
        throw new Error("script boom");
      }
    }

    const reports: string[] = [];
    app.onError.connect((report) => {
      reports.push(`${report.source}:${report.entity?.name ?? "-"}`);
    });
    app.world.createEntity("Bad").addComponent(Thrower);
    app.step(FRAME);

    expect(reports).toEqual(["lifecycle:Bad"]);
    const errors = sink.toArray().filter((record) => record.level === "error");
    expect(errors).toHaveLength(1);
    // The logger does not interpolate, so the line is assembled before it is logged and the thrown
    // error rides along as structured data.
    expect(errors[0]?.message).toBe("A lifecycle boundary caught a failure in Update on Bad/Thrower.");
    expect(errors[0]?.data).toHaveLength(1);
    expect(errors[0]?.data[0]).toBeInstanceOf(Error);
  });

  it("survives a handler that throws", async () => {
    const app = await build();
    app.onError.connect(() => {
      throw new Error("handler boom");
    });

    class Thrower extends Script {
      static typeId = "test/Thrower2";
      update(): void {
        throw new Error("script boom");
      }
    }

    app.world.createEntity("Bad").addComponent(Thrower);
    expect(() => app.step(FRAME)).not.toThrow();
  });
});

/** A document/window pair that records its listeners so the suite can fire them. */
interface FakeHost {
  /** The registered listeners, by event name. */
  readonly listeners: Map<string, Set<() => void>>;
  /** What `document.hidden` reports. */
  hidden: boolean;
}

/**
 * Fires every listener registered for an event.
 *
 * @param host - The fake host.
 * @param name - The event name.
 */
function fire(host: FakeHost, name: string): void {
  for (const handler of host.listeners.get(name) ?? []) {
    handler();
  }
}

describe("the browser wiring, driven headlessly", () => {
  /**
   * Installs a fake `document` and `window` so the browser branches of `start`, `stop`, and the
   * application callbacks are exercised without a GPU (the real thing is
   * `test/app/browser.browser.test.ts`).
   *
   * @returns The recorded listeners.
   */
  function stubDocument(): FakeHost {
    const listeners = new Map<string, Set<() => void>>();
    const host: FakeHost = { listeners, hidden: false };
    const add = (name: string, handler: () => void): void => {
      let bucket = listeners.get(name);
      if (bucket === undefined) {
        bucket = new Set<() => void>();
        listeners.set(name, bucket);
      }
      bucket.add(handler);
    };
    const remove = (name: string, handler: () => void): void => {
      listeners.get(name)?.delete(handler);
    };
    vi.stubGlobal("document", {
      addEventListener: add,
      removeEventListener: remove,
      get hidden(): boolean {
        return host.hidden;
      },
    });
    vi.stubGlobal("window", { addEventListener: add, removeEventListener: remove });
    return host;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the document listeners on start and removes them on stop", async () => {
    const host = stubDocument();
    const app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink() });
    created = app;
    expect(app.platform.kind).toBe("browser");

    const seen: string[] = [];

    class Listener extends Script {
      static typeId = "test/Listener";
      onApplicationPause(isPaused: boolean): void {
        seen.push(`pause:${String(isPaused)}`);
      }
      onApplicationFocus(isFocused: boolean): void {
        seen.push(`focus:${String(isFocused)}`);
      }
    }

    app.world.createEntity("Listener").addComponent(Listener);
    app.step(FRAME);

    await app.start();
    host.hidden = true;
    fire(host, "visibilitychange");
    host.hidden = false;
    fire(host, "visibilitychange");
    fire(host, "blur");
    fire(host, "focus");

    expect(seen).toEqual(["pause:true", "pause:false", "focus:false", "focus:true"]);

    app.stop();
    seen.length = 0;
    fire(host, "visibilitychange");
    expect(seen).toEqual([]);
  });

  it("starting twice is a no-op", async () => {
    stubDocument();
    let starts = 0;
    const app = await createApp({
      headless: true,
      clock: createManualClock(),
      logSink: createMemorySink(),
      extensions: [
        defineExtension(() => ({
          name: "game/counter",
          version: "1.0.0",
          register: () => undefined,
          onStart(): void {
            starts += 1;
          },
        }))(),
      ],
    });
    created = app;
    await app.start();
    await app.start();
    expect(starts).toBe(1);
  });
});
