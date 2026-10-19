import { color, createApp, defineSchema, describeSettings, f64, settingsJsonSchema, str, vec3 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { isSettingsSet } from "../src/protocol/index.js";
import { settingsSet } from "../src/scene/settings.js";
import type { App, Extension } from "@ignifx/core";

/**
 * Engine ask E21: `describeSettings` hands the editor core's `describeSettings(app)`, each section's
 * JSON Schema, and the values the app resolved, in the settings form.
 */

/** A game extension with a vector, a colour and a value JSON cannot carry. */
const WEATHER: Extension = {
  name: "@game/weather",
  version: "1.0.0",
  register(ctx): void {
    ctx.registerSettings("weather", defineSchema({ wind: vec3(), sky: color(), gust: f64(1), label: str("calm") }), {
      wind: { x: 1, y: 0, z: -2 },
      sky: { r: 0.5, g: 0.6, b: 1, a: 1 },
      gust: 1,
      label: "calm",
    });
  },
};

let created: App | null = null;

afterEach(() => {
  created?.dispose();
  created = null;
});

describe("describeSettings", () => {
  it("describes every section with its JSON Schema, and copies the resolved values", async () => {
    const app = await createApp({
      headless: true,
      extensions: [WEATHER],
      settings: { weather: { wind: { x: 0, y: -9.81, z: 0 } }, time: { timeScale: 0.5 } },
    });
    created = app;
    const set = settingsSet(app);
    expect(isSettingsSet(set)).toBe(true);
    const described = describeSettings(app);
    const schema = settingsJsonSchema(app)["properties"] as Record<string, unknown>;
    expect(Object.keys(set.sections)).toEqual(Object.keys(described));
    for (const [name, section] of Object.entries(set.sections)) {
      expect(section).toEqual({ ...described[name], propsSchema: schema[name] });
    }
    expect(set.sections["weather"]).toMatchObject({ format: "settings", package: "@game/weather" });
    expect(set.values["weather"]).toEqual({
      wind: { x: 0, y: -9.81, z: 0 },
      sky: { r: 0.5, g: 0.6, b: 1, a: 1 },
      gust: 1,
      label: "calm",
    });
    expect(set.values["time"]).toMatchObject({ timeScale: 0.5 });
    // The answer is plain JSON: it survives the structured clone a port applies, unchanged.
    expect(JSON.parse(JSON.stringify(set))).toEqual(set);
  });

  it("leaves out a value JSON cannot carry", async () => {
    // Project settings refuse a non-finite number; an extension's registered default does not.
    const stormy: Extension = {
      ...WEATHER,
      register(ctx): void {
        ctx.registerSettings("weather", defineSchema({ gust: f64(1) }), { gust: Infinity });
      },
    };
    const app = await createApp({ headless: true, extensions: [stormy] });
    created = app;
    expect(app.settings.section<{ gust: number }>("weather").gust).toBe(Infinity);
    expect(settingsSet(app).values["weather"]).not.toHaveProperty("gust");
  });
});
