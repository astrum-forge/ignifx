// @ignifx shader
// @ignifx uniform progress: f32 = 0

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  return vec4<f32>(input.position, 1.0);
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(shaderUniforms.progres, 0.0, 0.0, 1.0);
}
