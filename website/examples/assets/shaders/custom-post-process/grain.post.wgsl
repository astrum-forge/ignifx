// Film grain. The `seed` uniform is what makes it reproducible: the example writes the kit's
// seeded generator into it once, so `?seed=1` always produces the same speckle and a golden of the
// frame cannot rot. Animate it from `time` instead and the grain crawls, which is what a game wants
// and what a screenshot test cannot have.
// @ignifx post
// @ignifx uniform amount: f32 = 0.08 range(0, 0.4) step(0.005) tooltip("How strong the speckle is.")
// @ignifx uniform seed: f32 = 0 tooltip("Fixed by the example from its seeded generator.")
// @ignifx uniform shadowBias: f32 = 0.6 range(0, 1) step(0.05) tooltip("How much more the dark end grains.")

fn mainFragment(in: PostInput) -> vec4<f32> {
  let color = textureSample(inputTexture, inputTextureSampler, in.uv);
  // Hash the **pixel**, not the uv: at a fixed uv the speckle would resize with the window.
  let pixel = in.uv * shaderUniforms.screenSize;
  let hashed = fract(sin(dot(pixel + vec2<f32>(shaderUniforms.seed, shaderUniforms.seed * 1.37), vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  // Real film grains hardest in the mid-shadows, so the strength follows the inverse of luminance.
  let weight = mix(1.0, 1.0 - luminance, shaderUniforms.shadowBias);
  let grain = (hashed - 0.5) * 2.0 * shaderUniforms.amount * weight;
  return vec4<f32>(clamp(color.rgb + vec3<f32>(grain), vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
