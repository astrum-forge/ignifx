import { AcesToneMapping, NeutralToneMapping, StandardToneMapping } from "@babylonjs/lite";
import { describe, expect, it } from "vitest";
import {
  createLinearOutputPlugin,
  createStandardLinearPlugin,
  createUnlitLinearPlugin,
  HDR_CURVE,
  hdrCurveOf,
  hdrOutputFragmentWgsl,
  LINEAR_OUTPUT_PLUGIN_NAME,
  linearFogConfig,
  linearSkyboxFragment,
  STANDARD_LINEAR_PLUGIN_NAME,
  UNLIT_LINEAR_PLUGIN_NAME,
  writeHdrOutputUniforms,
} from "../../../src/lite/gpu/hdr-output.js";
import { linearOutputFragment } from "../../../src/lite/gpu/shader-material.js";
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
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toMatch(/^color = ignifxLinearColor;/u);
    expect(code.CUSTOM_FRAGMENT_DEFINITIONS).toContain("var<private> ignifxLinearColor");
  });

  it("re-applies the PBR fog after the restore, with the fog colour already linear", () => {
    const code = createLinearOutputPlugin().getCustomCode?.("fragment") ?? {};
    // Its own copy of Lite's fog factor: `calcFogFactor` exists only in a fogged scene's shader.
    expect(code.CUSTOM_FRAGMENT_DEFINITIONS).toContain("fn ignifxFogFactor(");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("if(scene.vFogInfos.x>0.0)");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("mix(scene.vFogColor.rgb,color,");
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).not.toContain("pow(scene.vFogColor");
  });

  it("decodes a Standard material's colour last, after any surface shader", () => {
    const plugin = createStandardLinearPlugin();
    expect(plugin.name).toBe(STANDARD_LINEAR_PLUGIN_NAME);
    expect(plugin.priority).toBe(1000);
    expect(plugin.getCustomCode?.("fragment")?.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toContain("vec3<f32>(2.2)");
  });

  it("recomputes an unlit PBR colour rather than trusting the save", () => {
    const plugin = createUnlitLinearPlugin();
    expect(plugin.name).toBe(UNLIT_LINEAR_PLUGIN_NAME);
    const code = plugin.getCustomCode?.("fragment") ?? {};
    expect(code.CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION).toBeUndefined();
    expect(code.CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR).toMatch(/^color = baseColor\*material\.unlitColor;/u);
  });
});

describe("the other colour writers", () => {
  it("stores the fog colour decoded, in a fresh object", () => {
    const fog = { mode: 3 as const, density: 0.1, start: 1, end: 5, color: [0.5, 1, 0] as [number, number, number] };
    const linear = linearFogConfig(fog);
    expect(linear).not.toBe(fog);
    expect(linear.color[0]).toBeCloseTo(0.5 ** 2.2, 6);
    expect(linear.color.slice(1)).toEqual([1, 0]);
    expect([linear.mode, linear.density, linear.start, linear.end]).toEqual([3, 0.1, 1, 5]);
  });

  it("makes Lite's .env skybox return its cube map's colour before exposure and encode", () => {
    const hdr =
      "@fragment fn main(d:h)->@location(0) vec4<f32>{var e=normalize(d.positionUVW);var a=textureSampleLevel(b,c,e,0.0).rgb;a*=mesh.exposureLinear;a=pow(a,vec3<f32>(1.0/2.2));return vec4<f32>(a,1.0);}";
    expect(linearSkyboxFragment(hdr)).toContain(
      "var a=textureSampleLevel(b,c,e,0.0).rgb;return vec4<f32>(a,1.0);a*=mesh.exposureLinear;",
    );
    // A shader with nothing to patch is left alone.
    const solid = "@fragment fn main()->@location(0) vec4<f32>{return vec4<f32>(1.0);}";
    expect(linearSkyboxFragment(solid)).toBe(solid);
  });

  it("wraps a custom shader's mainFragment to decode its display colour", () => {
    const source = [
      "struct VertexOutput { @builtin(position) position: vec4<f32>, }",
      "@fragment fn mainFragment(input: VertexOutput, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {",
      "  return vec4<f32>(0.5);",
      "}",
    ].join("\n");
    const wrapped = linearOutputFragment(source, false);
    expect(wrapped).toContain("fn ignifxDisplayFragment(input: VertexOutput, front: bool)->vec4<f32>{");
    expect(wrapped).toContain(
      "@fragment fn mainFragment(input: VertexOutput, @builtin(front_facing) front: bool)->@location(0) vec4<f32>{",
    );
    expect(wrapped).toContain("let c=ignifxDisplayFragment(input,front);");
    expect(wrapped).toContain("pow(max(c.rgb,vec3<f32>(0.0)),vec3<f32>(2.2))");
    expect(wrapped.match(/@fragment/gu)).toHaveLength(1);
    expect(linearOutputFragment(source, true)).toContain("c.rgb/c.a");
  });

  it("leaves a shader it cannot wrap unchanged", () => {
    const structOut = "@fragment fn mainFragment(input: V) -> Out { var o: Out; return o; }";
    expect(linearOutputFragment(structOut, false)).toBe(structOut);
    const noFragment = "@vertex fn mainVertex() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }";
    expect(linearOutputFragment(noFragment, false)).toBe(noFragment);
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
