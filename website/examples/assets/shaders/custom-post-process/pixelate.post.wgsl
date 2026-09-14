// Pixelate: snap the sample coordinate to a coarse grid. It is the effect that proves the chain is
// really resampling — put it before the CRT and the scan lines run over blocks, put it after and
// the blocks are cut by scan lines, and the order select in the panel switches between the two.
// @ignifx post
// @ignifx uniform blockSize: f32 = 6 range(1, 32) step(1) tooltip("Screen pixels per block.")

fn mainFragment(in: PostInput) -> vec4<f32> {
  let size = max(shaderUniforms.blockSize, 1.0);
  // Rounding in pixel space and going back to uv is what keeps the blocks square whatever the
  // window's aspect is; rounding the uv directly would give rectangles.
  let pixel = in.uv * shaderUniforms.screenSize;
  let snapped = (floor(pixel / size) + vec2<f32>(0.5, 0.5)) * size;
  return textureSample(inputTexture, inputTextureSampler, snapped / shaderUniforms.screenSize);
}
