// Rim light: added to the frame **after** the host has finished lighting it, which is what the
// `composite` hook is for. Doing it in `surface` would tint the base colour and then get multiplied
// by the lambert term, so a rim in shadow would vanish — the opposite of what a rim light is for.
// `composite` needs a PBR host: Babylon Lite's Standard template has no slot for it.
// @ignifx surface
// @ignifx uniform rimColor: vec3<f32> = color(0.55, 0.78, 1.0)
// @ignifx uniform strength: f32 = 0.9 range(0, 3) step(0.05) tooltip("How bright the edge burns.")
// @ignifx uniform power: f32 = 3 range(1, 8) step(0.25) tooltip("How tightly the rim hugs the silhouette.")

fn composite(in: SurfaceInput, color: vec3<f32>) -> vec3<f32> {
  let facing = clamp(abs(dot(normalize(in.geometricNormal), normalize(in.viewDirection))), 0.0, 1.0);
  let rim = pow(1.0 - facing, surfaceUniforms.power);
  return color + surfaceUniforms.rimColor * rim * surfaceUniforms.strength;
}
