// @ignifx shader
// @ignifx texture heightTexture

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  let height = textureSample(heightTexture, heightTextureSampler, input.uv).r;
  return vec4<f32>(input.position + vec3<f32>(0.0, height, 0.0), 1.0);
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}
