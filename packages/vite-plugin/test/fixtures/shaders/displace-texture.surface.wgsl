// @ignifx surface
// @ignifx texture windNoise

fn displace(in: VertexInput2) -> vec3<f32> {
  let wind = textureSampleLevel(windNoise, windNoiseSampler, in.uv, 0.0).r;
  return vec3<f32>(wind, 0.0, 0.0);
}
