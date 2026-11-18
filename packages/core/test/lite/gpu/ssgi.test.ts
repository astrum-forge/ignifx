import { describe, expect, it } from "vitest";
import {
  clampSsgiDenoisePasses,
  createSsgiEnvironmentPlugin,
  SSGI_ENVIRONMENT_PLUGIN_NAME,
  SSGI_MAX_DENOISE_PASSES,
  ssgiCompositeFragmentWgsl,
  ssgiDenoiseFragmentWgsl,
  writeSsgiFilterUniforms,
} from "../../../src/lite/gpu/ssgi.js";

/**
 * The parts of the SSGI pass that need no device: the pass count, the uniform block, the bindings
 * the two shaders declare (which the pass's effect layouts have to match), and the environment
 * plugin's code. What the pass draws is
 * `../../render/screen-space-effects.browser.test.ts`.
 */

describe("clampSsgiDenoisePasses", () => {
  it("keeps a whole count in range and rounds, clamps or zeroes the rest", () => {
    expect(clampSsgiDenoisePasses(0)).toBe(0);
    expect(clampSsgiDenoisePasses(3)).toBe(3);
    expect(clampSsgiDenoisePasses(2.6)).toBe(3);
    expect(clampSsgiDenoisePasses(-1)).toBe(0);
    expect(clampSsgiDenoisePasses(99)).toBe(SSGI_MAX_DENOISE_PASSES);
    expect(clampSsgiDenoisePasses(Number.NaN)).toBe(0);
  });
});

describe("writeSsgiFilterUniforms", () => {
  it("lays out the inverse view-projection, the eye and the parameters", () => {
    const inverse = Array.from({ length: 16 }, (_, index) => index + 1);
    const world = new Float32Array(16);
    world.set([7, 8, 9], 12);
    const out = new Float32Array(24).fill(-1);
    const written = writeSsgiFilterUniforms(
      { inverseViewProjection: inverse, cameraWorld: world, first: 4, isDisplayEncoded: false },
      out,
    );
    expect(written).toBe(out);
    expect(Array.from(out.subarray(0, 16))).toEqual(inverse);
    expect(Array.from(out.subarray(16, 20))).toEqual([7, 8, 9, 1]);
    expect(out[20]).toBe(4);
    expect(out[21]).toBeGreaterThan(0);
    expect(out[22]).toBeGreaterThan(0);
    expect(out[23]).toBe(0);
    writeSsgiFilterUniforms(
      { inverseViewProjection: inverse, cameraWorld: world, first: 0.5, isDisplayEncoded: true },
      out,
    );
    expect(out[20]).toBe(0.5);
    expect(out[23]).toBe(1);
  });
});

describe("the SSGI shaders", () => {
  it("declare the bindings the pass gives them and Lite's entry point", () => {
    const denoise = ssgiDenoiseFragmentWgsl();
    const composite = ssgiCompositeFragmentWgsl();
    for (const wgsl of [denoise, composite]) {
      expect(wgsl).toContain("@group(0)@binding(0)var<uniform>ssgi:SsgiFilter;");
      expect(wgsl).toContain("@group(0)@binding(1)var bounce:texture_2d<f32>;");
      expect(wgsl).toContain("@group(0)@binding(2)var sceneDepth:texture_depth_2d;");
      expect(wgsl).toContain("@group(0)@binding(3)var sceneNormals:texture_2d<f32>;");
      expect(wgsl).toContain("@fragment fn effectFragment(fragment:EffectVertexOutput)");
    }
    expect(denoise).not.toContain("sceneAlbedo");
    expect(composite).toContain("@group(0)@binding(4)var sceneAlbedo:texture_2d<f32>;");
  });
});

describe("createSsgiEnvironmentPlugin", () => {
  it("subtracts the share of the environment's irradiance that is turned down", () => {
    const plugin = createSsgiEnvironmentPlugin(0.25);
    expect(plugin.name).toBe(SSGI_ENVIRONMENT_PLUGIN_NAME);
    expect(plugin.getCustomCode?.("vertex")).toBeNull();
    const code = plugin.getCustomCode?.("fragment");
    expect(code?.["CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION"]).toContain("*0.7500;");
  });
});
