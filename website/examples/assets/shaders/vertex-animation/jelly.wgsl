// Jelly: a squash-and-stretch wobble driven entirely from the vertex stage, so one mesh and one
// material animate with no script, no skeleton and no per-frame CPU work at all.
// @ignifx shader
// @ignifx attributes position, normal
// @ignifx system world, viewProjection, mainLightDirection, mainLightColor, ambientColor, time
// @ignifx uniform jellyColor: vec3<f32> = color(0.36, 0.78, 0.55)
// @ignifx uniform wobble: f32 = 0.18 range(0, 0.5) step(0.01) tooltip("How far the cube deforms, as a fraction.")
// @ignifx uniform frequency: f32 = 3.4 range(0.5, 10) step(0.1) tooltip("Wobbles a second.")
// @ignifx uniform phase: f32 = 0 tooltip("Added to time, so a stopped clock still shows a pose.")
// @ignifx blend opaque cull back

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  let t = (shaderUniforms.time + shaderUniforms.phase) * shaderUniforms.frequency;
  // Squash on Y and stretch on XZ from the same term, so the volume stays roughly constant — which
  // is the difference between jelly and a cube that simply grows and shrinks.
  let squash = sin(t) * shaderUniforms.wobble;
  let scale = vec3<f32>(1.0 + squash * 0.5, 1.0 - squash, 1.0 + squash * 0.5);
  // A second, faster term along the diagonal makes the corners lag, which is what reads as soft.
  let lag = sin(t * 1.7 + input.position.x * 3.0 + input.position.z * 3.0) * shaderUniforms.wobble * 0.35;
  let local = input.position * scale + input.normal * lag;
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(local, 1.0);
  out.normal = normalize((shaderSystem.world * vec4<f32>(input.normal / scale, 0.0)).xyz);
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let lambert = clamp(dot(normal, -normalize(shaderUniforms.mainLightDirection)), 0.0, 1.0);
  let wrapped = lambert * 0.75 + 0.25;
  return vec4<f32>(shaderUniforms.jellyColor * (shaderUniforms.ambientColor + shaderUniforms.mainLightColor * wrapped), 1.0);
}
