// @ignifx shader

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  return vec4<f32>(input.position, 1.0);
}
