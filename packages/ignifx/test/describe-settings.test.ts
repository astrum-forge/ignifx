import { describe, expect, it } from "vitest";
import {
  audio,
  createApp,
  createManualClock,
  createMemorySink,
  describeSettings,
  devtools,
  input,
  particles,
  physics,
  physics2d,
  settingsJsonSchema,
  threeD,
  twoD,
  ui,
} from "../src/index.js";
import type { Extension } from "../src/index.js";

/**
 * Every first-party extension's settings section, described through `ctx.registerSettings` alone:
 * what an editor's settings panel lists for a project that installs them all.
 *
 * @param extensions - The extensions to install.
 * @returns Each described section's declaring package, keyed by section name.
 */
async function packagesBySection(extensions: readonly Extension[]): Promise<Record<string, string | undefined>> {
  const app = await createApp({ headless: true, clock: createManualClock(), logSink: createMemorySink(), extensions });
  try {
    const sections = describeSettings(app);
    // Every section also has a JSON Schema property, so settings.json can be validated against it.
    expect(Object.keys(settingsJsonSchema(app)["properties"] as object)).toEqual(Object.keys(sections));
    return Object.fromEntries(Object.entries(sections).map(([name, section]) => [name, section.package]));
  } finally {
    app.dispose();
  }
}

describe("describeSettings across the first-party extensions", () => {
  it("names the package that registered each section", async () => {
    const described = await packagesBySection([
      audio(),
      input(),
      physics(),
      twoD(),
      threeD(),
      ui(),
      devtools(),
      particles(),
    ]);
    expect(described).toEqual({
      layers: "@ignifx/core",
      sortingLayers: "@ignifx/core",
      time: "@ignifx/core",
      assets: "@ignifx/core",
      rendering: "@ignifx/core",
      audio: "@ignifx/audio",
      input: "@ignifx/input",
      ui: "@ignifx/ui",
      devtools: "@ignifx/devtools",
      physics: "@ignifx/physics",
      twoD: "@ignifx/2d",
      threeD: "@ignifx/3d",
      particles: "@ignifx/particles",
    });
  });

  it("describes the 2D physics section", async () => {
    // The two physics packages register the same asset type, so they cannot share an app.
    const described = await packagesBySection([physics2d()]);
    expect(Object.entries(described).filter(([, owner]) => owner !== "@ignifx/core")).toEqual([
      [expect.any(String), "@ignifx/physics-2d"],
    ]);
  });
});
