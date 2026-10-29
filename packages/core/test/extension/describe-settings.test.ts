import { afterEach, describe, expect, it } from "vitest";
import {
  array,
  asset,
  Camera,
  color,
  componentRef,
  createApp,
  curve,
  custom,
  entityRef,
  i32,
  layerMask,
  map,
  optional,
  quat,
  TextureAsset,
  u32,
  vec2,
  vec3,
  vec4,
  bool,
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
    // Registered without a defaults bag: the schema's own defaults are the section's defaults.
    ctx.registerSettings("fog", defineSchema({ density: f64(0.1), color: str("grey") }), undefined);
  },
};

/** A section declaring one field of every kind, with registered defaults that differ from the schema's. */
const EVERY_KIND: Extension = {
  name: "@game/kinds",
  version: "1.0.0",
  register(ctx): void {
    ctx.registerSettings(
      "kinds",
      defineSchema({
        v2: vec2(),
        v3: vec3(),
        v4: vec4(),
        q: quat(),
        tint: color(),
        points: array(vec3()),
        style: record({ shade: color({ r: 0, g: 0, b: 1, a: 1 }) }),
        byName: map(vec2()),
        maybe: optional(vec3()),
        target: entityRef(),
        camera: componentRef(Camera),
        texture: asset(TextureAsset),
        mask: layerMask(),
        ease: curve(),
        grid: custom({ createDefault: () => [0, 0], serialize: (value: number[]) => value, deserialize: () => [0, 0] }),
        count: i32(0),
        size: u32(0),
        on: bool(false),
      }),
      {
        v2: { x: 1, y: 2 },
        v3: { x: 1, y: 2, z: 3 },
        v4: { x: 1, y: 2, z: 3, w: 4 },
        q: { x: 0, y: 0, z: 0, w: 1 },
        tint: { r: 1, g: 0.5, b: 0, a: 1 },
        points: [{ x: 0, y: 1, z: 0 }],
        style: { shade: { r: 0, g: 0, b: 1, a: 1 } },
        byName: { a: { x: 1, y: 1 } },
        maybe: null,
        target: null,
        camera: null,
        texture: { address: "textures/a.png", type: "texture" },
        mask: ["Default"],
        ease: { keys: [[0, 0, 0, 0]] },
        grid: [1, 2],
        count: -1,
        size: 4,
        on: true,
      },
    );
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
    expect(sections["time"]?.fields["fixedDeltaTime"]).toMatchObject({ kind: "f64", default: 1 / 60 });
    expect(sections["time"]?.fields["timeScale"]).toMatchObject({ kind: "f64", default: 1, min: 0 });
    expect(sections["layers"]?.fields["layers"]).toMatchObject({
      kind: "array",
      default: ["Default", "TransparentFX", "IgnoreRaycast", "Water", "UI"],
      item: { kind: "str" },
    });
    expect(sections["assets"]?.fields["concurrency"]).toMatchObject({ kind: "u32", default: 6, min: 1 });
    expect(sections["rendering"]?.fields["features"]?.kind).toBe("record");
    // Settings are written in the form createApp reads: a colour is { r, g, b, a }, not an array.
    expect(sections["rendering"]?.fields["clearColor"]).toMatchObject({
      kind: "color",
      default: { r: 0, g: 0, b: 0, a: 1 },
    });
  });

  it("leaves default off a field the registered defaults omit, since the resolved section lacks it", async () => {
    const partial: Extension = {
      name: "@game/partial",
      version: "1.0.0",
      register(ctx): void {
        ctx.registerSettings("partial", defineSchema({ speed: f64(2), label: str("x") }), { speed: 3 });
      },
    };
    const app = await build({}, [partial]);
    const fields = describeSettings(app)["partial"]?.fields;
    expect(fields?.["speed"]?.default).toBe(3);
    expect(fields?.["label"]).toEqual({ kind: "str" });
    expect(app.settings.section<Record<string, unknown>>("partial")["label"]).toBeUndefined();
  });

  it("describes every field kind with defaults in the settings form, at every depth", async () => {
    const sections = describeSettings(await build({}, [EVERY_KIND]));
    const fields = sections["kinds"]?.fields ?? {};
    expect(fields["v2"]?.default).toEqual({ x: 1, y: 2 });
    expect(fields["v3"]?.default).toEqual({ x: 1, y: 2, z: 3 });
    expect(fields["v4"]?.default).toEqual({ x: 1, y: 2, z: 3, w: 4 });
    expect(fields["q"]?.default).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(fields["tint"]?.default).toEqual({ r: 1, g: 0.5, b: 0, a: 1 });
    expect(fields["points"]).toMatchObject({
      default: [{ x: 0, y: 1, z: 0 }],
      item: { default: { x: 0, y: 0, z: 0 } },
    });
    expect(fields["style"]).toMatchObject({
      default: { shade: { r: 0, g: 0, b: 1, a: 1 } },
      fields: { shade: { default: { r: 0, g: 0, b: 1, a: 1 } } },
    });
    expect(fields["byName"]).toMatchObject({ default: { a: { x: 1, y: 1 } }, value: { default: { x: 0, y: 0 } } });
    expect(fields["maybe"]).toMatchObject({ default: null, inner: { default: { x: 0, y: 0, z: 0 } } });
    expect(fields["target"]?.default).toBeNull();
    expect(fields["camera"]?.default).toBeNull();
    expect(fields["texture"]?.default).toEqual({ address: "textures/a.png", type: "texture" });
    expect(fields["mask"]?.default).toEqual(["Default"]);
    expect(fields["ease"]?.default).toEqual({ keys: [[0, 0, 0, 0]] });
    expect(fields["grid"]?.default).toEqual([1, 2]);
    expect(fields["count"]?.default).toBe(-1);
    expect(fields["size"]?.default).toBe(4);
    expect(fields["on"]?.default).toBe(true);
  });

  it("describes a section an extension registered, with its package, metadata and registered defaults", async () => {
    const sections = describeSettings(await build({}, [WEATHER]));
    expect(Object.keys(sections).slice(-3)).toEqual(["weather", "biomes", "fog"]);
    expect(sections["fog"]?.fields["density"]?.default).toBe(0.1);
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

  it("keeps a __proto__ key in a map default as an entry", async () => {
    // A key parsed from JSON is an ordinary own key, `__proto__` included. A `record` cannot
    // declare a `__proto__` field at all: `record()` refuses the name (schema field-kinds tests).
    const tags: unknown = JSON.parse('{ "__proto__": { "x": 1, "y": 2 }, "a": { "x": 3, "y": 4 } }');
    const proto: Extension = {
      name: "@game/proto",
      version: "1.0.0",
      register(ctx): void {
        ctx.registerSettings("proto", defineSchema({ tags: map(vec2()) }), { tags } as never);
      },
    };
    const fields = describeSettings(await build({}, [proto]))["proto"]?.fields;
    const value = fields?.["tags"]?.default;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value as object)).toEqual(["__proto__", "a"]);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({ x: 1, y: 2 });
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
  it("lists every section as an optional property and leaves unknown sections to createApp", async () => {
    const schema = settingsJsonSchema(await build({}, [WEATHER]));
    expect(schema["type"]).toBe("object");
    expect(schema["additionalProperties"]).toBeUndefined();
    expect(schema["required"]).toBeUndefined();
    expect(Object.keys(schema["properties"] as object)).toEqual([
      "layers",
      "sortingLayers",
      "time",
      "assets",
      "rendering",
      "weather",
      "biomes",
      "fog",
    ]);
  });

  it("describes vectors and colours as channel objects with every channel required", async () => {
    const properties = settingsJsonSchema(await build({}, [EVERY_KIND]))["properties"] as Record<string, unknown>;
    const kinds = (properties["kinds"] as { properties: Record<string, unknown> }).properties;
    expect(kinds["v3"]).toMatchObject({
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
      required: ["x", "y", "z"],
      default: { x: 1, y: 2, z: 3 },
    });
    expect(kinds["tint"]).toMatchObject({
      type: "object",
      properties: { r: { type: "number", minimum: 0, maximum: 1 } },
      required: ["r", "g", "b", "a"],
    });
    expect(kinds["maybe"]).toMatchObject({ anyOf: [{ type: "object" }, { type: "null" }], default: null });
    expect(kinds["byName"]).toMatchObject({ type: "object", additionalProperties: { required: ["x", "y"] } });
    expect(kinds["style"]).toMatchObject({ type: "object", additionalProperties: false });
    expect(kinds["texture"]).toMatchObject({ oneOf: [{ required: ["address"] }, { type: "null" }] });
    expect(kinds["ease"]).toMatchObject({ required: ["keys"] });
    expect(kinds["grid"]).toEqual({ default: [1, 2] });
  });

  it("offers no shorthand for a one-field vector or colour section, which createApp cannot read", async () => {
    const single: Extension = {
      name: "@game/single",
      version: "1.0.0",
      register(ctx): void {
        ctx.registerSettings("wind", defineSchema({ wind: vec3() }), { wind: { x: 1, y: 0, z: 0 } });
      },
    };
    const properties = settingsJsonSchema(await build({}, [single]))["properties"] as Record<string, unknown>;
    expect(properties["wind"]).not.toHaveProperty("oneOf");
    expect(properties["wind"]).toMatchObject({ type: "object", additionalProperties: false });
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
