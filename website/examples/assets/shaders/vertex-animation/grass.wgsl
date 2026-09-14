// Wind-blown grass: cross quads bent from the vertex stage and alpha-tested in the fragment stage,
// which is how a foliage card is drawn everywhere. `mainLightDirection` and `ambientColor` are
// ignifx's own uniforms, so a full `"shader"` material can still be lit by the scene's key light.
// @ignifx shader
// @ignifx attributes position, normal, uv
// @ignifx system world, viewProjection, mainLightDirection, mainLightColor, ambientColor, time
// @ignifx uniform tipColor: vec3<f32> = color(0.62, 0.82, 0.32)
// @ignifx uniform rootColor: vec3<f32> = color(0.14, 0.28, 0.11)
// @ignifx uniform wind: f32 = 0.28 range(0, 1) step(0.01) tooltip("How far the tips lean, in metres.")
// @ignifx uniform frequency: f32 = 1.6 range(0.2, 6) step(0.1) tooltip("Gusts a second.")
// @ignifx uniform phase: f32 = 0 tooltip("Added to time, so a stopped clock still shows a pose.")
// @ignifx blend opaque cull none

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  let world = shaderSystem.world * vec4<f32>(input.position, 1.0);
  let t = (shaderUniforms.time + shaderUniforms.phase) * shaderUniforms.frequency;
  // `uv.y` is 0 at the root and 1 at the tip; squaring it is what makes the blade bend rather than
  // shear — the root stays planted and the curve tightens towards the top.
  let bend = input.uv.y * input.uv.y * shaderUniforms.wind;
  let gust = sin(t + world.x * 2.4 + world.z * 1.7) * 0.7 + sin(t * 2.3 + world.z * 3.1) * 0.3;
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * (world + vec4<f32>(gust * bend, 0.0, gust * bend * 0.4, 0.0));
  out.normal = normalize((shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz);
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  // The alpha test: the blade is a tapering wedge cut out of a rectangular quad, and everything
  // outside it is discarded rather than blended, so no sorting is needed.
  let halfWidth = 0.5 * (1.0 - input.uv.y * 0.85);
  if (abs(input.uv.x - 0.5) > halfWidth) { discard; }
  let lambert = clamp(abs(dot(normalize(input.normal), -normalize(shaderUniforms.mainLightDirection))), 0.0, 1.0);
  let blade = mix(shaderUniforms.rootColor, shaderUniforms.tipColor, input.uv.y);
  return vec4<f32>(blade * (shaderUniforms.ambientColor + shaderUniforms.mainLightColor * (lambert * 0.6 + 0.4)), 1.0);
}
