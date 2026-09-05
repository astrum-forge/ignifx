import { afterEach, describe, expect, it } from "vitest";
import { Phase, Script, createApp, createManualClock, createMemorySink } from "../../src/index.js";
import type { App, Extension, ExtensionContext, IgnifxError, MemorySink } from "../../src/index.js";

/**
 * Every numbered rule of `docs/architecture/04-extensions.md` §2, plus the contributions of §1 and
 * §3 and the settings rules of §5.
 *
 * The `declare module` block below is the augmentation pattern extensions use. Inside this
 * repository the specifier is the barrel's relative path; a published extension writes
 * `declare module "@ignifx/core"` instead — the mechanism is the same, TypeScript resolves the
 * re-exported `App` back to the interface that declares it and merges into that.
 *
 * The member is declared **optional** here for one reason: an augmentation is program-wide, so a
 * required member would oblige every hand-written implementation of `App` in the same compilation
 * — including `test/support/test-app.ts`, the scene-graph suites' fake app — to provide it. A
 * published extension declares its member required, because nothing in a game hand-implements
 * `App`.
 */

class DemoService {
  readonly answer = 42;
}

declare module "../../src/index.js" {
  interface App {
    /** The demo service the suite's extension defines. */
    readonly demo?: DemoService;
  }
}

let created: App | null = null;
let sink: MemorySink | null = null;

afterEach(() => {
  created?.dispose();
  created = null;
  sink = null;
});

/**
 * Builds a headless app with a list of extensions.
 *
 * @param extensions - The extensions to register.
 * @param mode - The build mode; defaults to development.
 * @returns The app.
 */
async function build(extensions: readonly Extension[], mode?: "development" | "production"): Promise<App> {
  sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logSink: sink,
    // The host's "development note" for a dropped optional cycle is a debug line; the default
    // threshold is `info`, so the tests that read it opt in.
    logLevel: "debug",
    extensions,
    ...(mode === undefined ? {} : { mode }),
  });
  created = app;
  return app;
}

/**
 * Builds a minimal extension descriptor.
 *
 * @param name - The extension name.
 * @param extra - Anything else the descriptor carries.
 * @returns The extension.
 */
function extension(name: string, extra?: Partial<Extension>): Extension {
  return { name, version: "1.0.0", register: () => undefined, ...extra };
}

/**
 * Catches the failure of a promise and returns it.
 *
 * @param promise - The promise expected to reject.
 * @returns The `IgnifxError` code.
 */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as IgnifxError).code;
  }
  return "no-error";
}

