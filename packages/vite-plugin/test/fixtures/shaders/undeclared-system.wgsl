// @ignifx shader
// @ignifx system world, viewProjection

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  return shaderSystem.viewProjection * shaderSystem.world * vec4<f32>(input.position, 1.0);
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  let pulse = 0.5 + 0.5 * sin(shaderUniforms.time);
  return vec4<f32>(shaderSystem.cameraPosition * pulse, 1.0);
}
