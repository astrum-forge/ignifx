import { describeSettings, settingsJsonSchema } from "@ignifx/core";
import { validateJsonValue } from "@ignifx/vite-plugin";
import { afterEach, describe, expect, it } from "vitest";
import sidescrollerSettings from "../../templates/2d-sidescroller/ignifx.config.js";
import { extensions as sidescrollerExtensions } from "../../templates/2d-sidescroller/src/extensions.js";
import topdownSettings from "../../templates/2d-topdown/ignifx.config.js";
import { extensions as topdownExtensions } from "../../templates/2d-topdown/src/extensions.js";
import firstPersonSettings from "../../templates/3d-first-person/ignifx.config.js";
import { extensions as firstPersonExtensions } from "../../templates/3d-first-person/src/extensions.js";
import thirdPersonSettings from "../../templates/3d-third-person/ignifx.config.js";
import { extensions as thirdPersonExtensions } from "../../templates/3d-third-person/src/extensions.js";
import { createTemplateApp, templatePaths } from "./headless-app.js";
import type { App, Extension, SettingsInput } from "@ignifx/core";
import type { JsonObject, JsonValue } from "@ignifx/vite-plugin";

/**
 * Engine ask E6: the settings schema and descriptions are in the form `createApp` reads. Every
 * template's own `ignifx.config.ts` validates against the schema its app generates, and a settings
 * file written from the described defaults, as an editor's Settings panel would, starts an app.
 */

const TEMPLATES: readonly {
  readonly name: string;
  readonly settings: SettingsInput;
  readonly extensions: () => readonly Extension[];
}[] = [
  { name: "2d-sidescroller", settings: sidescrollerSettings, extensions: sidescrollerExtensions },
  { name: "2d-topdown", settings: topdownSettings, extensions: topdownExtensions },
  { name: "3d-first-person", settings: firstPersonSettings, extensions: firstPersonExtensions },
  { name: "3d-third-person", settings: thirdPersonSettings, extensions: thirdPersonExtensions },
];

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

/**
 * Builds a template's app headless with the given settings.
 *
 * @param name - The template directory name.
 * @param settings - The settings to start it with.
 * @param extensions - The template's `extensions()`.
 * @returns The app.
 */
async function build(name: string, settings: SettingsInput, extensions: () => readonly Extension[]): Promise<App> {
  const { app } = await createTemplateApp({
    assetDir: templatePaths(name).assetDir,
    settings,
    extensions: extensions(),
    scripts: [],
  });
  apps.push(app);
  return app;
}

/**
 * The settings as the Vite plugin injects them: a JSON round trip of the config's export.
 *
 * @param settings - The config's default export.
 * @returns The JSON value.
 */
function asJson(settings: SettingsInput): JsonValue {
  return JSON.parse(JSON.stringify(settings)) as JsonValue;
}

describe("core's settings schema under the Vite plugin's validator", () => {
  it("addresses a misspelled key, a missing colour channel and an unregistered section", async () => {
    const schema = settingsJsonSchema(await build("3d-third-person", {}, thirdPersonExtensions));
    const violations = validateJsonValue(
      {
        time: { fixedDeltaTim: 0.01 },
        rendering: { clearColor: { r: 0, g: 0, b: 0 } },
        layers: ["Default", "Player"],
        weather: { wind: 1 },
      },
      schema,
    );
    expect(violations.map((violation) => violation.pointer)).toEqual(["/time/fixedDeltaTim", "/rendering/clearColor"]);
  });
});

describe.each(TEMPLATES)("$name: settings in the form createApp reads", ({ name, settings, extensions }) => {
  it("validates its ignifx.config.ts against the schema its own app generates", async () => {
    const app = await build(name, settings, extensions);
    expect(validateJsonValue(asJson(settings), settingsJsonSchema(app))).toEqual([]);
  });

  it("starts from a settings file written from the described defaults", async () => {
    const described = describeSettings(await build(name, {}, extensions));
    const written: Record<string, JsonObject> = {};
    for (const [section, description] of Object.entries(described)) {
      const values: Record<string, JsonValue> = {};
      for (const [field, entry] of Object.entries(description.fields)) {
        if (entry.default !== undefined) {
          values[field] = entry.default;
        }
      }
      written[section] = values;
    }
    const reopened = await build(name, written, extensions);
    expect(validateJsonValue(written, settingsJsonSchema(reopened))).toEqual([]);
  });
});
