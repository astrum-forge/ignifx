import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { VitePluginErrorCode } from "../src/errors.js";
import {
  findIgnifxSettingsFile,
  IGNIFX_CONFIG_DEFINE_KEY,
  IGNIFX_SETTINGS_FILE_NAME,
  loadIgnifxConfig,
  loadIgnifxSettings,
  mergeProjectSettings,
  validateProjectSettings,
} from "../src/ignifx-config.js";
import { ignifx } from "../src/plugin.js";
import { createFixtureTree, disposeFixtures, PNG_BYTES, writeFixture } from "./support/fixtures.js";
import { asViteServer, FakeDevServer, harness } from "./support/plugin-harness.js";
import type { JsonSchemaObject } from "../src/json-schema.js";
import type { IgnifxPluginApi } from "../src/plugin.js";
import type { Plugin } from "vite";

/** `ignifx.settings.json`: the data form of the project settings, and its precedence rule. */

/**
 * A settings schema shaped like the one `@ignifx/core`'s `settingsJsonSchema(app)` writes for a
 * few core sections: the plugin may not import core (`.dependency-cruiser.cjs`,
 * `layering-vite-plugin`), so `tests/templates/settings-schema.test.ts` checks the real schema
 * against this validator instead.
 */
const coreSettingsSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    layers: {
      oneOf: [
        {
          type: "object",
          properties: { layers: { type: "array", items: { type: "string" } } },
          additionalProperties: false,
        },
        { type: "array", items: { type: "string" } },
      ],
    },
    sortingLayers: {
      oneOf: [
        {
          type: "object",
          properties: { sortingLayers: { type: "array", items: { type: "string" } } },
          additionalProperties: false,
        },
        { type: "array", items: { type: "string" } },
      ],
    },
    time: {
      type: "object",
      properties: {
        fixedDeltaTime: { type: "number", minimum: 2.220446049250313e-16 },
        maximumDeltaTime: { type: "number", minimum: 2.220446049250313e-16 },
        timeScale: { type: "number", minimum: 0, default: 1 },
      },
      additionalProperties: false,
    },
    rendering: {
      type: "object",
      properties: {
        clearColor: {
          type: "object",
          properties: {
            r: { type: "number", minimum: 0, maximum: 1 },
            g: { type: "number", minimum: 0, maximum: 1 },
            b: { type: "number", minimum: 0, maximum: 1 },
            a: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["r", "g", "b", "a"],
          "x-ignifx-group": "Clear",
        },
      },
      additionalProperties: false,
    },
  },
};

afterAll(disposeFixtures);

/**
 * Catches a rejection and returns the error.
 *
 * @param promise - The promise expected to reject.
 * @returns The error, or `null` when the promise resolved.
 */
async function failureOf(promise: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  return null;
}

/**
 * Runs the plugin's `config` and `configResolved` hooks against a project.
 *
 * @param plugin - The plugin.
 * @param root - The project root.
 * @param warnings - Where `configResolved` warnings are collected.
 * @returns The injected settings, parsed.
 */
async function injected(plugin: Plugin, root: string, warnings: string[] = []): Promise<unknown> {
  const hooks = harness(plugin);
  const result = await hooks.config({ root }, { command: "build", mode: "production" });
  hooks.configResolved({
    root,
    base: "/",
    command: "build",
    logger: {
      warn: (message: string): void => {
        warnings.push(message);
      },
    },
  });
  return JSON.parse(result?.define?.[IGNIFX_CONFIG_DEFINE_KEY] ?? "null");
}

describe("findIgnifxSettingsFile", () => {
  it("finds ignifx.settings.json at the root", async () => {
    const root = await createFixtureTree({ [IGNIFX_SETTINGS_FILE_NAME]: "{}" });
    expect(await findIgnifxSettingsFile(root)).toBe(join(root, "ignifx.settings.json"));
  });

  it("returns null when the project keeps no settings data", async () => {
    const root = await createFixtureTree({ "package.json": "{}" });
    expect(await findIgnifxSettingsFile(root)).toBeNull();
  });
});

describe("loadIgnifxSettings", () => {
  it("resolves to no settings when there is no file", async () => {
    expect(await loadIgnifxSettings(null)).toEqual({ path: null, settings: {} });
  });

  it("reads the sections of a JSON object", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ layers: ["Default", "Player"], time: { timeScale: 2 } }),
    });
    const file = join(root, IGNIFX_SETTINGS_FILE_NAME);
    expect(await loadIgnifxSettings(file)).toEqual({
      path: file,
      settings: { layers: ["Default", "Player"], time: { timeScale: 2 } },
    });
  });

  it("fails with IGX-0554, naming the file, when the JSON does not parse", async () => {
    const root = await createFixtureTree({ [IGNIFX_SETTINGS_FILE_NAME]: '{ "layers": [ }' });
    const error = await failureOf(loadIgnifxSettings(join(root, IGNIFX_SETTINGS_FILE_NAME)));
    expect(error?.code).toBe(VitePluginErrorCode.invalidProjectConfig);
    expect(error?.message).toContain("ignifx.settings.json");
    expect(error?.message).toContain("is not valid JSON");
  });

  it("fails with IGX-0554 when the file holds something other than an object", async () => {
    const root = await createFixtureTree({ [IGNIFX_SETTINGS_FILE_NAME]: '["Default"]' });
    const error = await failureOf(loadIgnifxSettings(join(root, IGNIFX_SETTINGS_FILE_NAME)));
    expect(error?.code).toBe(VitePluginErrorCode.invalidProjectConfig);
  });

  it("fails with IGX-0554 when an explicitly named file is missing", async () => {
    const root = await createFixtureTree({ "package.json": "{}" });
    const error = await failureOf(loadIgnifxSettings(join(root, "missing.json")));
    expect(error?.code).toBe(VitePluginErrorCode.invalidProjectConfig);
  });
});

