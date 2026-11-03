import { describe, expect, it } from "vitest";
import { AGX_CALL_WGSL, AGX_TONE_MAPPING_ID, AgxToneMapping } from "../../../src/lite/gpu/agx-tone-mapping.js";
import { readSceneImageProcessing, TONE_MAPPING_NAMES } from "../../../src/lite/gpu/environment.js";
import { HDR_CURVE, hdrCurveOf, hdrOutputFragmentWgsl } from "../../../src/lite/gpu/hdr-output.js";
import { imageProcessedColor } from "../../../src/render/image-processing-color.js";
import type { ImageProcessingState } from "../../../src/lite/gpu/environment.js";
import type { SceneContext } from "@babylonjs/lite";

/**
 * AgX (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G13), without a device: the Lite
 * curve object, its recognition on both paths, and the CPU copy the clear colour uses.
 * `agx-tone-mapping.browser.test.ts` compares the two paths on a device.
 */

describe("the AgX curve", () => {
  it("is a tone-mapping name and a Lite curve that applies the exposure first", () => {
    expect(TONE_MAPPING_NAMES).toContain("agx");
    expect(AgxToneMapping.id).toBe(AGX_TONE_MAPPING_ID);
    expect(AgxToneMapping.callWGSL.startsWith("color*=scene.vImageInfos.x;")).toBe(true);
    expect(AgxToneMapping.helpersWGSL).toContain("fn ignifxAgx(");
  });

  it("reads back as agx, so environment.ts repeats the right id", () => {
    const scene = {
      imageProcessing: { exposure: 1, contrast: 1, toneMappingEnabled: true, toneMapping: AgxToneMapping },
    } as unknown as SceneContext;
    const out: ImageProcessingState = { exposure: 0, contrast: 0, curve: "none" };
    expect(readSceneImageProcessing(scene, out).curve).toBe("agx");
  });

  it("is a curve of the HDR output pass, with the same WGSL", () => {
    expect(hdrCurveOf({ toneMappingEnabled: true, toneMapping: AgxToneMapping })).toBe(HDR_CURVE.agx);
    const wgsl = hdrOutputFragmentWgsl();
    expect(wgsl).toContain(AgxToneMapping.helpersWGSL);
    expect(wgsl).toContain(AGX_CALL_WGSL);
  });
});

/**
 * Presents a linear grey through AgX and the template's encode, as a fogged fragment would.
 *
 * @param linear - The linear grey.
 * @returns The presented grey, 0 to 1.
 */
function agxGrey(linear: number): number {
  const encoded = linear ** (1 / 2.2);
  const out = imageProcessedColor(
    encoded,
    encoded,
    encoded,
    1,
    { exposure: 1, contrast: 1, curve: "agx" },
    {
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    },
  );
  expect(out.g).toBeCloseTo(out.r, 3);
  expect(out.b).toBeCloseTo(out.r, 3);
  return out.r;
}

describe("the CPU copy", () => {
  it("puts 18% grey at about half the display range", () => {
    // The sigmoid's display value for 0.18 is 0.4967 (log2 0.18 sits at 10 / 16.5 of the EV range).
    expect(agxGrey(0.18)).toBeCloseTo(0.4967, 3);
  });

  it("rolls 1 off below white and keeps 16 just under it", () => {
    expect(agxGrey(1)).toBeCloseTo(0.7867, 3);
    expect(agxGrey(16)).toBeLessThan(1);
    expect(agxGrey(16)).toBeGreaterThan(0.99);
  });

  it("maps black to black", () => {
    expect(agxGrey(0)).toBe(0);
  });
});
