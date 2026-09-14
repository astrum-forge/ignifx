/**
 * `@ignifx/particles-2d` public barrel: the `ParticleSystem2D` component, the `particles2D()`
 * extension, and the service that shares `app.particles`' budget with the 3D systems
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3).
 *
 * Explicit named re-exports only — no `export *` (coding standards §4). The package imports nothing
 * from `@babylonjs/lite`: it draws through `@ignifx/2d`'s `SpriteBatch` and simulates with
 * `@ignifx/particles`' emitter core and evaluator.
 *
 * @packageDocumentation
 */

// component — what a game adds to an entity.
export { ParticleSystem2D } from "./component/particle-system-2d.js";

// errors — the `IGX-175#` code space this package owns.
export {
  PARTICLES_2D_ERROR_MESSAGES,
  Particles2DErrorCode,
  particles2DError,
  type Particles2DErrorOptions,
} from "./errors.js";

// extension — the factory a game passes to `createApp`.
export { particles2D } from "./extension.js";

// schemas — what the documentation harness reads.
export { describeSchemas } from "./schemas.js";

// service — the live system list, the shared budget, and the counters.
export {
  PARTICLES_2D_DIAGNOSTICS_COUNTERS,
  PARTICLES_2D_DIAGNOSTICS_GROUP,
  Particles2DService,
} from "./service/particles-2d-service.js";

// systems — the two frame systems and the orders they register at.
export {
  PARTICLE_2D_UPDATE_ORDER,
  PARTICLE_2D_WRITE_ORDER,
  Particle2DUpdateSystem,
  Particle2DWriteSystem,
} from "./systems.js";

// version — the string reported as `Extension.version`.
export { VERSION } from "./version.js";
