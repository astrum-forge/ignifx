// A full-screen PostEffect, from docs/plan/2026-09-terrain-particles-shaders.md §3.3.
// `mainFragment` is a plain function: ignifx generates the `@fragment fn effectFragment` entry
// point Lite calls by name and makes it forward here (packages/core/src/render/post-effect.ts).
// @ignifx post
// @ignifx uniform strength: f32 = 0.4 range(0, 1)

fn mainFragment(in: PostInput) -> vec4<f32> {
  let color = textureSample(inputTexture, inputTextureSampler, in.uv);
  let offset = in.uv - vec2<f32>(0.5, 0.5);
  let vignette = 1.0 - shaderUniforms.strength * dot(offset, offset) * 2.0;
  let wobble = 0.5 + 0.5 * sin(shaderUniforms.time + in.uv.x * shaderUniforms.screenSize.x);
  return vec4<f32>(color.rgb * vignette * wobble, color.a);
}
