import { createRenderHarness } from "../../render/support/render-harness.js";
import type { AssetHandle } from "../../../src/assets/types.js";
import type { ShaderAsset } from "../../../src/render/shader-asset.js";
import type { SettingsInput } from "../../../src/settings/settings-input.js";
import type { RenderHarness } from "../../render/support/render-harness.js";

/**
 * The `.surface.wgsl` and `.post.wgsl` fixtures, and a harness that registers the `.wgsl` loader
 * with the `materialPlugins` rendering feature declared.
 *
 * Separate from `./harness.ts` and `./sources.ts` — which belong to the shader-material brief — so
 * the two suites do not fight over one file. Every source here is real WGSL that
 * `test/lite/render/surface-shader.browser.test.ts` and `post-effect.browser.test.ts` compile on a
 * device.
 */

/** A surface shader that pushes the base colour towards a declared colour, masked by a texture. */
export const SNOW_SURFACE_WGSL = `// @ignifx surface
// @ignifx uniform amount: f32 = 0.6 range(0, 1) tooltip("How much snow has settled")
// @ignifx uniform snowColor: vec3<f32> = color(0.95, 0.97, 1.0)
// @ignifx texture snowNoise default white

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  let mask = smoothstep(0.55, 0.85, (*s).normal.y) * textureSample(snowNoise, snowNoiseSampler, in.uv).r;
  (*s).baseColor = mix((*s).baseColor, surfaceUniforms.snowColor, mask * surfaceUniforms.amount);
}
`;

/** A surface shader that paints the whole surface one flat colour, for a pixel assertion. */
export const FLAT_RED_SURFACE_WGSL = `// @ignifx surface
// @ignifx uniform flatColor: vec3<f32> = color(1.0, 0.0, 0.0)

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  (*s).baseColor = surfaceUniforms.flatColor;
}
`;

/** A surface shader that perturbs the shading normal, to exercise the `UPDATE_DIFFUSE` slot. */
export const BENT_NORMAL_SURFACE_WGSL = `// @ignifx surface

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  (*s).normal = normalize(in.geometricNormal + vec3<f32>(0.0, 1.0, 0.0));
}
`;

/** A surface shader that lifts every vertex, with an early return so the inlining is exercised. */
export const LIFT_DISPLACE_WGSL = `// @ignifx surface

fn displace(in: DisplaceInput) -> vec3<f32> {
  if (in.position.y < -1000.0) {
    return vec3<f32>(0.0);
  }
  return vec3<f32>(0.0, 1.5, 0.0);
}
`;

/** A surface shader that inverts the lit colour. */
export const INVERT_COMPOSITE_WGSL = `// @ignifx surface

fn composite(in: SurfaceInput, color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(1.0) - color;
}
`;

/** A surface shader that adds emissive, which the compiler applies as a delta. */
export const GLOW_SURFACE_WGSL = `// @ignifx surface
// @ignifx uniform glow: vec3<f32> = color(0.0, 1.0, 0.0)

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  (*s).emissive = surfaceUniforms.glow;
}
`;

/** A `.surface.wgsl` with no hook at all. */
export const NO_HOOK_SURFACE_WGSL = `// @ignifx surface
// @ignifx uniform amount: f32 = 1

fn helper(x: f32) -> f32 {
  return x * 2.0;
}
`;

/** A `displace` hook that reads a uniform, which Babylon Lite cannot supply in the vertex stage. */
export const DISPLACE_WITH_UNIFORM_WGSL = `// @ignifx surface
// @ignifx uniform strength: f32 = 1

fn displace(in: DisplaceInput) -> vec3<f32> {
  return vec3<f32>(0.0, surfaceUniforms.strength, 0.0);
}
`;

/** A `displace` hook that reads a member `DisplaceInput` does not carry. */
export const DISPLACE_WITH_UV2_WGSL = `// @ignifx surface

fn displace(in: DisplaceInput) -> vec3<f32> {
  return vec3<f32>(in.uv2.x, 0.0, 0.0);
}
`;

/** A surface shader declaring ten samplers, which is one past the per-material budget. */
export const TEN_SAMPLER_SURFACE_WGSL = `// @ignifx surface
${Array.from({ length: 10 }, (_unused, index) => `// @ignifx texture map${String(index)}`).join("\n")}

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  (*s).baseColor = textureSample(map0, map0Sampler, in.uv).rgb;
}
`;

/** A post effect that multiplies the frame by a declared tint. */
export const TINT_POST_WGSL = `// @ignifx post
// @ignifx uniform tint: vec3<f32> = color(0.0, 1.0, 0.0)
// @ignifx uniform amount: f32 = 1 range(0, 1)

fn mainFragment(in: PostInput) -> vec4<f32> {
  let source = textureSample(inputTexture, inputTextureSampler, in.uv);
  return vec4<f32>(mix(source.rgb, source.rgb * shaderUniforms.tint, shaderUniforms.amount), source.a);
}
`;

/** A post effect that inverts the frame. */
export const INVERT_POST_WGSL = `// @ignifx post

fn mainFragment(in: PostInput) -> vec4<f32> {
  let source = textureSample(inputTexture, inputTextureSampler, in.uv);
  return vec4<f32>(vec3<f32>(1.0) - source.rgb, source.a);
}
`;

/** A post effect that reads the built-in `screenSize` and `time`, which are never declared. */
export const SCANLINE_POST_WGSL = `// @ignifx post

fn mainFragment(in: PostInput) -> vec4<f32> {
  let source = textureSample(inputTexture, inputTextureSampler, in.uv);
  let row = floor(in.uv.y * shaderUniforms.screenSize.y + shaderUniforms.time);
  let scan = select(1.0, 0.5, (row - 2.0 * floor(row * 0.5)) > 0.5);
  return vec4<f32>(source.rgb * scan, source.a);
}
`;

/** A `.post.wgsl` with no `mainFragment`. */
export const NO_ENTRY_POST_WGSL = `// @ignifx post

fn tint(color: vec3<f32>) -> vec3<f32> {
  return color;
}
`;

/** A headless render harness with the `.wgsl` loader registered. */
export interface SurfaceHarness extends RenderHarness {
  /** Loads a `.wgsl` from a string and returns its handle. */
  loadShader(address: string, source: string): Promise<AssetHandle<ShaderAsset>>;
}

/**
 * Builds the harness.
 *
 * @param settings - Project settings; `materialPlugins` is declared unless overridden.
 * @returns The harness. Always `dispose()` it.
 */
export async function createSurfaceHarness(settings?: SettingsInput): Promise<SurfaceHarness> {
  const base = await createRenderHarness({
    settings: settings ?? { rendering: { features: { materialPlugins: true } } },
  });
  return {
    ...base,
    loadShader: async (address: string, source: string): Promise<AssetHandle<ShaderAsset>> => {
      base.net.canned.set(base.app.assets.resolveUrl(address), source);
      const handle = base.app.assets.load<ShaderAsset>(address);
      // The shader loader awaits a dynamic `import()`, which no number of microtask flushes
      // advances, so the handle's promise is what has to be awaited.
      await handle.promise;
      return handle;
    },
  };
}
