// @ignifx shader

struct Mine {
  tint: vec3<f32>,
}

@group(1) @binding(4) var<uniform> mine: Mine;

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  return vec4<f32>(input.position, 1.0);
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(mine.tint, 1.0);
}
