// @ignifx shader
// @ignifx system world, viewProjection

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  let scaled = vec4<f32>(input.position, 1.0) * shaderSystem.time;
  return shaderSystem.viewProjection * scaled;
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}
