import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import {
  applyRenderingQuality,
  defaultRenderingSettings,
  RENDERING_QUALITIES,
  renderingQualityPreset,
  renderingSettingsSchema,
} from "../../src/render/rendering-settings.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { RenderingSettings } from "../../src/render/rendering-settings.js";

/**
 * `rendering.quality` (GI plan step G15): a named tier fills the effect switches the project did
 * not write itself, and `"custom"` changes nothing.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Resolves a declared section the way the settings store does (a shallow merge over the defaults),
 * then applies its tier.
 *
 * @param declared - The project's `rendering` value.
 * @returns The effective section.
 */
function effective(declared: Readonly<Record<string, unknown>>): RenderingSettings {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store's own shallow merge.
  const resolved = { ...defaultRenderingSettings(), ...declared } as RenderingSettings;
  return applyRenderingQuality(resolved, declared);
}

describe("rendering.quality", () => {
  it("is an enum field defaulting to custom, which changes nothing", () => {
    const field = renderingSettingsSchema()["quality"];
    expect(field?.kind).toBe("enum");
    expect(field?.createDefault()).toBe("custom");
    expect(RENDERING_QUALITIES).toEqual(["custom", "low", "medium", "high"]);
    const settings = defaultRenderingSettings();
    expect(applyRenderingQuality(settings, undefined)).toBe(settings);
    expect(renderingQualityPreset("custom")).toBeNull();
    expect(renderingQualityPreset("ultra")).toBeNull();
    // A declared value that is not a record reads as "nothing written".
    expect(applyRenderingQuality({ ...settings, quality: "low" }, ["hdr"]).ambientOcclusion.enabled).toBe(true);
  });

  it("switches HDR, TAA and GTAO per tier", () => {
    const low = effective({ quality: "low" });
    expect([low.hdr, low.taa.enabled, low.ambientOcclusion.enabled, low.ambientOcclusion.quality]).toEqual([
      false,
      false,
      true,
      "half",
    ]);
    const medium = effective({ quality: "medium" });
    expect([medium.hdr, medium.taa.enabled, medium.ambientOcclusion.quality]).toEqual([true, true, "half"]);
    const high = effective({ quality: "high" });
    expect([high.hdr, high.taa.enabled, high.ambientOcclusion.quality]).toEqual([true, true, "full"]);
    expect(renderingQualityPreset("medium")).toMatchObject({ contactShadows: true, ssgi: false });
    expect(renderingQualityPreset("high")).toMatchObject({ contactShadows: true, ssgi: true });
  });

  it("lets a field the project wrote win over its tier", () => {
    const high = effective({
      quality: "high",
      hdr: false,
      taa: { enabled: false, blend: 0.2 },
      ambientOcclusion: { quality: "half" },
    });
    expect(high.hdr).toBe(false);
    expect(high.taa).toMatchObject({ enabled: false, blend: 0.2, clamp: true });
    expect(high.ambientOcclusion).toMatchObject({ enabled: true, quality: "half", radius: 0.5 });
    // Tuning alone is not a switch: the tier still turns TAA on.
    expect(effective({ quality: "medium", taa: { blend: 0.3 } }).taa).toMatchObject({ enabled: true, blend: 0.3 });
  });

  it("reaches the renderer through the settings store", async () => {
    harness = await createRenderHarness({ settings: { rendering: { quality: "low" } } });
    expect(harness.renderer.settings.ambientOcclusion.enabled).toBe(true);
    expect(harness.renderer.qualityPreset).toMatchObject({ ssgi: false });
    // GTAO reaches PBR materials through a material plugin.
    expect(harness.renderer.features.materialPlugins).toBe(true);
  });

  it("caps a stack's contact shadows and SSGI headlessly without building them", async () => {
    for (const quality of ["custom", "low", "medium", "high"] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one app at a time, disposed before the next.
      const current = await createRenderHarness({ settings: { rendering: { quality } } });
      harness = current;
      const eye = current.world.createEntity("Eye");
      eye.addComponent(Camera);
      const stack = eye.addComponent(PostProcessStack);
      stack.contactShadows.enabled = true;
      stack.ssgi.enabled = true;
      current.frame();
      expect(current.errors).toEqual([]);
      current.dispose();
      harness = null;
    }
  });
});
