/**
 * The foliage shader: a full `ShaderMaterial` with vertex wind, Lambert lighting, and an alpha test
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.5).
 *
 * The plan wanted wind as a `displace` surface hook, which Babylon Lite 1.27.0 cannot do: plugin
 * uniforms are fragment-stage only, so the hook has no clock, and the composer runs the plugin's
 * vertex code before the thin-instance fragment that builds `finalWorld`, which discards the offset
 * on every instanced mesh. So foliage owns its whole vertex stage. The price is a shader material's:
 * no image-based lighting, no fog, and no shadow reception; it does cast, as a solid card.
 *
 * Two variants exist because `instancing matrices` adds `world0..world3` to `VertexInput`, and a
 * shader that reads them will not compile on a mesh without thin instances.
 */

/**
 * What {@link foliageShaderSource} bakes into the file.
 *
 * @public
 */
export interface FoliageShaderOptions {
  /**
   * Whether the material draws thin instances — an `InstancedMeshRenderer` — and so composes
   * `world0..world3`. Defaults to `true`. A material for a plain `MeshRenderer` needs `false`.
   */
  readonly instanced?: boolean;
}

/**
 * The name of the generated foliage shader; the material and the diagnostics carry it.
 *
 * @public
 */
export const FOLIAGE_SHADER_NAME = "foliage";

/**
 * Generates the foliage `.wgsl`.
 *
 * @remarks
 * The declared uniforms are what {@link foliageMaterialDefinition} sets and what
 * `material.value.setUniform` can change at runtime: `windStrength` (metres of lean at
 * `windHeight`), `windFrequency` (cycles per second), `windHeight` (metres), `tint` (sRGB), and
 * `cutoff` (the alpha below which a fragment is discarded). The one sampler is `albedo`.
 *
 * @param options - Whether the shader is instanced.
 * @returns The `.wgsl` source.
 *
 * @example
 * ```ts
 * const source = foliageShaderSource({ instanced: false });
 * ```
 *
 * @public
 */
export function foliageShaderSource(options: FoliageShaderOptions = {}): string {
  const instanced = options.instanced ?? true;
  const pipeline = instanced
    ? "// @ignifx blend opaque cull none instancing matrices"
    : "// @ignifx blend opaque cull none";
  const world = instanced
    ? "  let world = shaderSystem.world * mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);"
    : "  let world = shaderSystem.world;";
  return [
    "// @ignifx shader",
    "// @ignifx attributes position, normal, uv",
    "// @ignifx system world, viewProjection, time, mainLightDirection, mainLightColor, ambientColor",
    '// @ignifx uniform windStrength: f32 = 0.25 range(0, 2) step(0.01) tooltip("Metres of lean at windHeight")',
    '// @ignifx uniform windFrequency: f32 = 1.2 range(0, 10) step(0.1) tooltip("Sway cycles per second")',
    '// @ignifx uniform windHeight: f32 = 1 range(0.01, 10) step(0.1) tooltip("Height above the base where the lean reaches windStrength")',
    "// @ignifx uniform tint: vec3<f32> = color(1, 1, 1)",
    '// @ignifx uniform cutoff: f32 = 0.5 range(0, 1) step(0.01) tooltip("Alpha below which a fragment is discarded")',
    "// @ignifx texture albedo srgb default white",
    pipeline,
    "",
    "struct VertexOutput {",
    "  @builtin(position) position: vec4<f32>,",
    "  @location(0) uv: vec2<f32>,",
    "  @location(1) normal: vec3<f32>,",
    "}",
    "",
    "@vertex fn mainVertex(input: VertexInput) -> VertexOutput {",
    world,
    "  let base = world * vec4<f32>(0.0, 0.0, 0.0, 1.0);",
    "  var p = world * vec4<f32>(input.position, 1.0);",
    "  let h = clamp(input.position.y / shaderUniforms.windHeight, 0.0, 4.0);",
    "  let phase = base.x * 0.37 + base.z * 0.53;",
    "  let t = shaderUniforms.time * shaderUniforms.windFrequency * 6.2831853;",
    "  let sway = vec2<f32>(sin(t + phase), cos(t * 0.8 + phase * 1.3)) * shaderUniforms.windStrength * h * h;",
    "  p = vec4<f32>(p.x + sway.x, p.y - 0.25 * length(sway) * h, p.z + sway.y, 1.0);",
    "  var out: VertexOutput;",
    "  out.position = shaderSystem.viewProjection * p;",
    "  out.uv = input.uv;",
    "  out.normal = normalize((world * vec4<f32>(input.normal, 0.0)).xyz);",
    "  return out;",
    "}",
    "",
    "@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {",
    "  let sample = textureSample(albedo, albedoSampler, input.uv);",
    "  if (sample.a < shaderUniforms.cutoff) {",
    "    discard;",
    "  }",
    "  let n = normalize(input.normal);",
    "  let lambert = abs(dot(n, -shaderUniforms.mainLightDirection));",
    "  let light = shaderUniforms.mainLightColor * lambert + shaderUniforms.ambientColor;",
    "  return vec4<f32>(sample.rgb * shaderUniforms.tint * light, 1.0);",
    "}",
    "",
  ].join("\n");
}
