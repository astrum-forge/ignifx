/**
 * The `.wgsl` fixtures the shader suites load through the fake network, as strings rather than
 * files: the asset service reaches every source through one injectable `fetch`
 * (`docs/architecture/05-assets-and-loading.md` §8), so a fixture is text and needs no file I/O.
 *
 * Every source here is real WGSL that Babylon Lite's prelude completes into a compilable module —
 * `test/lite/render/shader-material.browser.test.ts` draws with them on a device.
 */

/** A flat unlit quad shader with one colour uniform and the ignifx clock. */
export const TINT_WGSL = `// @ignifx shader
// @ignifx attributes position, uv
// @ignifx system worldViewProjection, time
// @ignifx uniform tint: vec3<f32> = color(1.0, 0.0, 0.0)
// @ignifx uniform pulse: f32 = 0 range(0, 1) step(0.01) tooltip("How strongly time modulates the tint")

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let wave = shaderUniforms.pulse * (0.5 + 0.5 * sin(shaderUniforms.time * 6.2831853));
  return vec4<f32>(shaderUniforms.tint * (1.0 - wave), 1.0);
}
`;

/** The same shader with a different default tint, for the hot-reload swap. */
export const TINT_RELOADED_WGSL = TINT_WGSL.replace(
  "// @ignifx uniform tint: vec3<f32> = color(1.0, 0.0, 0.0)",
  "// @ignifx uniform tint: vec3<f32> = color(0.0, 1.0, 0.0)",
);

/** A shader that samples one declared texture and falls back to a 1x1 black texel. */
export const TEXTURED_WGSL = `// @ignifx shader
// @ignifx attributes position, uv
// @ignifx system worldViewProjection
// @ignifx texture albedo srgb default black
// @ignifx define TINTED = false

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  var color = textureSample(albedo, albedoSampler, input.uv).rgb;
  if (TINTED) {
    color = vec3<f32>(0.0, 0.0, 1.0);
  }
  return vec4<f32>(color, 1.0);
}
`;

/** A shader that reads a per-vertex offset out of a storage buffer. */
export const STORAGE_WGSL = `// @ignifx shader
// @ignifx attributes position
// @ignifx system worldViewProjection
// @ignifx storage offsets: array<vec4<f32>>

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  let offset = offsets[0].xyz;
  return shaderSystem.worldViewProjection * vec4<f32>(input.position + offset, 1.0);
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 1.0, 1.0, 1.0);
}
`;

/** A shader that shades from the ignifx main-light uniforms. */
export const LIT_WGSL = `// @ignifx shader
// @ignifx attributes position, normal
// @ignifx system world, worldViewProjection, mainLightDirection, mainLightColor, ambientColor

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.normal = (shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let lambert = max(dot(normalize(input.normal), -shaderUniforms.mainLightDirection), 0.0);
  return vec4<f32>(shaderUniforms.mainLightColor * lambert + shaderUniforms.ambientColor, 1.0);
}
`;

/** A `.material.json` body for {@link TINT_WGSL}. */
export const TINT_MATERIAL_JSON = JSON.stringify({
  format: "ignifx.material",
  formatVersion: 1,
  type: "shader",
  name: "tint",
  shader: "shaders/tint.wgsl",
  values: { tint: [0, 0, 1], pulse: 0.5 },
});
