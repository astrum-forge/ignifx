// A full ShaderMaterial, copied from docs/plan/2026-09-terrain-particles-shaders.md §3.1.
// @ignifx shader
// @ignifx attributes position, normal, uv
// @ignifx system world, viewProjection, time
// @ignifx uniform progress: f32 = 0 range(0, 1)
// @ignifx uniform edgeColor: vec3<f32> = color(1.0, 0.45, 0.1)
// @ignifx uniform baseColor: vec3<f32> = color(0.2, 0.2, 0.25)
// @ignifx texture noiseTexture
// @ignifx blend opaque cull back

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(input.position, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let noise = textureSample(noiseTexture, noiseTextureSampler, input.uv * 4.0).r;
  if (noise < shaderUniforms.progress) { discard; }
  let edge = smoothstep(shaderUniforms.progress, shaderUniforms.progress + 0.08, noise);
  let tinted = mix(shaderUniforms.edgeColor, shaderUniforms.baseColor, edge);
  return vec4<f32>(tinted * (0.5 + 0.5 * sin(shaderUniforms.time)), 1.0);
}
