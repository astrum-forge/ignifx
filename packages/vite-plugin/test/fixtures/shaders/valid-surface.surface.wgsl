// A SurfaceShader on Lite's PBR template, from docs/plan/2026-09-terrain-particles-shaders.md §3.2.
// @ignifx surface
// @ignifx uniform amount: f32 = 0.6 range(0, 1)
// @ignifx uniform snowColor: vec3<f32> = color(0.95, 0.97, 1.0)
// @ignifx uniform swayStrength: f32 = 0.1
// @ignifx texture snowNoise

fn displace(in: VertexInput2) -> vec3<f32> {
  return vec3<f32>(sin(in.position.y) * surfaceUniforms.swayStrength, 0.0, 0.0);
}

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  let noise = textureSample(snowNoise, snowNoiseSampler, in.uv * 8.0).r;
  let mask = smoothstep(0.55, 0.85, (*s).normal.y) * noise;
  (*s).baseColor = mix((*s).baseColor, surfaceUniforms.snowColor, mask * surfaceUniforms.amount);
}

fn composite(in: SurfaceInput, color: vec3<f32>) -> vec3<f32> {
  return color;
}
