import { afterEach, describe, expect, it } from "vitest";
import { toLiteEngineOptions } from "../../src/lite/render-diagnostics.js";
import { NO_RENDERING_FEATURES } from "../../src/lite/render-features.js";
import { Color } from "../../src/math/color.js";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import {
  CANVAS_ALPHA_MODES,
  DEFAULT_BRDF_LUT_ADDRESS,
  defaultRenderingSettings,
  RENDERING_SETTINGS_SECTION,
  renderingSettingsSchema,
  toRenderingFeatures,
  toRendererOptions,
  toSurfaceFormat,
} from "../../src/render/rendering-settings.js";
import { validateProps } from "../../src/schema/validate.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { RenderingSettings } from "../../src/render/rendering-settings.js";

/**
 * The `rendering` settings section (`docs/architecture/04-extensions.md` §5,
 * `07-rendering.md` §1 and §1.1).
 *
 * The two rules worth pinning are the ones that differ from what §1 says: there is no
 * `powerPreference`, and `maxDevicePixelRatio` spells "do not clamp" as `0` because `Infinity` is
 * not a JSON number.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the section's defaults", () => {
  it("starts with every feature off and Lite's own swapchain defaults", () => {
    const defaults = defaultRenderingSettings();
    expect(defaults.features).toEqual(NO_RENDERING_FEATURES);
    expect(defaults.msaaSamples).toBe(4);
    expect(defaults.alphaMode).toBe("opaque");
    expect(defaults.srgb).toBe(false);
    expect(defaults.format).toBe("");
    expect(defaults.maxDevicePixelRatio).toBe(0);
    expect(defaults.requiredLimits).toEqual({});
    expect(defaults.brdfLut).toBe(DEFAULT_BRDF_LUT_ADDRESS);
  });

  it("hands out a fresh mutable object each time", () => {
    const first = defaultRenderingSettings();
    const second = defaultRenderingSettings();
    expect(first.features).not.toBe(second.features);
    expect(first.clearColor).not.toBe(second.clearColor);
  });

  it("validates against its own schema", () => {
    const schema = renderingSettingsSchema();
    const defaults = defaultRenderingSettings();
    expect(validateProps(schema, { ...defaults })).toEqual([]);
    expect(Object.keys(schema)).toContain("brdfLut");
    // §1 lists `powerPreference`; Lite 1.27.0 has no such option, so the section declares none.
    expect(Object.keys(schema)).not.toContain("powerPreference");
  });

  it("declares only the alpha modes WebGPU accepts", () => {
    expect([...CANVAS_ALPHA_MODES]).toEqual(["opaque", "premultiplied"]);
  });
});

describe("reading the section from a project", () => {
  it("is registered under the name 04-extensions.md §5 uses", async () => {
    harness = await createRenderHarness();
    const section = harness.app.settings.section<RenderingSettings>(RENDERING_SETTINGS_SECTION);
    expect(section.msaaSamples).toBe(4);
  });

  it("merges the project's values over the defaults", async () => {
    harness = await createRenderHarness({
      settings: { rendering: { msaaSamples: 1, srgb: true, brdfLut: "env/lut.png" } },
    });
    const section = harness.app.settings.section<RenderingSettings>(RENDERING_SETTINGS_SECTION);
    expect(section.msaaSamples).toBe(1);
    expect(section.srgb).toBe(true);
    expect(section.brdfLut).toBe("env/lut.png");
    expect(section.alphaMode).toBe("opaque");
  });

  it("reads a partial features block as 'only what it named is on'", async () => {
    harness = await createRenderHarness({ settings: { rendering: { features: { shadows: true } } } });
    expect(harness.renderer.features.shadows).toBe(true);
    expect(harness.renderer.features.skeletons).toBe(false);
    expect(harness.renderer.features.deviceLostRecovery).toBe(false);
    expect(harness.renderer.features.postProcessing).toBe(false);
  });

  it("declares postProcessing, off by default, and validates it as a boolean", async () => {
    expect(defaultRenderingSettings().features.postProcessing).toBe(false);
    const declared = renderingSettingsSchema()["features"];
    expect(declared?.kind).toBe("record");

    harness = await createRenderHarness({ settings: { rendering: { features: { postProcessing: true } } } });
    expect(harness.renderer.features.postProcessing).toBe(true);
    // It is a *start-time* decision, so it is refused after the scene is registered, like the rest.
    expect(() => {
      harness?.renderer.requireFeature("postProcessing");
    }).not.toThrow();
  });
});

describe("mapping onto Lite's engine options", () => {
  it("narrows the sample count to the two WebGPU allows", () => {
    expect(toRendererOptions({ ...defaultRenderingSettings(), msaaSamples: 1 }, 1).msaaSamples).toBe(1);
    expect(toRendererOptions({ ...defaultRenderingSettings(), msaaSamples: 4 }, 1).msaaSamples).toBe(4);
    expect(toRendererOptions({ ...defaultRenderingSettings(), msaaSamples: 2 }, 1).msaaSamples).toBe(4);
  });

  it("drops a clamp of zero rather than sizing the swapchain at nothing", () => {
    const unclamped = toRendererOptions(defaultRenderingSettings(), 1);
    expect(unclamped.pixelRatio).toBeUndefined();
    expect(toLiteEngineOptions(unclamped, 2).maxDevicePixelRatio).toBeUndefined();

    const clamped = toRendererOptions({ ...defaultRenderingSettings(), maxDevicePixelRatio: 2 }, 1);
    expect(clamped.pixelRatio).toBe(2);
    expect(toLiteEngineOptions(clamped, 3).maxDevicePixelRatio).toBe(2);
  });

  it("folds the live resolution scale into the clamp", () => {
    const scaled = toRendererOptions({ ...defaultRenderingSettings(), maxDevicePixelRatio: 2 }, 0.5);
    expect(scaled.resolutionScale).toBe(0.5);
    expect(toLiteEngineOptions(scaled, 3).maxDevicePixelRatio).toBe(1);
  });

  it("passes the extra device limits through only when the project named some", () => {
    expect(toRendererOptions(defaultRenderingSettings(), 1).requiredLimits).toBeUndefined();
    const limits = toRendererOptions(
      { ...defaultRenderingSettings(), requiredLimits: { maxColorAttachmentBytesPerSample: 64 } },
      1,
    );
    expect(limits.requiredLimits).toEqual({ maxColorAttachmentBytesPerSample: 64 });
  });

  it("keeps the swapchain format apart, because Lite declares it on the surface", () => {
    expect(toSurfaceFormat(defaultRenderingSettings())).toBeNull();
    expect(toSurfaceFormat({ ...defaultRenderingSettings(), format: "bgra8unorm" })).toBe("bgra8unorm");
  });

  it("carries the high-precision matrix pair straight through", () => {
    const options = toRendererOptions(
      { ...defaultRenderingSettings(), useHighPrecisionMatrix: true, useFloatingOrigin: true },
      1,
    );
    expect(options.useHighPrecisionMatrix).toBe(true);
    expect(options.useFloatingOrigin).toBe(true);
  });
});

describe("the feature record", () => {
  it("fills every adapter name, in the adapter's own shape", () => {
    const features = toRenderingFeatures(defaultRenderingSettings());
    expect(Object.keys(features).toSorted()).toEqual(Object.keys(NO_RENDERING_FEATURES).toSorted());
    expect(features).toEqual(NO_RENDERING_FEATURES);
  });

  it("reads anything that is not literally true as off", () => {
    const partial = { ...defaultRenderingSettings(), features: { shadows: true } as never };
    const features = toRenderingFeatures(partial);
    expect(features.shadows).toBe(true);
    expect(features.stencil).toBe(false);
  });
});

describe("the clear colour the section declares", () => {
  it("is on the render scene from the moment the scene exists", async () => {
    harness = await createRenderHarness({
      settings: { rendering: { clearColor: { r: 1, g: 0.5, b: 0, a: 1 } } },
    });
    // Written as the scene is created, before a frame has run — so a world with no camera and no
    // `Environment` still clears to what the project asked for, rather than to Lite's mid grey.
    const scene = harness.world.lite.scene;
    expect(scene.clearColor.r).toBeCloseTo(Color.srgbToLinear(1), 6);
    expect(scene.clearColor.g).toBeCloseTo(Color.srgbToLinear(0.5), 6);
    expect(scene.clearColor.b).toBeCloseTo(0, 6);
    expect(scene.clearColor.a).toBe(1);
  });

  it("defaults to opaque black rather than Lite's own grey", async () => {
    harness = await createRenderHarness();
    const scene = harness.world.lite.scene;
    expect(scene.clearColor.r).toBe(0);
    expect(scene.clearColor.g).toBe(0);
    expect(scene.clearColor.b).toBe(0);
    expect(scene.clearColor.a).toBe(1);
  });

  it("is overridden by the main camera, and only while that camera declares one", async () => {
    harness = await createRenderHarness({
      settings: { rendering: { clearColor: { r: 1, g: 0, b: 0, a: 1 } } },
    });
    const camera = harness.world.createEntity("Main Camera").addComponent(Camera, {
      clearColor: { r: 0, g: 0, b: 1, a: 1 },
    });
    harness.frame();
    const scene = harness.world.lite.scene;
    expect(scene.clearColor.b).toBeCloseTo(Color.srgbToLinear(1), 6);
    expect(scene.clearColor.r).toBeCloseTo(0, 6);

    // Clearing the override does not restore the setting: `null` means "leave the scene's clear
    // colour alone", and the setting was applied once, at creation (`07-rendering.md` §2.1).
    camera.clearColor = null;
    harness.frame();
    expect(scene.clearColor.b).toBeCloseTo(Color.srgbToLinear(1), 6);
  });

  it("is overridden by an Environment, which the main camera in turn overrides", async () => {
    harness = await createRenderHarness({
      settings: { rendering: { clearColor: { r: 1, g: 0, b: 0, a: 1 } } },
    });
    harness.world.createEntity("Env").addComponent(Environment, { clearColor: { r: 0, g: 1, b: 0, a: 1 } });
    harness.frame();
    const scene = harness.world.lite.scene;
    expect(scene.clearColor.g).toBeCloseTo(Color.srgbToLinear(1), 6);

    harness.world.createEntity("Main Camera").addComponent(Camera, { clearColor: { r: 0, g: 0, b: 1, a: 1 } });
    harness.frame();
    expect(scene.clearColor.b).toBeCloseTo(Color.srgbToLinear(1), 6);
    expect(scene.clearColor.g).toBeCloseTo(0, 6);
  });
});
