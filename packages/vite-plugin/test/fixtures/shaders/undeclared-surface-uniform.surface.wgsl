// @ignifx surface
// @ignifx uniform amount: f32 = 0.5

fn surface(in: SurfaceInput, s: ptr<function, Surface>) {
  (*s).alpha = surfaceUniforms.amont;
}
