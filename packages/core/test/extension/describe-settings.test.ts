import { afterEach, describe, expect, it } from "vitest";
import {
  array,
  createApp,
  createManualClock,
  createMemorySink,
  defineSchema,
  describeSettings,
  enumOf,
  f64,
  record,
  SETTINGS_DESCRIPTION_FORMAT,
  settingsJsonSchema,
  str,
} from "../../src/index.js";
import type { App, Extension, IgnifxError, SettingsInput } from "../../src/index.js";

/** `describeSettings` and `settingsJsonSchema`: every registered settings section, described. */

let created: App | null = null;

afterEach(() => {
  created?.dispose();
  created = null;
});

/** A game extension declaring two sections through the ordinary `ctx.registerSettings` seam. */
const WEATHER: Extension = {
  name: "@game/weather",
  version: "1.0.0",
  register(ctx): void {
    ctx.registerSettings(
      "weather",
      defineSchema({
        // The schema's own default (0.5) differs from the registered one (0.25) on purpose.
        wind: f64(0.5, { min: 0, max: 1, step: 0.05, tooltip: "Wind strength.", group: "Air" }),
        kind: enumOf(["clear", "rain", "snow"], "clear"),
        tint: record({ name: str("none") }),
      }),
      { wind: 0.25, kind: "rain", tint: { name: "none" } },
    );
    ctx.registerSettings("biomes", defineSchema({ biomes: array(str(), ["forest"]) }), { biomes: ["forest"] });
  },
};

/**
 * Builds a headless app.
 *
 * @param settings - The project settings.
 * @param extensions - The extensions to register.
 * @returns The app.
 */
async function build(settings: SettingsInput = {}, extensions: readonly Extension[] = []): Promise<App> {
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logSink: createMemorySink(),
    settings,
    extensions,
  });
  created = app;
  return app;
}

describe("describeSettings", () => {
  it("describes core's own sections, in registration order, as @ignifx/core settings", async () => {
    const sections = describeSettings(await build());
    expect(Object.keys(sections)).toEqual(["layers", "sortingLayers", "time", "assets", "rendering"]);
    for (const section of Object.values(sections)) {
      expect(section.format).toBe(SETTINGS_DESCRIPTION_FORMAT);
      expect(section.package).toBe("@ignifx/core");
    }
    expect(sections["time"]?.title).toBe("time");
    expect(sections["time"]?.fields["fixedDeltaTime"]).toMatchObject({ kind: "f64", default: 0.016667 });
    expect(sections["time"]?.fields["timeScale"]).toMatchObject({ kind: "f64", default: 1, min: 0 });
    expect(sections["layers"]?.fields["layers"]).toMatchObject({
      kind: "array",
      default: ["Default", "TransparentFX", "IgnoreRaycast", "Water", "UI"],
      item: { kind: "str" },
    });
    expect(sections["assets"]?.fields["concurrency"]).toMatchObject({ kind: "u32", default: 6, min: 1 });
    expect(sections["rendering"]?.fields["features"]?.kind).toBe("record");
  });

  it("describes a section an extension registered, with its package, metadata and registered defaults", async () => {
    const sections = describeSettings(await build({}, [WEATHER]));
    expect(Object.keys(sections).slice(-2)).toEqual(["weather", "biomes"]);
    const weather = sections["weather"];
    expect(weather?.package).toBe("@game/weather");
    expect(weather?.format).toBe("settings");
    expect(weather?.fields["wind"]).toEqual({
      kind: "f64",
      default: 0.25,
      description: "Wind strength.",
      min: 0,
      max: 1,
      step: 0.05,
      group: "Air",
    });
    expect(weather?.fields["kind"]).toEqual({ kind: "enum", default: "rain", values: ["clear", "rain", "snow"] });
    expect(weather?.fields["tint"]?.fields?.["name"]).toEqual({ kind: "str", default: "none" });
  });

  it("describes defaults, not the project's values", async () => {
    const sections = describeSettings(await build({ time: { timeScale: 2 } }));
    expect(sections["time"]?.fields["timeScale"]?.default).toBe(1);
  });

  it("is JSON-safe, so a host can post it across a frame boundary", async () => {
    const sections = describeSettings(await build({}, [WEATHER]));
    expect(JSON.parse(JSON.stringify(sections))).toEqual(sections);
  });

  it("throws IGX-0702 for an app core did not create", () => {
    let code = "no-error";
    try {
      // A stand-in app whose settings table is not core's own.
      describeSettings({ settings: { section: () => ({}) } } as unknown as App);
    } catch (error) {
      code = (error as IgnifxError).code;
    }
    expect(code).toBe("IGX-0702");
  });
});

describe("settingsJsonSchema", () => {
  it("lists every section as an optional property and refuses unknown sections", async () => {
    const schema = settingsJsonSchema(await build({}, [WEATHER]));
    expect(schema["type"]).toBe("object");
    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toBeUndefined();
    expect(Object.keys(schema["properties"] as object)).toEqual([
      "layers",
      "sortingLayers",
      "time",
      "assets",
      "rendering",
      "weather",
      "biomes",
    ]);
  });

  it("accepts the one-field shorthand alongside the object form", async () => {
    const properties = settingsJsonSchema(await build({}, [WEATHER]))["properties"] as Record<string, unknown>;
    expect(properties["biomes"]).toMatchObject({
      oneOf: [
        { type: "object", properties: { biomes: { type: "array" } }, additionalProperties: false },
        { type: "array", items: { type: "string" } },
      ],
    });
    expect(properties["weather"]).toMatchObject({ type: "object", additionalProperties: false });
    expect(properties["weather"]).not.toHaveProperty("oneOf");
  });
});