describe("mergeProjectSettings", () => {
  it("takes a section both forms define whole from the config file", () => {
    const merged = mergeProjectSettings(
      { layers: ["Default", "Ground"], time: { timeScale: 2, fixedDeltaTime: 0.01 } },
      { time: { timeScale: 1 }, assets: { root: "data" } },
    );
    // `time.fixedDeltaTime` from the JSON is not merged into the config file's `time`.
    expect(merged.config).toEqual({
      layers: ["Default", "Ground"],
      time: { timeScale: 1 },
      assets: { root: "data" },
    });
    expect(merged.shadowed).toEqual(["time"]);
  });

  it("does not report a section both forms define identically", () => {
    const data = { layers: ["Default"], time: { timeScale: 1, fixedDeltaTime: 0.02 } };
    const merged = mergeProjectSettings(data, { time: { fixedDeltaTime: 0.02, timeScale: 1 }, layers: ["Default"] });
    expect(merged.shadowed).toEqual([]);
  });
});

describe("defineConfig over the JSON form", () => {
  it("lets ignifx.config.ts import ignifx.settings.json and extend it", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ layers: ["Default", "Player"] }),
      "ignifx.config.ts": [
        "import settings from './ignifx.settings.json';",
        "const defineConfig = <T,>(config: T): T => config;",
        "export default defineConfig({ ...settings, time: { fixedDeltaTime: 1 / 120 } });",
      ].join("\n"),
    });
    const resolved = await loadIgnifxConfig(join(root, "ignifx.config.ts"), root, {
      command: "build",
      mode: "production",
    });
    expect(resolved.config).toEqual({ layers: ["Default", "Player"], time: { fixedDeltaTime: 1 / 120 } });
  });
});

describe("validateProjectSettings against a settings schema", () => {
  it("accepts valid settings, including the one-field shorthand", () => {
    expect(() => {
      validateProjectSettings(
        { layers: ["Default", "Player"], sortingLayers: { sortingLayers: ["Back"] }, time: { timeScale: 2 } },
        coreSettingsSchema,
        [],
      );
    }).not.toThrow();
  });

  it("fails with IGX-0554 and the pointer of a misspelled key", () => {
    let error: { code?: string; message: string } | null = null;
    try {
      validateProjectSettings({ time: { fixedDeltaTim: 0.01 } }, coreSettingsSchema, ["/p/ignifx.settings.json"]);
    } catch (caught) {
      error = caught as { code?: string; message: string };
    }
    expect(error?.code).toBe(VitePluginErrorCode.invalidProjectConfig);
    expect(error?.message).toContain("/p/ignifx.settings.json");
    expect(error?.message).toContain('/time/fixedDeltaTim: property "fixedDeltaTim" is not allowed here');
  });

  it("returns a section the schema does not list instead of failing on it", () => {
    expect(validateProjectSettings({ weather: { wind: 1 }, layers: ["Default"] }, coreSettingsSchema, [])).toEqual([
      "weather",
    ]);
  });

  it("fails with IGX-0554 on a value out of range and on a channel missing from a colour", () => {
    expect(() => {
      validateProjectSettings({ rendering: { clearColor: { r: 0, g: 0, b: 0 } } }, coreSettingsSchema, []);
    }).toThrow(/\/rendering\/clearColor: missing required property "a"/u);
    expect(() => {
      validateProjectSettings({ time: { timeScale: -1 } }, coreSettingsSchema, []);
    }).toThrow(/\/time\/timeScale: expected a value >= 0/u);
  });
});

