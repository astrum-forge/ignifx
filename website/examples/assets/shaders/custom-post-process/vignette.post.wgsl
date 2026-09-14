// Vignette: darken towards the corners. The cheapest useful post effect there is, and the one that
// shows the shape of the contract — `mainFragment` is a **plain function**, not an entry point.
// Babylon Lite's fullscreen path calls `effectFragment` by name, so ignifx generates that entry
// point and makes it forward here with a `PostInput` it filled in.
// @ignifx post
// @ignifx uniform amount: f32 = 0.55 range(0, 1.5) step(0.05) tooltip("How dark the corners go.")
// @ignifx uniform roundness: f32 = 1 range(0.2, 2) step(0.05) tooltip("1 is circular; below 1 is a letterbox.")

fn mainFragment(in: PostInput) -> vec4<f32> {
  let color = textureSample(inputTexture, inputTextureSampler, in.uv);
  // The aspect correction is why `screenSize` is here: without it the vignette is an ellipse that
  // changes shape with the window. `screenSize` is in **backing-store** pixels, like everything
  // else ignifx reports.
  let aspect = shaderUniforms.screenSize.x / max(shaderUniforms.screenSize.y, 1.0);
  var offset = in.uv - vec2<f32>(0.5, 0.5);
  offset.x = offset.x * mix(1.0, aspect, shaderUniforms.roundness * 0.5);
  let falloff = 1.0 - shaderUniforms.amount * smoothstep(0.18, 0.72, dot(offset, offset) * 2.0);
  return vec4<f32>(color.rgb * clamp(falloff, 0.0, 1.0), color.a);
}
