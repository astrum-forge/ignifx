import { AcesToneMapping, NeutralToneMapping, StandardToneMapping } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import {
  createLinearOutputPlugin,
  HDR_CURVE,
  hdrCurveOf,
  hdrOutputFragmentWgsl,
  LINEAR_OUTPUT_PLUGIN_NAME,
  writeHdrOutputUniforms,
} from "../../../src/lite/gpu/hdr-output.js";
import { imageProcessedColor, linearClearColor } from "../../../src/render/image-processing-color.js";

/**
 * The device-free half of `rendering.hdr` (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step
 * G2): the plugin's code, the output pass's curve selection and uniforms, and the clear colour.
 * `hdr-output.browser.test.ts` checks the frame on a device.
 */

describe("the linear-output plugin", () => {
  it("saves the colour before composition and restores it before the fragment is written", () => {
    const plugin = createLinearOutputPlugin();
    expect(plugin.name).toBe(LINEAR_OUTPUT_PLUGIN_NAME);
    expect(plugin.priority).toBe(0);
    expect(plugin.getCustomCode?.("vertex")).toBeNull();
    const code = plugin.getCustomCode?.("fragment") ?? {};
    // Injected twice by Lite, so it must be an assignment rather than a declaration.
    expect(code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBe("ignifxLinearColor = color;");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toBe("color = ignifxLinearColor;");
    expect(code.CUSTOM_FRAGMENT_DEFINITIONS).toContain("var<private> ignifxLinearColor");
  });
});

describe("the output pass", () => {
  it("picks the curve the scene's image processing names", () => {
    expect(hdrCurveOf({ toneMappingEnabled: false, toneMapping: AcesToneMapping })).toBe(HDR_CURVE.none);
    expect(hdrCurveOf({ toneMappingEnabled: true })).toBe(HDR_CURVE.standard);
    expect(hdrCurveOf({ toneMappingEnabled: true, toneMapping: StandardToneMapping })).toBe(HDR_CURVE.standard);
    expect(hdrCurveOf({ toneMappingEnabled: true, toneMapping: AcesToneMapping })).toBe(HDR_CURVE.aces);
    expect(hdrCurveOf({ toneMappingEnabled: true, toneMapping: NeutralToneMapping })).toBe(HDR_CURVE.neutral);
    const custom = { id: "custom", helpersWGSL: "", callWGSL: "" };
    expect(hdrCurveOf({ toneMappingEnabled: true, toneMapping: custom })).toBe(HDR_CURVE.standard);
  });

  it("reports a uniform change only when exposure, contrast or the curve moved", () => {
    const out = new Float32Array(4);
    out[0] = Number.NaN;
    const processing = { exposure: 0.8, contrast: 1.2, toneMappingEnabled: true, toneMapping: AcesToneMapping };
    expect(writeHdrOutputUniforms(processing, out)).toBe(true);
    expect([...out]).toEqual([Math.fround(0.8), Math.fround(1.2), HDR_CURVE.aces, 0]);
    expect(writeHdrOutputUniforms({ ...processing, exposure: Math.fround(0.8), contrast: Math.fround(1.2) }, out)).toBe(
      false,
    );
    expect(writeHdrOutputUniforms({ ...processing, toneMappingEnabled: false }, out)).toBe(true);
    expect(out[2]).toBe(HDR_CURVE.none);
  });

  it("carries Lite's three curves and the PBR template's encode and contrast", () => {
    const wgsl = hdrOutputFragmentWgsl();
    expect(wgsl).toContain("fn effectFragment(");
    expect(wgsl).toContain(StandardToneMapping.callWGSL);
    expect(wgsl).toContain(AcesToneMapping.callWGSL);
    expect(wgsl).toContain(NeutralToneMapping.callWGSL);
    expect(wgsl).toContain("pow(color,vec3<f32>(1.0/2.2))");
    expect(wgsl).toContain("var<uniform>scene:");
  });
});

describe("the clear colour under HDR", () => {
  it("is stored decoded, so the output pass turns it into what the plain path presents", () => {
    const linear = linearClearColor(0.5, 0.25, 1, 0.75, { r: 0, g: 0, b: 0, a: 0 });
    expect(linear.r).toBeCloseTo(0.5 ** 2.2, 6);
    expect(linear.g).toBeCloseTo(0.25 ** 2.2, 6);
    expect(linear.b).toBe(1);
    expect(linear.a).toBe(0.75);
    // With identity image processing the output pass only re-encodes, which lands on the authored colour.
    const presented = imageProcessedColor(
      0.5,
      0.25,
      1,
      0.75,
      { exposure: 1, contrast: 1, curve: "none" },
      {
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      },
    );
    expect(linear.r ** (1 / 2.2)).toBeCloseTo(presented.r, 6);
  });
});
