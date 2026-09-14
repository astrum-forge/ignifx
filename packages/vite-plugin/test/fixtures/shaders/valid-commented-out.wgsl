// @ignifx shader
// @ignifx uniform tint: vec3<f32> = color(1.0, 1.0, 1.0)

/*
 * An earlier revision, kept as a comment:
 *   // @ignifx post
 *   textureSample(oldTexture, oldTextureSampler, uv)
 *   shaderUniforms.oldName
 *   /* nested, because WGSL block comments nest */
 */

@vertex fn mainVertex(input: VertexInput) -> @builtin(position) vec4<f32> {
  return vec4<f32>(input.position, 1.0); // shaderUniforms.alsoNotReal
}

@fragment fn mainFragment() -> @location(0) vec4<f32> {
  return vec4<f32>(shaderUniforms.tint, 1.0);
}
