// Hit flash: the damage response every action game ships. A game writes `flash` from a script — a
// tween down from 1 over about a fifth of a second — and the whole model whitens and fades back.
// It is a `composite` hook because a flash has to survive shadow: a fragment the key light never
// reaches still flashes, which is exactly what a player needs to read a hit.
// @ignifx surface
// @ignifx uniform flash: f32 = 0 range(0, 1) step(0.01) tooltip("1 at the moment of the hit, 0 at rest.")
// @ignifx uniform flashColor: vec3<f32> = color(1.0, 0.86, 0.72)

fn composite(in: SurfaceInput, color: vec3<f32>) -> vec3<f32> {
  let amount = clamp(surfaceUniforms.flash, 0.0, 1.0);
  // A grazing fragment flashes hardest, so the silhouette pops first — the shape of the hit reads
  // even at a frame or two of screen time.
  let facing = clamp(abs(dot(normalize(in.geometricNormal), normalize(in.viewDirection))), 0.0, 1.0);
  let edge = 1.0 + 1.6 * (1.0 - facing);
  return mix(color, surfaceUniforms.flashColor * edge, amount);
}
