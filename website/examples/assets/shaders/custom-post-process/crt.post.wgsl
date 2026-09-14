// CRT: aperture-grille scan lines, a small chromatic split, and a barrel warp. Three cheap tricks
// that together read as a tube. The warp is why this effect samples an offset uv rather than the
// fragment's own — a post effect may read anywhere in the input texture it likes.
// @ignifx post
// @ignifx uniform scanline: f32 = 0.35 range(0, 1) step(0.05) tooltip("How dark the gaps between lines are.")
// @ignifx uniform lineHeight: f32 = 6 range(1, 16) step(1) tooltip("Screen pixels per scan line.")
// @ignifx uniform aberration: f32 = 0.0012 range(0, 0.01) step(0.0005) tooltip("How far the channels split.")
// @ignifx uniform curvature: f32 = 0.06 range(0, 0.3) step(0.01) tooltip("How far the glass bulges.")

fn mainFragment(in: PostInput) -> vec4<f32> {
  // Barrel warp: push the sample outward by the square of its distance from the centre.
  let centred = in.uv - vec2<f32>(0.5, 0.5);
  let warped = in.uv + centred * dot(centred, centred) * shaderUniforms.curvature * 4.0;
  // The frame's edge is masked rather than returned early: WGSL allows `textureSample` only in
  // uniform control flow, so a `return` before the samples is a shader compile error. Clamp, sample,
  // and multiply by the mask instead — the same picture for one extra multiply.
  let clamped = clamp(warped, vec2<f32>(0.0), vec2<f32>(1.0));
  let inside = select(0.0, 1.0, all(warped == clamped));
  // The channel split is along the radius, so it vanishes at the centre and is worst at the corners.
  let shift = centred * shaderUniforms.aberration;
  let red = textureSample(inputTexture, inputTextureSampler, clamp(clamped + shift, vec2<f32>(0.0), vec2<f32>(1.0))).r;
  let green = textureSample(inputTexture, inputTextureSampler, clamped).g;
  let blue = textureSample(inputTexture, inputTextureSampler, clamp(clamped - shift, vec2<f32>(0.0), vec2<f32>(1.0))).b;
  let line = 0.5 + 0.5 * sin(clamped.y * shaderUniforms.screenSize.y * 3.14159265 / max(shaderUniforms.lineHeight, 1.0));
  let mask = 1.0 - shaderUniforms.scanline * (1.0 - line);
  return vec4<f32>(vec3<f32>(red, green, blue) * mask * inside, 1.0);
}
