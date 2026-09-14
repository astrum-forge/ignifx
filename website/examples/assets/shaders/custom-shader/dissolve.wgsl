// Dissolve: discard where a noise field falls under `progress`, and burn the surviving edge.
// The field is three multiplied sine waves rather than a sampled texture, so the file needs no
// asset of its own — and a `discard` is the one thing a PBR material cannot be talked into doing.
// @ignifx shader
// @ignifx attributes position, normal
// @ignifx system world, worldViewProjection, mainLightDirection, mainLightColor, ambientColor
// @ignifx uniform baseColor: vec3<f32> = color(0.42, 0.55, 0.72)
// @ignifx uniform edgeColor: vec3<f32> = color(1.0, 0.48, 0.12)
// @ignifx uniform progress: f32 = 0.35 range(0, 1) step(0.01) tooltip("How much of the surface has burned away.")
// @ignifx uniform edgeWidth: f32 = 0.09 range(0.01, 0.3) step(0.01) tooltip("How wide the burning edge is.")
// @ignifx blend opaque cull back

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) localPosition: vec3<f32>,
}

fn field(p: vec3<f32>) -> f32 {
  let waves = sin(p.x * 7.3 + p.y * 3.1) * sin(p.y * 8.7 + p.z * 2.3) * sin(p.z * 6.1 + p.x * 4.7);
  return 0.5 + 0.5 * waves;
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.normal = normalize((shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz);
  out.localPosition = input.position;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let noise = field(input.localPosition);
  if (noise < shaderUniforms.progress) { discard; }
  let lambert = clamp(dot(normalize(input.normal), -normalize(shaderUniforms.mainLightDirection)), 0.0, 1.0);
  let lit = shaderUniforms.baseColor * (shaderUniforms.ambientColor + shaderUniforms.mainLightColor * lambert);
  // The band just above the cut glows: `edgeColor` is used as an emitter, so it survives the lambert.
  let heat = 1.0 - smoothstep(shaderUniforms.progress, shaderUniforms.progress + shaderUniforms.edgeWidth, noise);
  return vec4<f32>(mix(lit, shaderUniforms.edgeColor * 2.0, heat), 1.0);
}
