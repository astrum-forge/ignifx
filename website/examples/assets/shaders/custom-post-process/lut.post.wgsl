// Colour grading through a 3D lookup table stored as a 2D strip: sixteen 16x16 slices side by side,
// which is the layout every colourist's tool exports. The example bakes the strip in code with
// `TextureAsset.fromPixels`, so the grade is a table a artist could replace rather than maths
// buried in a shader.
// @ignifx post
// @ignifx uniform amount: f32 = 1 range(0, 1) step(0.05) tooltip("How far towards the graded colour to go.")
// @ignifx texture lut

// Samples one blue slice of the strip. `size` is the edge of the cube, 16 here.
fn slice(rgb: vec3<f32>, index: f32, size: f32) -> vec3<f32> {
  // Half-texel inset on both axes: without it the outermost entries bleed into their neighbours.
  let u = (index * size + rgb.r * (size - 1.0) + 0.5) / (size * size);
  let v = (rgb.g * (size - 1.0) + 0.5) / size;
  return textureSample(lut, lutSampler, vec2<f32>(u, v)).rgb;
}

fn mainFragment(in: PostInput) -> vec4<f32> {
  let color = textureSample(inputTexture, inputTextureSampler, in.uv);
  let size = 16.0;
  let rgb = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  // The blue axis is the one the strip does not store continuously, so it is blended by hand
  // between the two nearest slices; red and green come from the sampler's own bilinear filter.
  let blue = rgb.b * (size - 1.0);
  let low = floor(blue);
  let graded = mix(slice(rgb, low, size), slice(rgb, min(low + 1.0, size - 1.0), size), blue - low);
  return vec4<f32>(mix(color.rgb, graded, shaderUniforms.amount), color.a);
}
