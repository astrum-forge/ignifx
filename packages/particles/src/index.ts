/**
 * Stateless GPU particles: the `ParticleSystem` component, `.particles.json` definitions and
 * presets, `app.particles`, and the CPU evaluator `@ignifx/particles-2d` shares
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §4). Nothing here imports `@babylonjs/lite`.
 *
 * @packageDocumentation
 */

// Bare and load-bearing: declaration bundling drops a module nothing references, and would take
// the `declare module` block that types `app.particles` with it. It emits no JavaScript.
// oxlint-disable-next-line import/no-unassigned-import -- the module is type-only; see its header.
import "./augmentation.js";

// assets — the `.particles.json` asset, its loader, and the in-memory factory.
export { ParticleAsset } from "./assets/particle-asset.js";
export { createParticleLoader, particleAssetFromDefinition } from "./assets/loader.js";

// definition — the document, its validation, its values, and the presets.
export { defineParticles } from "./definition/define-particles.js";
export {
  type DeepPartial,
  PARTICLE_PRESETS,
  particleDefinition,
  particlePresetInput,
  type ParticlePreset,
} from "./definition/presets/index.js";
export {
  LOOKUP_SAMPLES,
  PARTICLE_ASSET_TYPE,
  PARTICLE_BLEND_MODES,
  PARTICLE_EMIT_FROM,
  PARTICLE_FILE_EXTENSIONS,
  PARTICLE_FRAME_MODES,
  PARTICLE_MESHES,
  PARTICLE_RENDER_MODES,
  PARTICLE_SHAPE_KINDS,
  PARTICLE_SIMULATION_SPACES,
  PARTICLES_FORMAT,
  PARTICLES_FORMAT_VERSION,
  type ColorInput,
  type ColorValue,
  type ColorValueInput,
  type GradientStop,
  type LookupRow,
  type ParticleBlendMode,
  type ParticleBurst,
  type ParticleBurstInput,
  type ParticleDefinition,
  type ParticleDefinitionInput,
  type ParticleEmission,
  type ParticleEmissionInput,
  type ParticleEmitFrom,
  type ParticleForces,
  type ParticleForcesInput,
  type ParticleFrameMode,
  type ParticleLookup,
  type ParticleMain,
  type ParticleMainInput,
  type ParticleMeshName,
  type ParticleNoise,
  type ParticleOrbit,
  type ParticleOverLifetime,
  type ParticleOverLifetimeInput,
  type ParticleRenderer,
  type ParticleRendererInput,
  type ParticleRenderMode,
  type ParticleShape,
  type ParticleShapeInput,
  type ParticleShapeKind,
  type ParticleSheet,
  type ParticleSheetInput,
  type ParticleSimulationSpace,
  type ParticleStart,
  type ParticleStartInput,
  type ScalarValue,
  type ScalarValueInput,
} from "./definition/types.js";
export {
  bakeCurve,
  bakeGradient,
  evaluateCurve,
  evaluateGradient,
  isUnitScalar,
  resolveColor,
  resolveScalar,
  sampleRow,
  scalarMax,
  scalarMin,
  srgbToLinear,
} from "./definition/values.js";

// emitter — the CPU half: the ring, the hash, the shapes, and the core that drives them.
export {
  ParticleEmitterCore,
  type ParticleEmitterCoreOptions,
  type ParticleStopOptions,
} from "./emitter/emitter-core.js";
export { EmitterRandom, hashToUnit, particleUnits, pcg3d, recordSeed } from "./emitter/pcg3d.js";
export {
  RECORD_BYTES,
  RECORD_FLOATS,
  RECORD_LIFETIME,
  RECORD_POSITION,
  RECORD_ROTATION,
  RECORD_SEED,
  RECORD_SIZE,
  RECORD_SPAWN_TIME,
  RECORD_VELOCITY,
  SpawnRecordRing,
  type RingCensus,
  type UploadRange,
} from "./emitter/record-ring.js";
export { MeshShapeTable, sampleShape } from "./emitter/shapes.js";

// errors — the `IGX-17##` code space this package owns.
export { PARTICLES_ERROR_MESSAGES, ParticlesErrorCode, particlesError, type ParticlesErrorOptions } from "./errors.js";

// evaluate — the TypeScript evaluator and the noise it shares with the shader.
export { gradientNoise, noise3 } from "./evaluate/noise.js";
export {
  createParticleState,
  evaluateParticle,
  readScalarRow,
  type ParticleEvaluationInputs,
  type ParticleState,
} from "./evaluate/particle-math.js";

// extension — the factory a game passes to `createApp`.
export { particles, type ParticlesOptions } from "./extension.js";

// gpu — the component, the systems, and the generated program.
export { PARTICLE_RENDER_ORDER, PARTICLE_UPDATE_ORDER, ParticleSystem } from "./gpu/particle-system.js";
export { ParticleRenderSystem, ParticleUpdateSystem } from "./gpu/particle-systems.js";
export { generateParticleWgsl, particleShaderAddress } from "./gpu/wgsl.js";

// schemas — what the documentation harness reads.
export { particlesFileSchema } from "./file-schemas.js";
export { describeParticlesFormat, describeSchemas } from "./schemas.js";

// service — `app.particles`.
export {
  PARTICLES_DIAGNOSTICS_COUNTERS,
  PARTICLES_DIAGNOSTICS_GROUP,
  ParticlesService,
  type ParticleDefinitionResources,
} from "./service/particles-service.js";

// settings — the `particles` project settings section.
export {
  defaultParticlesSettings,
  PARTICLES_SETTINGS_SECTION,
  particlesSettingsSchema,
  type ParticlesSettings,
} from "./settings.js";

// version — the string reported as `Extension.version`.
export { VERSION } from "./version.js";