describe("registration order and validation", () => {
  it("registers the core extension first, implicitly", async () => {
    const order: string[] = [];
    const app = await build([
      extension("game/a", {
        register: (ctx: ExtensionContext): void => {
          order.push(ctx.app.version === "" ? "?" : "game/a");
          // The core extension has already registered its sections by the time a game one runs.
          expect(ctx.settings<{ layers: readonly string[] }>("layers").layers).toContain("Default");
        },
      }),
    ]);
    expect(order).toEqual(["game/a"]);
    expect(app.settings.layers.layers[0]).toBe("Default");
  });

  it("sorts by requires and keeps list order for unrelated extensions", async () => {
    const order: string[] = [];
    /**
     * Builds an extension that records when it registers.
     *
     * @param name - Its name.
     * @param requires - What it requires.
     * @returns The extension.
     */
    const recorder = (name: string, requires?: readonly string[]): Extension =>
      extension(name, {
        register: (): void => {
          order.push(name);
        },
        ...(requires === undefined ? {} : { requires }),
      });

    await build([
      recorder("game/c", ["game/b"]),
      recorder("game/b", ["game/a"]),
      recorder("game/a"),
      recorder("game/d"),
    ]);

    expect(order).toEqual(["game/a", "game/b", "game/c", "game/d"]);
  });

  it("throws IGX-0406 on a duplicate name", async () => {
    expect(await codeOf(build([extension("game/a"), extension("game/a")]))).toBe("IGX-0406");
  });

  it("throws IGX-0403 when a required extension is missing", async () => {
    expect(await codeOf(build([extension("game/a", { requires: ["game/missing"] })]))).toBe("IGX-0403");
  });

  it("throws IGX-0402 on a requires cycle", async () => {
    const code = await codeOf(
      build([extension("game/a", { requires: ["game/b"] }), extension("game/b", { requires: ["game/a"] })]),
    );
    expect(code).toBe("IGX-0402");
  });

  it("drops an optional cycle with a development note and keeps list order", async () => {
    const order: string[] = [];
    /**
     * Builds an extension that optionally integrates with another.
     *
     * @param name - Its name.
     * @param optional - What it integrates with.
     * @returns The extension.
     */
    const pair = (name: string, optional: readonly string[]): Extension =>
      extension(name, {
        optional,
        register: (): void => {
          order.push(name);
        },
      });

    await build([pair("game/physics", ["game/devtools"]), pair("game/devtools", ["game/physics"])]);

    expect(order).toEqual(["game/devtools", "game/physics"]);
    expect(sink?.toArray().some((record) => record.message.includes("Dropped the optional dependency"))).toBe(true);
  });

  it("throws IGX-0404 in development when the engine range does not match", async () => {
    expect(await codeOf(build([extension("game/a", { engine: ">=99.0.0" })]))).toBe("IGX-0404");
  });

  it("warns instead of throwing in production when the engine range does not match", async () => {
    const app = await build([extension("game/a", { engine: ">=99.0.0" })], "production");
    expect(app.isRunning).toBe(false);
    expect(sink?.toArray().some((record) => record.level === "warn" && record.message.includes("game/a"))).toBe(true);
  });

  it("accepts an engine range that covers the running core version", async () => {
    const app = await build([extension("game/a", { engine: ">=0.0.0 <1.0.0" })]);
    expect(app.version).toBe("0.0.0");
  });

  it("awaits an async register hook before starting the next one", async () => {
    const order: string[] = [];
    await build([
      extension("game/slow", {
        requires: [],
        register: async (): Promise<void> => {
          await Promise.resolve();
          order.push("slow");
        },
      }),
      extension("game/fast", {
        requires: ["game/slow"],
        register: (): void => {
          order.push("fast");
        },
      }),
    ]);
    expect(order).toEqual(["slow", "fast"]);
  });
});

