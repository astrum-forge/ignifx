import { afterEach, describe, expect, it } from "vitest";
import {
  createApp,
  createManualClock,
  createMemorySink,
  defineSchema,
  f64,
  str,
  array,
  bool,
} from "../../src/index.js";
import type { App, Extension, ExtensionContext, IgnifxError, MemorySink, SettingsInput } from "../../src/index.js";

/** Project settings (`docs/architecture/04-extensions.md` §5) and the core sections of §7. */

interface DemoSettings {
  readonly isEnabled: boolean;
  readonly gravity: number;
  readonly label: string;
}

const DEMO_SCHEMA = defineSchema({
  isEnabled: bool(true),
  gravity: f64(-9.81),
  label: str("demo"),
});

const DEMO_DEFAULTS: DemoSettings = { isEnabled: true, gravity: -9.81, label: "demo" };

const SINGLE_SCHEMA = defineSchema({ names: array(str(), ["a"]) });

let created: App | null = null;
let sink: MemorySink | null = null;

afterEach(() => {
  created?.dispose();
  created = null;
  sink = null;
});

/** A box the demo extension writes its resolved section into. */
interface ResolvedBox {
  /** The resolved section, once `register` has run. */
  value: DemoSettings | null;
}

/**
 * Builds an extension that registers the demo settings section and hands back what it resolved to.
 *
 * @param seen - Where the resolved section is written.
 * @returns The extension.
 */
function demoExtension(seen: ResolvedBox): Extension {
  return {
    name: "game/demo",
    version: "1.0.0",
    register(ctx: ExtensionContext): void {
      ctx.registerSettings<DemoSettings>("demo", DEMO_SCHEMA, DEMO_DEFAULTS);
      seen.value = ctx.settings<DemoSettings>("demo");
    },
  };
}

/**
 * Builds a headless app with settings.
 *
 * @param settings - The project settings.
 * @param extensions - The extensions to register.
 * @param mode - The build mode.
 * @returns The app.
 */
async function build(
  settings: SettingsInput,
  extensions: readonly Extension[] = [],
  mode?: "development" | "production",
): Promise<App> {
  sink = createMemorySink();
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logSink: sink,
    settings,
    extensions,
    ...(mode === undefined ? {} : { mode }),
  });
  created = app;
  return app;
}

/**
 * Catches the failure of a promise and returns its code.
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

describe("core settings sections", () => {
  it("resolves the documented defaults", async () => {
    const app = await build({});
    expect(app.settings.layers.layers).toEqual(["Default", "TransparentFX", "IgnoreRaycast", "Water", "UI"]);
    expect(app.settings.sortingLayers.sortingLayers).toEqual(["Default"]);
    expect(app.settings.time.fixedDeltaTime).toBeCloseTo(1 / 60, 12);
    expect(app.settings.time.maximumDeltaTime).toBe(0.1);
    expect(app.settings.time.timeScale).toBe(1);
  });

  it("accepts the array shorthand of section 5 for a one-field section", async () => {
    const app = await build({ layers: ["Default", "Ground", "Player"] });
    expect(app.settings.layers.layers).toEqual(["Default", "Ground", "Player"]);
    expect(app.world.layers.indexOf("Ground")).toBe(8);
  });

  it("accepts the explicit object form too", async () => {
    const app = await build({ layers: { layers: ["Default", "Ground"] } });
    expect(app.world.layers.indexOf("Ground")).toBe(8);
  });

  it("merges a partial section over its defaults and applies it to the clock", async () => {
    const app = await build({ time: { fixedDeltaTime: 1 / 120 } });
    expect(app.settings.time.fixedDeltaTime).toBeCloseTo(1 / 120, 12);
    expect(app.settings.time.maximumDeltaTime).toBe(0.1);
    expect(app.time.fixedDeltaTime).toBeCloseTo(1 / 120, 12);
    expect(app.time.maximumDeltaTime).toBe(0.1);
  });

  it("freezes the resolved sections", async () => {
    const app = await build({});
    expect(Object.isFrozen(app.settings.time)).toBe(true);
  });
});

describe("extension settings sections", () => {
  it("resolves inside the same register call that declared the section", async () => {
    const seen: ResolvedBox = { value: null };
    await build({ demo: { gravity: -1 } }, [demoExtension(seen)]);
    expect(seen.value).toEqual({ isEnabled: true, gravity: -1, label: "demo" });
  });

  it("throws IGX-0408 in development when a value does not validate", async () => {
    const seen: ResolvedBox = { value: null };
    expect(await codeOf(build({ demo: { gravity: "heavy" } }, [demoExtension(seen)]))).toBe("IGX-0408");
  });

  it("throws IGX-0408 when the section is not an object and has no shorthand", async () => {
    const seen: ResolvedBox = { value: null };
    expect(await codeOf(build({ demo: 7 }, [demoExtension(seen)]))).toBe("IGX-0408");
  });

  it("falls back to the defaults with a warning in production", async () => {
    const seen: ResolvedBox = { value: null };
    await build({ demo: { gravity: "heavy" } }, [demoExtension(seen)], "production");
    expect(seen.value).toEqual(DEMO_DEFAULTS);
    expect(sink?.toArray().some((record) => record.level === "warn")).toBe(true);
  });

  it("throws IGX-0407 in development for a section no extension registered", async () => {
    expect(await codeOf(build({ mystery: {} }))).toBe("IGX-0407");
  });

  it("warns and ignores an unknown section in production", async () => {
    const app = await build({ mystery: {} }, [], "production");
    expect(app.isHeadless).toBe(true);
    expect(sink?.toArray().some((record) => record.level === "warn" && record.message.includes("mystery"))).toBe(true);
  });

  it("throws IGX-0407 when a section is read but never registered", async () => {
    const app = await build({});
    expect(() => app.settings.section("nothing")).toThrow(/nothing/u);
  });

  it("applies the single-field shorthand to an extension section too", async () => {
    let resolved: { names: readonly string[] } | null = null;
    await build({ single: ["x", "y"] }, [
      {
        name: "game/single",
        version: "1.0.0",
        register(ctx: ExtensionContext): void {
          ctx.registerSettings("single", SINGLE_SCHEMA, { names: ["a"] });
          resolved = ctx.settings<{ names: readonly string[] }>("single");
        },
      },
    ]);
    expect(resolved).toEqual({ names: ["x", "y"] });
  });
});
