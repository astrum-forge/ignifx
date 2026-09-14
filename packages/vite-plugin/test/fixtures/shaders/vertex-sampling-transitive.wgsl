// @ignifx shader
// @ignifx texture heightTexture

fn sampleHeight(uv: vec2<f32>) -> f32 {
  return textureSample(heightTexture, heightTextureSampler, uv).r;
}

fn displacement(uv: vec2<f32>) -> f32 {
  return sampleHeight(uv) * 2.0;
}

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  let height = displacement(input.uv);
  return vec4<f32>(input.position + vec3<f32>(0.0, height, 0.0), 1.0);
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0);
}
