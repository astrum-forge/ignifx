// Snow: white where the surface faces up and the world height allows it, blended into whatever the
// host material's base colour already was. The host keeps its own direct lighting, shadows, IBL and
// tone mapping — that is the whole difference between a surface shader and a `"shader"` material.
// @ignifx surface
// @ignifx uniform amount: f32 = 0.85 range(0, 1) step(0.01) tooltip("How opaque the settled snow is.")
// @ignifx uniform snowColor: vec3<f32> = color(0.94, 0.96, 1.0)
// @ignifx uniform slope: f32 = 0.5 range(0, 1) step(0.01) tooltip("How steep a face still holds snow.")
// @ignifx uniform height: f32 = 0.15 range(-1, 2) step(0.05) tooltip("The world height the snow line sits at.")

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  // `geometricNormal` is world-space, so `.y` is "how far up this face looks" with no extra maths.
  let facing = smoothstep(clamp(1.0 - surfaceUniforms.slope, 0.0, 0.99), 1.0, in.geometricNormal.y);
  let above = smoothstep(surfaceUniforms.height - 0.25, surfaceUniforms.height + 0.25, in.worldPosition.y);
  // Two multiplied sines break the snow line up, so it reads as drift rather than as a contour.
  let broken = 0.82 + 0.18 * sin(in.worldPosition.x * 3.5) * sin(in.worldPosition.z * 4.3);
  let mask = clamp(facing * above * broken, 0.0, 1.0) * surfaceUniforms.amount;
  (*s).baseColor = mix((*s).baseColor, surfaceUniforms.snowColor, mask);
}
