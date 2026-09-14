import {
  asset,
  bool,
  Component,
  createDefaults,
  createStorageBufferAsset,
  defineSchema,
  InstancedMeshRenderer,
  Mat4,
  Signal,
  u32,
  Vec3,
} from "@ignifx/core";
import { ParticleAsset } from "../assets/particle-asset.js";
import { ParticleEmitterCore } from "../emitter/emitter-core.js";
import { RECORD_BYTES, RECORD_FLOATS } from "../emitter/record-ring.js";
import { ParticlesErrorCode, particlesError } from "../errors.js";
import { createParticleState, evaluateParticle } from "../evaluate/particle-math.js";
import { ParticlesService } from "../service/particles-service.js";
import type { ParticleStopOptions } from "../emitter/emitter-core.js";
import type { UploadRange } from "../emitter/record-ring.js";
import type { ParticleEvaluationInputs, ParticleState } from "../evaluate/particle-math.js";
import type { ParticleDefinitionResources } from "../service/particles-service.js";
import type { AssetHandle, ComponentHooks, MaterialAsset, Schema, StorageBufferAsset } from "@ignifx/core";

// The `ParticleSystem` component (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3). It owns
// an emitter core, a storage buffer for the records, a material built from the definition's shared
// shader, and an `InstancedMeshRenderer` it adds to its own entity.

/**
 * Where the update system sits in `Update`: after every script, so a script's `emit()` is drawn in
 * the same frame.
 *
 * @public
 */
export const PARTICLE_UPDATE_ORDER = 900;

/**
 * Where the render system sits in `PreRender`: before core's shader-uniform (890) and render-sync
 * (900) systems, so this frame's records and uniforms are what the scene draws.
 *
 * @public
 */
export const PARTICLE_RENDER_ORDER = 880;

/** How many floats a `vec3` uniform holds. */
const VEC3_FLOATS = 3;

/**
 * Draws a particle effect on its entity.
 *
 * @example
 * ```ts
 * const fire = particleAssetFromDefinition(app, particleDefinition("fire"));
 * const system = campfire.addComponent(ParticleSystem, { definition: fire });
 * system.emit(50);
 * ```
 *
 * @public
 */
