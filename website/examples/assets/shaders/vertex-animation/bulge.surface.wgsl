// A static bulge: the `displace` hook offsets the vertex before Babylon Lite's PBR template lights
// it, so the sphere below keeps direct lighting, shadow casting, IBL and tone mapping and still
// changes shape.
//
// **A `displace` hook cannot read `surfaceUniforms` or the clock, and cannot sample a texture.**
// Lite declares a plugin's uniforms and samplers with fragment-stage visibility only and gives a
// plugin no vertex helper-function channel at all, so the body is inlined into Lite's own vertex
// entry point and `@ignifx/core` refuses a body that reaches for either (IGX-0723). Wind and waves
// therefore need a full `"shader"` material — which is what the three files beside this one are.
// The offset here is a pure function of the vertex's own position and normal.
// @ignifx surface

fn displace(in: DisplaceInput) -> vec3<f32> {
  // Six lobes around the equator, tapering to nothing at the poles: a fixed shape, not an animation.
  let lat = clamp(1.0 - abs(in.position.y) * 1.6, 0.0, 1.0);
  let lobes = sin(atan2(in.position.z, in.position.x) * 6.0) * 0.5 + 0.5;
  return in.normal * (lobes * lat * 0.22);
}