describe("what an extension contributes", () => {
  it("registers components, systems, services, and a typed app property", async () => {
    class Mover extends Script {
      static typeId = "test/ExtMover";
    }
    let ran = 0;
    const app = await build([
      extension("game/demo", {
        register: (ctx: ExtensionContext): void => {
          ctx.registerComponents([Mover]);
          ctx.registerSystem(
            {
              name: "demo",
              update: (): void => {
                ran += 1;
              },
            },
            { phase: Phase.PreUpdate },
          );
          const service = new DemoService();
          ctx.registerService(DemoService, service);
          ctx.defineAppProperty("demo", () => service);
        },
      }),
    ]);

    expect(app.world.registry.get("test/ExtMover")).toBe(Mover);
    expect(app.services.get(DemoService).answer).toBe(42);
    expect(app.demo?.answer).toBe(42);
    app.step(1 / 60);
    expect(ran).toBe(1);
  });

  it("throws IGX-0401 when two extensions define the same app property", async () => {
    /**
     * Builds an extension that defines the `demo` property.
     *
     * @param name - Its name.
     * @returns The extension.
     */
    const definer = (name: string): Extension =>
      extension(name, {
        register: (ctx: ExtensionContext): void => {
          ctx.defineAppProperty("demo", () => new DemoService());
        },
      });
    expect(await codeOf(build([definer("game/a"), definer("game/b")]))).toBe("IGX-0401");
  });

  it("throws IGX-0401 when an app property would shadow a core App member", async () => {
    const code = await codeOf(
      build([
        extension("game/a", {
          register: (ctx: ExtensionContext): void => {
            ctx.defineAppProperty("time", () => null);
          },
        }),
      ]),
    );
    expect(code).toBe("IGX-0401");
  });

  it("resolves services through require and tryGet", async () => {
    let required: DemoService | null = null;
    let optional: DemoService | null = null;
    await build([
      extension("game/provider", {
        register: (ctx: ExtensionContext): void => {
          ctx.registerService(DemoService, new DemoService());
        },
      }),
      extension("game/consumer", {
        requires: ["game/provider"],
        register: (ctx: ExtensionContext): void => {
          required = ctx.require(DemoService);
          optional = ctx.tryGet(DemoService);
        },
      }),
    ]);
    expect(required).toBeInstanceOf(DemoService);
    expect(optional).toBeInstanceOf(DemoService);
  });

  it("throws IGX-0405 when require asks for a service nothing registered", async () => {
    const code = await codeOf(
      build([
        extension("game/consumer", {
          register: (ctx: ExtensionContext): void => {
            ctx.require(DemoService);
          },
        }),
      ]),
    );
    expect(code).toBe("IGX-0405");
  });

  it("registers error codes and rejects a duplicate", async () => {
    await build([
      extension("game/codes", {
        register: (ctx: ExtensionContext): void => {
          ctx.registerErrorCodes({ "IGX-9001": "The {thing} was not spawned." });
        },
      }),
    ]);
    const code = await codeOf(
      build([
        extension("game/codes", {
          register: (ctx: ExtensionContext): void => {
            ctx.registerErrorCodes({ "IGX-0101": "already core's" });
          },
        }),
      ]),
    );
    expect(code).toBe("IGX-1501");
  });
});

describe("start, stop, and dispose order", () => {
  it("runs onStart in order and onStop and dispose in reverse", async () => {
    const order: string[] = [];
    /**
     * Builds an extension that records each hook.
     *
     * @param name - Its name.
     * @returns The extension.
     */
    const hooks = (name: string): Extension =>
      extension(name, {
        register: (ctx: ExtensionContext): void => {
          ctx.onDispose(() => {
            order.push(`onDispose:${name}`);
          });
        },
        onStart: (): void => {
          order.push(`onStart:${name}`);
        },
        onStop: (): void => {
          order.push(`onStop:${name}`);
        },
        dispose: (): void => {
          order.push(`dispose:${name}`);
        },
      });

    const app = await build([hooks("game/a"), hooks("game/b")]);
    await app.start();
    expect(order).toEqual(["onStart:game/a", "onStart:game/b"]);

    order.length = 0;
    app.dispose();
    created = null;
    expect(order).toEqual([
      "onStop:game/b",
      "onStop:game/a",
      "dispose:game/b",
      "dispose:game/a",
      "onDispose:game/b",
      "onDispose:game/a",
    ]);
  });

  it("awaits an async onStart hook", async () => {
    const order: string[] = [];
    const app = await build([
      extension("game/a", {
        onStart: async (): Promise<void> => {
          await Promise.resolve();
          order.push("a");
        },
      }),
      extension("game/b", {
        requires: ["game/a"],
        onStart: (): void => {
          order.push("b");
        },
      }),
    ]);
    await app.start();
    expect(order).toEqual(["a", "b"]);
  });

  it("reports a throwing teardown hook instead of stranding the rest", async () => {
    const order: string[] = [];
    const app = await build([
      extension("game/a", {
        dispose: (): void => {
          order.push("a");
        },
      }),
      extension("game/b", {
        dispose: (): void => {
          throw new Error("teardown boom");
        },
      }),
    ]);
    const sources: string[] = [];
    app.onError.connect((report) => {
      sources.push(report.source);
    });

    app.dispose();
    created = null;

    expect(sources).toEqual(["extension"]);
    expect(order).toEqual(["a"]);
  });
});
