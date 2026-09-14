// Hologram: horizontal scan lines that crawl with `time`, a fresnel edge, and additive blending so
// the floor shows through. `time` is ignifx's clock, not Babylon Lite's — Lite ships none — and it
// freezes under `app.pause()` and under the `?static=1` capture flag.
// @ignifx shader
// @ignifx attributes position, normal
// @ignifx system world, worldViewProjection, cameraPosition, time
// @ignifx uniform tint: vec3<f32> = color(0.29, 0.82, 1.0)
// @ignifx uniform scanFrequency: f32 = 90 range(10, 240) step(5) tooltip("Scan lines per metre of height.")
// @ignifx uniform scanSpeed: f32 = 0.6 range(0, 3) step(0.05) tooltip("How fast the lines crawl, metres a second.")
// @ignifx uniform glow: f32 = 1.4 range(0.2, 4) step(0.1) tooltip("Overall brightness of the projection.")
// @ignifx blend additive cull none depthWrite off

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.normal = normalize((shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz);
  out.worldPosition = (shaderSystem.world * vec4<f32>(input.position, 1.0)).xyz;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let scan = input.worldPosition.y * shaderUniforms.scanFrequency - shaderUniforms.time * shaderUniforms.scanSpeed * shaderUniforms.scanFrequency;
  let lines = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(scan), 4.0);
  let toEye = normalize(shaderSystem.cameraPosition - input.worldPosition);
  // A grazing fragment is where a real projection is brightest, so the fresnel term is added, not
  // multiplied: the silhouette burns and the front face stays readable.
  let fresnel = pow(1.0 - clamp(abs(dot(normalize(input.normal), toEye)), 0.0, 1.0), 2.5);
  let strength = (lines * 0.6 + fresnel * 1.2) * shaderUniforms.glow;
  // `blend additive` ignores the alpha channel, so the colour alone carries the brightness.
  return vec4<f32>(shaderUniforms.tint * strength, 1.0);
}