export class ParticleSystem extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/ParticleSystem";

  /** Several effects may share one entity; each owns its own renderer. */
  static allowMultiple = true;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = particleSystemSchema();

  /** The `.particles.json`, as a loaded handle. */
  declare definition: AssetHandle<ParticleAsset> | null;

  /** Whether the system plays the first frame it is enabled; the definition's `playOnAwake` must agree. */
  declare playOnAwake: boolean;

  /** The emission seed; `0` uses the definition's, and a definition seed of `0` picks at random. */
  declare seed: number;

  /** Emitted once when a non-looping system runs out of cycle and particles. */
  readonly onStopped: Signal<ParticleSystem> = new Signal<ParticleSystem>();

  readonly #census: { readonly ranges: [UploadRange, UploadRange] } = {
    ranges: [
      { start: 0, count: 0 },
      { start: 0, count: 0 },
    ],
  };

  readonly #gravity = new Float32Array(VEC3_FLOATS);

  readonly #gravityWritten = new Float32Array(VEC3_FLOATS);

  readonly #orbitCenter = new Float32Array(VEC3_FLOATS);

  readonly #orbitWritten = new Float32Array(VEC3_FLOATS);

  readonly #emitterWorld = new Float32Array(16);

  readonly #inverse = new Mat4();

  readonly #gravityWorld = new Vec3();

  readonly #gravityLocal = new Vec3();

  #inputs: ParticleEvaluationInputs | null = null;

  #service: ParticlesService | null = null;

  #core: ParticleEmitterCore | null = null;

  #applied: ParticleAsset | null = null;

  #resources: ParticleDefinitionResources | null = null;

  #renderer: InstancedMeshRenderer | null = null;

  #material: AssetHandle<MaterialAsset> | null = null;

  #storage: AssetHandle<StorageBufferAsset> | null = null;

  #reserved = 0;

  #hasAutoPlayed = false;

  #hasBoundSheet = false;

  #worldVersion = -1;

  #headWritten = -1;

  #capacityWritten = -1;

  #uploadedBytes = 0;

  #emittedBefore = 0;

  #emittedThisFrame = 0;

  #hasWarnedNoService = false;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(ParticleSystem.schema));
    this.#gravityWritten.fill(Number.NaN);
    this.#orbitWritten.fill(Number.NaN);
  }

  /**
   * The loaded document, or `null` while the handle is loading or unset.
   *
   * @returns The asset.
   */
  get asset(): ParticleAsset | null {
    const handle = this.definition;
    return handle?.state === "loaded" ? handle.value : null;
  }

  /**
   * Whether the system is playing, paused or not.
   *
   * @returns `true` between `play()` and the stop.
   */
  get isPlaying(): boolean {
    return this.#core?.isPlaying ?? false;
  }

  /**
   * Whether the clock is held by `pause()`.
   *
   * @returns `true` while paused.
   */
  get isPaused(): boolean {
    return this.#core?.isPaused ?? false;
  }

  /**
   * How many particles are alive, exactly, as of the last frame.
   *
   * @returns The count.
   */
  get aliveCount(): number {
    return this.#core?.aliveCount ?? 0;
  }

  /**
   * How many records the GPU draws this frame: from the newest back to the oldest still alive.
   *
   * @returns The draw count.
   */
  get drawCount(): number {
    return this.#core?.drawCount ?? 0;
  }

  /**
   * How many spawns displaced a particle that was still alive, because the capacity the app's
   * `maxParticles` budget granted is smaller than the definition's rate times its lifetime.
   *
   * @returns The total since the system last started from empty.
   */
  get droppedCount(): number {
    return this.#core?.droppedTotal ?? 0;
  }

  /**
   * The system-local clock, in seconds — what every particle's age is measured against and what the
   * shader reads as `clock`.
   *
   * @returns The clock.
   */
  get time(): number {
    return this.#core?.time ?? 0;
  }

  /**
   * The ring capacity in use, after the app's budget clamped the definition's.
   *
   * @returns The capacity, or `0` before a definition is applied.
   */
  get capacity(): number {
    return this.#core?.ring.capacity ?? 0;
  }

  /**
   * The CPU mirror of the spawn records: `capacity * 12` floats, one 48-byte record per slot, in
   * the layout `src/emitter/record-ring.ts` documents. Read-only; for tests and tools.
   *
   * @returns The mirror, or `null` before a definition is applied.
   *
   * @beta
   */
  get records(): Float32Array | null {
    return this.#core?.ring.floats ?? null;
  }

  /**
   * The emitter core the frame drives.
   *
   * @returns The core, or `null` before a definition is applied.
   *
   * @internal
   */
  get core(): ParticleEmitterCore | null {
    return this.#core;
  }

  /**
   * The renderer the system draws through.
   *
   * @returns The renderer, or `null` before the GPU side is built.
   *
   * @internal
   */
  get renderer(): InstancedMeshRenderer | null {
    return this.#renderer;
  }

  /**
   * The material the system draws with.
   *
   * @returns The handle, or `null` before the GPU side is built.
   *
   * @internal
   */
  get material(): AssetHandle<MaterialAsset> | null {
    return this.#material;
  }

  /**
   * The storage buffer the records are streamed into.
   *
   * @returns The handle, or `null` before the GPU side is built.
   *
   * @internal
   */
  get storage(): AssetHandle<StorageBufferAsset> | null {
    return this.#storage;
  }

  /**
   * Bytes uploaded in the last frame.
   *
   * @returns The byte count.
   *
   * @internal
   */
  get uploadedBytes(): number {
    return this.#uploadedBytes;
  }

  /**
   * Particles emitted in the last frame.
   *
   * @returns The count.
   *
   * @internal
   */
  get emittedThisFrame(): number {
    return this.#emittedThisFrame;
  }

  /** Starts emitting, or resumes after `stop()`. A `prewarm` definition fast-forwards one cycle. */
  play(): void {
    this.#hasAutoPlayed = true;
    this.#requireCore("play").play();
  }

  /**
   * Stops emitting. Live particles finish their lives unless `clear` is set.
   *
   * @param options - Whether to clear the particles too.
   */
  stop(options?: ParticleStopOptions): void {
    this.#hasAutoPlayed = true;
    this.#requireCore("stop").stop(options);
  }

  /** Holds the clock; every particle freezes in place. */
  pause(): void {
    this.#requireCore("pause").pause();
  }

  /** Releases `pause()`. */
  resume(): void {
    this.#requireCore("resume").resume();
  }

  /**
   * Spawns particles now, at the current clock, whether or not the system is playing. Called from a
   * script's `update`, they are drawn in the same frame.
   *
   * @param count - How many; floored.
   * @throws IgnifxError with code `IGX-1707` for a negative or non-finite count, or `IGX-1705`
   * when no definition is applied.
   */
  emit(count: number): void {
    if (!Number.isFinite(count) || count < 0) {
      throw this.#invalidArgument("emit", "a finite non-negative count", count);
    }
    this.#requireCore("emit").emit(count);
  }

  /**
   * Fast-forwards the system by `seconds`, emitting as it goes — what `prewarm` does.
   *
   * @param seconds - How far to advance.
   * @throws IgnifxError with code `IGX-1707` for a negative or non-finite duration, or `IGX-1705`
   * when no definition is applied.
   */
  simulate(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw this.#invalidArgument("simulate", "a finite non-negative number of seconds", seconds);
    }
    this.#requireCore("simulate").simulate(seconds);
  }

  /**
   * Evaluates one spawn record at the current clock with the CPU evaluator, in world space — the
   * same arithmetic the shader runs, for tests and tools.
   *
   * @param slot - The record's slot in the ring.
   * @param out - Receives the state; allocate one with `createParticleState()`.
   * @returns `true` when the record is alive.
   *
   * @beta
   */
  evaluate(slot: number, out: ParticleState = createParticleState()): boolean {
    const core = this.#core;
    const inputs = this.#inputs;
    if (core === null || inputs === null) {
      return false;
    }
    this.#refreshFrameInputs(core);
    return evaluateParticle(inputs, core.ring.floats, core.ring.words, slot, core.time, out);
  }

  /** Joins the service's live list. */
  onAttach(): void {
    const service = this.app.services.tryGet(ParticlesService);
    this.#service = service;
    if (service === null) {
      if (!this.#hasWarnedNoService) {
        this.#hasWarnedNoService = true;
        this.app.log.warn(
          "{entity} has a ParticleSystem, but the particles() extension is not registered; it stays inert.",
          this.entity.name,
        );
      }
      return;
    }
    service.attach(this);
  }

  /** Releases the GPU side, the budget, and the shared resources. */
  onDetach(): void {
    this.#teardown();
    this.#service?.detach(this);
    this.#service = null;
  }

  /**
   * One frame of emission. The `Update` system calls it.
   *
   * @param dt - The frame's scaled delta, or `0` while the app is paused.
   *
   * @internal
   */
  tick(dt: number): void {
    const service = this.#service;
    if (service === null || this.isDestroyed) {
      return;
    }
    const core = this.#ensureCore(service);
    if (core === null) {
      return;
    }
    const enabled = this.isEnabledInHierarchy;
    if (!this.#hasAutoPlayed && enabled) {
      this.#hasAutoPlayed = true;
      const applied = this.#applied;
      if (this.playOnAwake && applied !== null && applied.definition.main.playOnAwake) {
        core.play();
      }
    }
    core.qualityScale = service.qualityScale;
    if (enabled) {
      core.advance(dt);
    }
    core.reconcile();
    const emitted = core.emittedTotal;
    this.#emittedThisFrame = Math.max(0, emitted - this.#emittedBefore);
    this.#emittedBefore = emitted;
  }

  /**
   * One frame of upload. The `PreRender` system calls it.
   *
   * @internal
   */
  sync(): void {
    this.#uploadedBytes = 0;
    const service = this.#service;
    const core = this.#core;
    const applied = this.#applied;
    if (service === null || core === null || applied === null || this.isDestroyed) {
      return;
    }
    this.#ensureGpu(service, core, applied);
    const renderer = this.#renderer;
    const material = this.#material;
    const storage = this.#storage;
    if (renderer === null || material === null || storage === null) {
      return;
    }
    this.#upload(core, storage);
    const values = material.value;
    values.setUniform("clock", core.time);
    const head = core.ring.head;
    if (head !== this.#headWritten) {
      this.#headWritten = head;
      values.setUniform("head", head);
    }
    if (core.ring.capacity !== this.#capacityWritten) {
      this.#capacityWritten = core.ring.capacity;
      values.setUniform("capacity", core.ring.capacity);
    }
    if (applied.definition.main.simulationSpace === "local") {
      values.setUniform("emitterWorld", this.#emitterWorld);
    }
    if (!sameVec3(this.#gravity, this.#gravityWritten)) {
      this.#gravityWritten.set(this.#gravity);
      values.setUniform("gravity", this.#gravity);
    }
    // The generated program declares `orbitCenter` only when the definition orbits.
    if (applied.definition.forces.orbit !== null && !sameVec3(this.#orbitCenter, this.#orbitWritten)) {
      this.#orbitWritten.set(this.#orbitCenter);
      values.setUniform("orbitCenter", this.#orbitCenter);
    }
    const sheet = this.#resources?.sheet ?? null;
    if (!this.#hasBoundSheet && sheet !== null && sheet.state === "loaded") {
      this.#hasBoundSheet = true;
      values.setTexture("sheet", sheet);
    }
    const draw = Math.min(core.drawCount, core.ring.capacity);
    if (draw !== renderer.count) {
      renderer.setCount(draw);
    }
    renderer.enabled = this.isEnabledInHierarchy;
  }

  /**
   * Refreshes the emitter matrix, the simulation-space gravity, and the orbit centre from the entity's
   * transform and the service, only when something moved.
   *
   * @param core - The core to write the matrix into.
   */
  #refreshFrameInputs(core: ParticleEmitterCore): void {
    const applied = this.#applied;
    const service = this.#service;
    if (applied === null || service === null) {
      return;
    }
    const transform = this.transform;
    const version = transform.worldMatrixVersion;
    const moved = version !== this.#worldVersion;
    if (moved) {
      this.#worldVersion = version;
      const world = transform.worldMatrix;
      this.#emitterWorld.set(world);
      core.emitterWorld.set(world);
    }
    const forces = applied.definition.forces;
    const gravity = forces.gravity;
    const g = service.gravity;
    const world = this.#gravityWorld;
    if (gravity === null) {
      world.set(g.x * forces.gravityMultiplier, g.y * forces.gravityMultiplier, g.z * forces.gravityMultiplier);
    } else {
      world.set(gravity.x, gravity.y, gravity.z);
    }
    const local = this.#gravityLocal;
    if (applied.definition.main.simulationSpace === "local") {
      if (Mat4.invertToRef(transform.worldMatrix, this.#inverse)) {
        Mat4.transformDirectionToRef(this.#inverse.elements, world, local);
      } else {
        local.copyFrom(world);
      }
      this.#orbitCenter[0] = 0;
      this.#orbitCenter[1] = 0;
      this.#orbitCenter[2] = 0;
    } else {
      local.copyFrom(world);
      this.#orbitCenter[0] = this.#emitterWorld[12] ?? 0;
      this.#orbitCenter[1] = this.#emitterWorld[13] ?? 0;
      this.#orbitCenter[2] = this.#emitterWorld[14] ?? 0;
    }
    this.#gravity[0] = local.x + forces.constantForce.x;
    this.#gravity[1] = local.y + forces.constantForce.y;
    this.#gravity[2] = local.z + forces.constantForce.z;
  }

  /**
   * The core, ready to spawn: built if the definition changed, and always holding the entity's
   * current world matrix. The matrix has to be current *before* anything spawns, because `play()`
   * on a prewarmed document fast-forwards a whole cycle and a `"world"` record bakes the matrix in.
   *
   * @param service - The service.
   * @returns The core, or `null` while the definition is loading or unset.
   */
  #ensureCore(service: ParticlesService): ParticleEmitterCore | null {
    if (this.asset !== this.#applied) {
      this.#buildCore(service);
    }
    const core = this.#core;
    if (core !== null) {
      this.#refreshFrameInputs(core);
    }
    return core;
  }

  /**
   * Builds, or rebuilds, the core for the definition handle's loaded value.
   *
   * @param service - The service.
   */
  #buildCore(service: ParticlesService): void {
    const loaded = this.asset;
    this.#teardown();
    this.#applied = loaded;
    if (loaded === null) {
      return;
    }
    const definition = loaded.definition;
    this.#reserved = service.reserve(this.entity.name, definition.main.capacity);
    const seed = this.seed !== 0 ? this.seed : definition.main.seed;
    const core = new ParticleEmitterCore({ definition, capacity: this.#reserved, seed });
    core.onStopped = (): void => {
      this.onStopped.emit(this);
    };
    this.#core = core;
    this.#resources = service.acquireResources(loaded);
    this.#hasAutoPlayed = false;
    this.#emittedBefore = 0;
    this.#worldVersion = -1;
    this.#inputs = {
      definition,
      gravity: this.#gravity,
      emitterWorld: this.#emitterWorld,
      orbitCenter: this.#orbitCenter,
    };
  }

  /**
   * Builds the storage buffer, the material, and the renderer once the shared shader has loaded.
   *
   * @param service - The service.
   * @param core - The core whose ring is uploaded.
   * @param applied - The applied asset.
   */
  #ensureGpu(service: ParticlesService, core: ParticleEmitterCore, applied: ParticleAsset): void {
    if (this.#renderer !== null) {
      return;
    }
    const resources = this.#resources;
    if (resources === null) {
      return;
    }
    const shader = resources.shader;
    if (shader.state === "failed") {
      service.reportShaderFailure(applied, shader.error?.message ?? "unknown failure");
      return;
    }
    if (shader.state !== "loaded") {
      return;
    }
    const storage = createStorageBufferAsset(this.app, `particles:${this.entity.name}`, core.ring.floats);
    const material = service.createMaterial(resources);
    material.value.setStorageBuffer("particles", storage);
    this.#storage = storage;
    this.#material = material;
    this.#headWritten = -1;
    this.#capacityWritten = -1;
    this.#gravityWritten.fill(Number.NaN);
    this.#orbitWritten.fill(Number.NaN);
    this.#hasBoundSheet = false;
    core.ring.markUploaded();
    const capacity = core.ring.capacity;
    const renderer = this.entity.addComponent(InstancedMeshRenderer, {
      mesh: resources.mesh,
      materials: [material],
      capacity,
      gpuCulling: false,
      castShadows: false,
      receiveShadows: false,
      pickable: false,
      renderOrder: applied.definition.main.renderOrder,
    });
    renderer.setMatrices(service.identitySlab(capacity), capacity);
    renderer.setCount(Math.min(core.drawCount, capacity));
    this.#renderer = renderer;
  }

  /**
   * Streams the records written since the last frame into the storage buffer: one update, or two
   * when the ring wrapped.
   *
   * @param core - The core whose ring is uploaded.
   * @param storage - The buffer.
   */
  #upload(core: ParticleEmitterCore, storage: AssetHandle<StorageBufferAsset>): void {
    const ring = core.ring;
    const ranges = this.#census.ranges;
    const count = ring.pendingRanges(ranges);
    if (count === 0) {
      return;
    }
    const buffer = storage.value;
    for (let index = 0; index < count; index += 1) {
      const range = ranges[index];
      if (range === undefined || range.count === 0) {
        continue;
      }
      const view = ring.floats.subarray(range.start * RECORD_FLOATS, (range.start + range.count) * RECORD_FLOATS);
      buffer.update(view, range.start * RECORD_BYTES);
      this.#uploadedBytes += range.count * RECORD_BYTES;
    }
    ring.markUploaded();
  }

  /** Releases everything the applied definition built. */
  #teardown(): void {
    const renderer = this.#renderer;
    this.#renderer = null;
    if (renderer !== null && !renderer.isDestroyed) {
      renderer.destroy();
    }
    this.#material?.release();
    this.#material = null;
    this.#storage?.release();
    this.#storage = null;
    const service = this.#service;
    const applied = this.#applied;
    if (service !== null) {
      if (applied !== null && this.#resources !== null) {
        service.releaseResources(applied);
      }
      service.release(this.#reserved);
    }
    this.#resources = null;
    this.#reserved = 0;
    this.#core = null;
    this.#applied = null;
    this.#inputs = null;
  }

  /**
   * The core, or a misuse error naming the method.
   *
   * @param method - The method being called.
   * @returns The core.
   * @throws IgnifxError with code `IGX-1705`.
   */
  #requireCore(method: string): ParticleEmitterCore {
    const service = this.#service;
    const core = service === null ? this.#core : this.#ensureCore(service);
    if (core !== null) {
      return core;
    }
    throw particlesError(
      ParticlesErrorCode.noDefinition,
      `${this.entity.name} has a ParticleSystem with no definition, so ${method}() cannot run.`,
      {
        context: { entity: this.entity.name, method },
        hint: "Assign a loaded ParticleAsset handle to `definition` first.",
      },
    );
  }

  /**
   * Builds the `IGX-1707` argument error.
   *
   * @param method - The method.
   * @param expected - What it wanted.
   * @param value - What it got.
   * @returns The error.
   */
  #invalidArgument(method: string, expected: string, value: number): ReturnType<typeof particlesError> {
    return particlesError(ParticlesErrorCode.invalidArgument, `${method} needs ${expected}, not ${String(value)}.`, {
      context: { method, expected, value },
    });
  }
}

/**
 * Whether two three-float arrays hold the same values.
 *
 * @param a - One array.
 * @param b - The other.
 * @returns `true` when every component matches.
 */
function sameVec3(a: Float32Array, b: Float32Array): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema, built inside a function so module scope holds no calls (`CONSTITUTION.md` §3.5).
 */
function particleSystemSchema(): Schema {
  return defineSchema({
    definition: asset(ParticleAsset, { tooltip: "The .particles.json this system plays." }),
    playOnAwake: bool(true, { tooltip: "Play the first frame the system is enabled, if the definition agrees." }),
    seed: u32(0, { tooltip: "The emission seed; 0 uses the definition's, and 0 there picks at random." }),
  });
}
