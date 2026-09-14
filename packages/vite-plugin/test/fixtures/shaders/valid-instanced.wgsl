// The particle draw of docs/plan/2026-09-terrain-particles-shaders.md §4.4: thin instances whose
// vertex stage reads a spawn record out of a storage buffer by instance index.
// @ignifx shader
// @ignifx attributes position, uv
// @ignifx system world, viewProjection, time
// @ignifx storage particles: array<Particle>
// @ignifx uniform emitterWorld: mat4<f32> = identity
// @ignifx texture sheet
// @ignifx texture lut
// @ignifx blend premultiplied cull none depthWrite off instancing matrices

struct Particle {
  @align(16) origin: vec3<f32>,
  @align(16) velocity: vec3<f32>,
  spawnTime: f32,
  lifetime: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fade: f32,
}

@vertex fn mainVertex(input: VertexInput, @builtin(instance_index) index: u32) -> VertexOutput {
  let record = particles[index];
  let age = shaderUniforms.time - record.spawnTime;
  let local = record.origin + record.velocity * age;
  let instanceWorld = mat4x4<f32>(input.world0, input.world1, input.world2, input.world3);
  var out: VertexOutput;
  out.position = shaderSystem.viewProjection * shaderSystem.world * instanceWorld * vec4<f32>(local, 1.0);
  out.uv = input.uv;
  out.fade = clamp(1.0 - age / record.lifetime, 0.0, 1.0) * textureSampleLevel(lut, lutSampler, input.uv, 0.0).r;
  return out;
}

@fragment fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(sheet, sheetSampler, input.uv) * input.fade;
}
