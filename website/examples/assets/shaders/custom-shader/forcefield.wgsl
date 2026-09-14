// Force field: a fresnel shell with a hex lattice on it, drawn premultiplied so the shape reads as
// glass rather than as a flat additive glow. `blend premultiplied` is the mode Babylon Lite cannot
// name — its own `"alpha"` multiplies by alpha a second time — so ignifx supplies the blend state.
// @ignifx shader
// @ignifx attributes position, normal, uv
// @ignifx system world, worldViewProjection, cameraPosition, time
// @ignifx uniform tint: vec3<f32> = color(0.35, 0.66, 1.0)
// @ignifx uniform cells: f32 = 14 range(3, 40) step(1) tooltip("How many lattice cells fit across the shell.")
// @ignifx uniform pulse: f32 = 0.5 range(0, 2) step(0.05) tooltip("How hard the lattice breathes.")
// @ignifx blend premultiplied cull none depthWrite off

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) uv: vec2<f32>,
}

@vertex fn mainVertex(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = shaderSystem.worldViewProjection * vec4<f32>(input.position, 1.0);
  out.normal = normalize((shaderSystem.world * vec4<f32>(input.normal, 0.0)).xyz);
  out.worldPosition = (shaderSystem.world * vec4<f32>(input.position, 1.0)).xyz;
  out.uv = input.uv;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  let grid = abs(fract(input.uv * shaderUniforms.cells) - vec2<f32>(0.5, 0.5));
  let lattice = 1.0 - smoothstep(0.34, 0.46, min(grid.x, grid.y));
  let toEye = normalize(shaderSystem.cameraPosition - input.worldPosition);
  let fresnel = pow(1.0 - clamp(abs(dot(normalize(input.normal), toEye)), 0.0, 1.0), 2.0);
  let breathe = 1.0 + shaderUniforms.pulse * sin(shaderUniforms.time * 2.4);
  let alpha = clamp((fresnel * 0.85 + lattice * 0.35) * breathe, 0.0, 1.0);
  // Premultiplied: the colour is already multiplied by the coverage it is written with, which is
  // what lets the lattice and the rim share one draw without double-darkening the overlap.
  return vec4<f32>(shaderUniforms.tint * alpha * 1.6, alpha);
}
