// @ignifx shader

@group(2) @binding(0) var extra: texture_2d<f32>;
@group(2) @binding(1) var extraSampler: sampler;

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  return vec4<f32>(input.position, 1.0);
}

@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(extra, extraSampler, uv);
}
