// A flag: a subdivided plane whose vertex stage bends it into a travelling wave, pinned at u = 0.
// A full `"shader"` material owns its vertex stage outright, which is what makes this possible at
// all — a surface shader's `displace` hook cannot read the clock (see `bulge.surface.wgsl`).
// @ignifx shader
// @ignifx attributes position, normal, uv
// @ignifx system world, viewProjection, worldViewProjection, mainLightDirection, mainLightColor, ambientColor, time
// @ignifx uniform flagColor: vec3<f32> = color(0.85, 0.24, 0.28)
// @ignifx uniform wind: f32 = 0.22 range(0, 0.6) step(0.01) tooltip("How far the cloth swings, in metres.")
// @ignifx uniform frequency: f32 = 5 range(0.5, 12) step(0.25) tooltip("Waves along the flag.")
// @ignifx uniform phase: f32 = 0 tooltip("Added to time, so a stopped clock still shows a pose.")
// @ignifx blend opaque cull none

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  let t = shaderUniforms.time + shaderUniforms.phase;
  // `uv.x` is the distance from the pole, so multiplying by it pins the hoist and frees the fly.
  let reach = input.uv.x;
  let wave = sin(input.uv.x * shaderUniforms.frequency - t * 3.2) * shaderUniforms.wind * reach;
  let lift = cos(input.uv.y * 2.2 + t * 2.6) * shaderUniforms.wind * 0.35 * reach;
  let local = input.position + vec3<f32>(0.0, lift, wave);
  // The normal is bent by the wave's own slope, or the cloth would light as if it were flat.
  let slope = cos(input.uv.x * shaderUniforms.frequency - t * 3.2) * shaderUniforms.frequency * shaderUniforms.wind * reach;
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(local, 1.0);
  out.normal = normalize((shaderSystem.world * vec4<f32>(normalize(vec3<f32>(-slope, 0.3, 1.0)), 0.0)).xyz);
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let lambert = clamp(abs(dot(normalize(input.normal), -normalize(shaderUniforms.mainLightDirection))), 0.0, 1.0);
  let band = select(1.0, 0.82, fract(input.uv.y * 3.0) < 0.5);
  return vec4<f32>(shaderUniforms.flagColor * band * (shaderUniforms.ambientColor + shaderUniforms.mainLightColor * lambert), 1.0);
}
