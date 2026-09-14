// Wetness: a darker, more saturated base colour in the low band of the model, which is what water
// actually does to a diffuse surface — it fills the pores and stops them scattering light back.
// @ignifx surface
// @ignifx uniform amount: f32 = 0.7 range(0, 1) step(0.01) tooltip("How wet the wet band is.")
// @ignifx uniform waterLine: f32 = 0.22 range(-0.5, 2) step(0.01) tooltip("World height the water reached.")
// @ignifx uniform fade: f32 = 0.18 range(0.01, 0.8) step(0.01) tooltip("How far the damp edge climbs.")

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  let wet = 1.0 - smoothstep(surfaceUniforms.waterLine, surfaceUniforms.waterLine + surfaceUniforms.fade, in.worldPosition.y);
  let mask = clamp(wet, 0.0, 1.0) * surfaceUniforms.amount;
  // Darker and slightly richer, both from the same mask.
  (*s).baseColor = mix((*s).baseColor, (*s).baseColor * vec3<f32>(0.34, 0.36, 0.42), mask);
  // A real wet surface is also **smoother**, and `Surface` carries `roughness` — but Babylon Lite's
  // PBR template declares `roughness` as a `let`, so the write is accepted here and dropped on the
  // way out (`packages/core/src/render/surface-shader-compiler.ts`). Lowering roughness is the
  // first upstream ask; until it lands, wetness is an albedo effect and the sheen has to come from
  // the rim shader beside it.
}
