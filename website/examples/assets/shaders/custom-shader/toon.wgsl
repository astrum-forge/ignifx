// Cel shading: the light term quantised into bands, plus a dark outline from the view angle.
// `mainLightDirection` and `ambientColor` are ignifx's, not Babylon Lite's, so they are read from
// `shaderUniforms` beside this file's own values.
// @ignifx shader
// @ignifx attributes position, normal
// @ignifx system world, worldViewProjection, cameraPosition, mainLightDirection, mainLightColor, ambientColor
// @ignifx uniform baseColor: vec3<f32> = color(0.86, 0.31, 0.24)
// @ignifx uniform bands: f32 = 3 range(1, 8) step(1) tooltip("How many steps the light is quantised into.")
// @ignifx uniform outline: f32 = 0.28 range(0, 0.8) step(0.02) tooltip("How wide the silhouette rim is.")
// @ignifx blend opaque cull back

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
  let normal = normalize(input.normal);
  let toLight = -normalize(shaderUniforms.mainLightDirection);
  let steps = max(shaderUniforms.bands, 1.0);
  // `floor(x * n) / n` is the whole of cel shading: the smooth lambert ramp becomes n flat plateaus.
  let lambert = clamp(dot(normal, toLight), 0.0, 1.0);
  let stepped = floor(lambert * steps) / steps;
  let lit = shaderUniforms.baseColor * (shaderUniforms.ambientColor + shaderUniforms.mainLightColor * stepped);
  let toEye = normalize(shaderSystem.cameraPosition - input.worldPosition);
  // The silhouette, not a post-process edge filter: a fragment whose normal turns away from the eye
  // is on the rim of the shape, whatever is behind it.
  let rim = 1.0 - smoothstep(shaderUniforms.outline * 0.5, shaderUniforms.outline, abs(dot(normal, toEye)));
  return vec4<f32>(mix(lit, vec3<f32>(0.02, 0.02, 0.04), rim), 1.0);
}