describe("the plugin's config hook with ignifx.settings.json", () => {
  it("injects the settings file when there is no config file", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ layers: ["Default", "Player"] }),
      "assets/a.png": PNG_BYTES,
    });
    expect(await injected(ignifx(), root)).toEqual({ layers: ["Default", "Player"] });
  });

  it("merges both forms with the config file winning a section, and warns about the override", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ layers: ["Default", "Player"], time: { timeScale: 2 } }),
      "ignifx.config.ts": "export default { time: { timeScale: 1 } };",
      "assets/a.png": PNG_BYTES,
    });
    const warnings: string[] = [];
    expect(await injected(ignifx(), root, warnings)).toEqual({ layers: ["Default", "Player"], time: { timeScale: 1 } });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("overrides the time section(s) of ignifx.settings.json");
  });

  it("reads no settings file with settingsFile: false", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ layers: ["Default", "Player"] }),
      "assets/a.png": PNG_BYTES,
    });
    expect(await injected(ignifx({ settingsFile: false }), root)).toEqual({});
  });

  it("reads an explicitly named settings file", async () => {
    const root = await createFixtureTree({
      "settings/game.json": JSON.stringify({ time: { timeScale: 3 } }),
      "assets/a.png": PNG_BYTES,
    });
    expect(await injected(ignifx({ settingsFile: "settings/game.json" }), root)).toEqual({ time: { timeScale: 3 } });
  });

  it("fails the build with IGX-0554 on a bad key when the settings schema is supplied", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ time: { fixedDeltaTim: 0.01 } }),
      "assets/a.png": PNG_BYTES,
    });
    const error = await failureOf(injected(ignifx({ schemas: { settings: coreSettingsSchema } }), root));
    expect(error?.code).toBe(VitePluginErrorCode.invalidProjectConfig);
    expect(error?.message).toContain("/time/fixedDeltaTim");
    // With validation off, the settings pass through and createApp reports them at runtime instead.
    const plugin = ignifx({ schemas: { settings: coreSettingsSchema }, validate: false });
    expect(await injected(plugin, root)).toEqual({ time: { fixedDeltaTim: 0.01 } });
  });

  it("warns about, rather than fails on, a section the settings schema does not list", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ weather: { wind: 1 }, time: { timeScale: 2 } }),
      "assets/a.png": PNG_BYTES,
    });
    const warnings: string[] = [];
    const settings = await injected(ignifx({ schemas: { settings: coreSettingsSchema } }), root, warnings);
    expect(settings).toEqual({ weather: { wind: 1 }, time: { timeScale: 2 } });
    expect(warnings).toEqual([expect.stringContaining("lists no weather section(s)")]);
  });
});

describe("the dev server and ignifx.settings.json", () => {
  it("restarts when the settings file is created or edited, so the new values are injected", async () => {
    const root = await createFixtureTree({ "assets/a.png": PNG_BYTES });
    const plugin: Plugin<IgnifxPluginApi> = ignifx();
    const hooks = harness(plugin);
    await hooks.config({ root }, { command: "serve", mode: "development" });
    hooks.configResolved({ root, base: "/", command: "serve" });
    const server = new FakeDevServer(root);
    await hooks.configureServer(asViteServer(server));

    server.emit("add", join(root, IGNIFX_SETTINGS_FILE_NAME));
    await plugin.api?.whenIdle();
    server.emit("change", join(root, IGNIFX_SETTINGS_FILE_NAME));
    await plugin.api?.whenIdle();
    expect(server.restarts).toBe(2);
    expect(server.sent).toEqual([]);
  });

  it("watches and restarts on a settings file outside the Vite root", async () => {
    const root = await createFixtureTree({
      "game/assets/a.png": PNG_BYTES,
      "shared/settings.json": JSON.stringify({ time: { timeScale: 2 } }),
    });
    const gameRoot = join(root, "game");
    const outside = join(root, "shared", "settings.json");
    const plugin: Plugin<IgnifxPluginApi> = ignifx({ settingsFile: "../shared/settings.json" });
    const hooks = harness(plugin);
    await hooks.config({ root: gameRoot }, { command: "serve", mode: "development" });
    hooks.configResolved({ root: gameRoot, base: "/", command: "serve" });
    const server = new FakeDevServer(gameRoot);
    await hooks.configureServer(asViteServer(server));

    expect(server.watched).toContain(outside);
    server.emit("change", outside);
    await plugin.api?.whenIdle();
    expect(server.restarts).toBe(1);
  });

  it("keeps the server and shows the error overlay when the edited settings do not load", async () => {
    const root = await createFixtureTree({
      [IGNIFX_SETTINGS_FILE_NAME]: JSON.stringify({ time: { timeScale: 1 } }),
      "assets/a.png": PNG_BYTES,
    });
    const plugin: Plugin<IgnifxPluginApi> = ignifx({ schemas: { settings: coreSettingsSchema } });
    const hooks = harness(plugin);
    await hooks.config({ root }, { command: "serve", mode: "development" });
    hooks.configResolved({ root, base: "/", command: "serve" });
    const server = new FakeDevServer(root);
    await hooks.configureServer(asViteServer(server));

    const file = await writeFixture(root, IGNIFX_SETTINGS_FILE_NAME, '{ "time": ');
    server.emit("change", file);
    await plugin.api?.whenIdle();
    await writeFixture(root, IGNIFX_SETTINGS_FILE_NAME, JSON.stringify({ time: { timeScal: 1 } }));
    server.emit("change", file);
    await plugin.api?.whenIdle();

    expect(server.restarts).toBe(0);
    const overlays = server.sent.map((payload) => JSON.stringify(payload));
    expect(overlays).toHaveLength(2);
    expect(overlays[0]).toContain("IGX-0554");
    expect(overlays[0]).toContain("is not valid JSON");
    expect(overlays[1]).toContain("/time/timeScal");
    expect(overlays[1]).toContain("keeps the previous settings");
  });
});
