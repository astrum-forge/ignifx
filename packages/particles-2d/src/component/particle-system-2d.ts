import { SpriteAtlasAsset } from "@ignifx/2d";
import { asset, bool, Component, createDefaults, defineSchema, Mat4, Signal, str, u32, Vec3 } from "@ignifx/core";
import {
  createParticleState,
  evaluateParticle,
  ParticleAsset,
  ParticleEmitterCore,
  RECORD_FLOATS,
  RECORD_LIFETIME,
  RECORD_SPAWN_TIME,
} from "@ignifx/particles";
import { Particles2DErrorCode, particles2DError } from "../errors.js";
import { Particles2DService } from "../service/particles-2d-service.js";
import type { SpriteBatch, SpriteBlendName } from "@ignifx/2d";
import type { AssetHandle, ComponentHooks, Schema } from "@ignifx/core";
import type {
  ParticleBlendMode,
  ParticleEvaluationInputs,
  ParticleState,
  ParticleStopOptions,
} from "@ignifx/particles";

/**
 * `ParticleSystem2D` (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3): the 3D
 * `ParticleSystem` with its GPU half replaced by a `SpriteBatch`, sharing the emitter core and the
 * evaluator so both put the same document's particles in the same places.
 *
 * Records are aged at `Math.fround(core.time)` because `spawnTime` is an `f32` and the 3D shader
 * reads `clock` as one: at `f64` precision a particle spawned on the current frame rounds a
 * fraction above the clock and reads as unborn.
 */

/** Radians to degrees. */
const RAD_TO_DEG = 180 / Math.PI;

/** How many floats a `vec3` holds. */
const VEC3_FLOATS = 3;

/** The sorting layer a system falls back to when the project does not declare the one it names. */
const FALLBACK_SORTING_LAYER = "Default";

/**
 * The sprite blend each particle blend draws with. Both tables spell the three modes the same way,
 * so the map is a compiler-checked identity rather than a translation.
 */
const SPRITE_BLEND: Readonly<Record<ParticleBlendMode, SpriteBlendName>> = Object.freeze({
  premultiplied: "premultiplied",
  additive: "additive",
  alpha: "alpha",
});

/** What the evaluator reads beyond the ring: the definition and the per-frame vectors. */
interface EvaluationInputs extends ParticleEvaluationInputs {
  /** The applied document; replaced when the `definition` handle's value changes. */
  readonly definition: ParticleAsset["definition"];
}

/**
 * Draws a `.particles.json` effect as sprites on a sorting layer.
 *
 * @remarks
 * The document is simulated exactly as the 3D `ParticleSystem` simulates it, then flattened: X and
 * Y become the sprite's centre in world metres and the evaluated Z is dropped, because 2D draws in
 * sorting-layer order rather than by depth (`docs/architecture/11-2d-toolkit.md` §3). Sizes are
 * world metres, the tint is linear, and `renderer.texture`, `mode`, `lit` and `pivot` are ignored —
 * the frames come from {@link ParticleSystem2D.atlas}.
 *
 * @example
 * ```ts
 * const torch = app.world.createEntity("torch");
 * const system = torch.addComponent(ParticleSystem2D, { definition: fire, atlas: sparks });
 * system.emit(20);
 * ```
 *
 * @public
 */
export class ParticleSystem2D extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/ParticleSystem2D";

  /** Several effects may share one entity; each owns its own batch. */
  static allowMultiple = true;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = particleSystem2DSchema();

  /** The `.particles.json`, as a loaded handle. */
  declare definition: AssetHandle<ParticleAsset> | null;

  /**
   * The atlas every particle draws a frame of; it must be loaded before anything is drawn.
   *
   * @remarks
   * The document's sheet tile index is the atlas frame index: `renderer.sheet.tiles` of
   * `{ x: 2, y: 2 }` picks frames 0–3, counted across rows. A document with no `sheet`, and a frame
   * the atlas does not have, both draw frame 0.
   */
  declare atlas: AssetHandle<SpriteAtlasAsset> | null;

  /** Whether the system plays the first frame it is enabled; the definition's `playOnAwake` must agree. */
  declare playOnAwake: boolean;

  /** The emission seed; `0` uses the definition's, and a definition seed of `0` picks at random. */
  declare seed: number;

  /** Which sorting layer the particles draw on. */
  declare sortingLayer: string;

  /** Emitted once when a non-looping system runs out of cycle and particles. */
  readonly onStopped: Signal<ParticleSystem2D> = new Signal<ParticleSystem2D>();

  readonly #state: ParticleState = createParticleState();

  readonly #gravity = new Float32Array(VEC3_FLOATS);

  readonly #orbitCenter = new Float32Array(VEC3_FLOATS);

  readonly #emitterWorld = new Float32Array(16);

  readonly #inverse = new Mat4();

  readonly #gravityWorld = new Vec3();

  readonly #gravityLocal = new Vec3();

  /** The evaluator's per-system inputs, built when a definition is applied. */
  #inputs: EvaluationInputs | null = null;

  #service: Particles2DService | null = null;

  #core: ParticleEmitterCore | null = null;

  #applied: ParticleAsset | null = null;

  #batch: SpriteBatch | null = null;

  #appliedAtlas: SpriteAtlasAsset | null = null;

  #appliedLayer = "";

  #reserved = 0;

  #hasAutoPlayed = false;

  #worldVersion = -1;

  #aliveCount = 0;

  #spriteCount = 0;

  #emittedBefore = 0;

  #emittedThisFrame = 0;

  #hasWarnedNoService = false;

  #hasWarnedNoAtlas = false;

  #hasWarnedLayer = false;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(ParticleSystem2D.schema));
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
    return this.#aliveCount;
  }

  /**
   * How many sprite slots the last frame wrote: the alive particles the batch is drawing.
   *
   * @returns The count.
   */
  get spriteCount(): number {
    return this.#spriteCount;
  }

  /**
   * The system-local clock, in seconds — what every particle's age is measured against.
   *
   * @returns The clock.
   */
  get time(): number {
    return this.#core?.time ?? 0;
  }

  /**
   * The ring capacity in use, after `app.particles`' budget clamped the definition's.
   *
   * @returns The capacity, or `0` before a definition is applied.
   */
  get capacity(): number {
    return this.#core?.ring.capacity ?? 0;
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
   * The sprite batch the particles are written into.
   *
   * @returns The batch, or `null` before the atlas has loaded.
   *
   * @internal
   */
  get batch(): SpriteBatch | null {
    return this.#batch;
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
   * @throws IgnifxError with code `IGX-1753` for a negative or non-finite count, or `IGX-1752`
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
   * @throws IgnifxError with code `IGX-1753` for a negative or non-finite duration, or `IGX-1752`
   * when no definition is applied.
   */
  simulate(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw this.#invalidArgument("simulate", "a finite non-negative number of seconds", seconds);
    }
    this.#requireCore("simulate").simulate(seconds);
  }

  /**
   * Evaluates one spawn record at the current clock — the same arithmetic the 3D system's shader
   * runs, for tests and tools.
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
    return evaluateParticle(inputs, core.ring.floats, core.ring.words, slot, Math.fround(core.time), out);
  }

  /** Joins the service's live list. */
  onAttach(): void {
    const service = this.app.services.tryGet(Particles2DService);
    this.#service = service;
    if (service === null) {
      if (!this.#hasWarnedNoService) {
        this.#hasWarnedNoService = true;
        this.app.log.warn(
          `${Particles2DErrorCode.extensionMissing}: {entity} has a ParticleSystem2D, but the particles2D() extension is not registered.`,
          this.entity.name,
        );
      }
      return;
    }
    service.attach(this);
  }

  /** Releases the batch, the budget, and the core. */
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
    this.#refreshFrameInputs(core);
    core.qualityScale = service.qualityScale;
    if (enabled) {
      core.advance(dt);
    }
    // The core's own census drives its `onStopped`; the count this component reports is taken at
    // the shader's precision (see the module comment).
    core.reconcile();
    this.#aliveCount = countAlive(core);
    const emitted = core.emittedTotal;
    this.#emittedThisFrame = Math.max(0, emitted - this.#emittedBefore);
    this.#emittedBefore = emitted;
  }

  /**
   * One frame of drawing: every live record evaluated into a sprite slot. The `PreRender` system
   * calls it.
   *
   * @internal
   */
  write(): void {
    this.#spriteCount = 0;
    const service = this.#service;
    const core = this.#core;
    const inputs = this.#inputs;
    if (service === null || core === null || inputs === null || this.isDestroyed) {
      return;
    }
    // Checked before the batch is claimed, so a disabled system asks for no slots and reports no
    // missing atlas.
    if (!this.isEnabledInHierarchy) {
      const claimed = this.#batch;
      if (claimed !== null) {
        claimed.count = 0;
      }
      return;
    }
    const batch = this.#ensureBatch(service, core);
    if (batch === null) {
      return;
    }
    const state = this.#state;
    const ring = core.ring;
    const floats = ring.floats;
    const words = ring.words;
    const capacity = ring.capacity;
    const written = ring.written;
    const clock = Math.fround(core.time);
    let slot = 0;
    // Oldest record first, so a newer particle draws over an older one: a batch does no sorting of
    // its own and Lite draws its slots in index order.
    for (let index = Math.max(0, written - capacity); index < written && slot < capacity; index += 1) {
      if (evaluateParticle(inputs, floats, words, index % capacity, clock, state)) {
        writeSlot(batch, slot, state);
        slot += 1;
      }
    }
    // Written first, counted second: `write` marks a slot beyond the current count invisible, and
    // raising the count is what reveals the ones this frame added.
    batch.count = slot;
    this.#spriteCount = slot;
  }

  /**
   * Refreshes the emitter matrix, the simulation-space gravity, and the orbit centre from the
   * entity's transform and the shared service.
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
    if (version !== this.#worldVersion) {
      this.#worldVersion = version;
      const matrix = transform.worldMatrix;
      this.#emitterWorld.set(matrix);
      core.emitterWorld.set(matrix);
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
      // Gravity is given in the simulation space, so a rotated emitter still drops its particles
      // toward the world's floor.
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
   * Builds, or rebuilds, the core when the definition handle's loaded value changed.
   *
   * @param service - The service.
   * @returns The core, or `null` while the definition is loading or unset.
   */
  #ensureCore(service: Particles2DService): ParticleEmitterCore | null {
    const loaded = this.asset;
    if (loaded === this.#applied) {
      return this.#core;
    }
    this.#teardown();
    this.#applied = loaded;
    if (loaded === null) {
      return null;
    }
    const definition = loaded.definition;
    this.#reserved = service.particles.reserve(this.entity.name, definition.main.capacity);
    const seed = this.seed === 0 ? definition.main.seed : this.seed;
    const core = new ParticleEmitterCore({ definition, capacity: this.#reserved, seed });
    core.onStopped = (): void => {
      this.onStopped.emit(this);
    };
    this.#core = core;
    this.#hasAutoPlayed = false;
    this.#emittedBefore = 0;
    this.#worldVersion = -1;
    this.#inputs = {
      definition,
      gravity: this.#gravity,
      emitterWorld: this.#emitterWorld,
      orbitCenter: this.#orbitCenter,
    };
    return core;
  }

  /**
   * Claims the sprite slots once the atlas has loaded, and re-claims them when the atlas, the
   * sorting layer, or the capacity changed.
   *
   * @param service - The service.
   * @param core - The core whose capacity the batch matches.
   * @returns The batch, or `null` while the atlas is loading or unset.
   */
  #ensureBatch(service: Particles2DService, core: ParticleEmitterCore): SpriteBatch | null {
    const handle = this.atlas;
    if (handle === null || handle.state !== "loaded") {
      if (!this.#hasWarnedNoAtlas) {
        this.#hasWarnedNoAtlas = true;
        this.app.log.warn(
          `${Particles2DErrorCode.atlasNotLoaded}: {entity} has a ParticleSystem2D whose atlas is {state}, not loaded; it draws nothing.`,
          this.entity.name,
          handle?.state ?? "unset",
        );
      }
      return null;
    }
    const loaded = handle.value;
    const layer = this.#resolveSortingLayer(service);
    const existing = this.#batch;
    if (existing !== null && loaded === this.#appliedAtlas && layer === this.#appliedLayer) {
      return existing;
    }
    this.#releaseBatch();
    this.#hasWarnedNoAtlas = false;
    const batch = service.createBatch({
      atlas: handle,
      capacity: core.ring.capacity,
      sortingLayer: layer,
      blend: SPRITE_BLEND[this.#applied?.definition.renderer.blend ?? "alpha"],
    });
    this.#batch = batch;
    this.#appliedAtlas = loaded;
    this.#appliedLayer = layer;
    return batch;
  }

  /**
   * The sorting layer the batch goes on, falling back to `"Default"` for one the project never
   * declared — the batch would otherwise throw `IGX-1107` in the middle of a frame.
   *
   * @param service - The service holding the project's layer names.
   * @returns The layer to use.
   */
  #resolveSortingLayer(service: Particles2DService): string {
    const named = this.sortingLayer;
    if (service.hasSortingLayer(named)) {
      return named;
    }
    if (!this.#hasWarnedLayer) {
      this.#hasWarnedLayer = true;
      this.app.log.warn(
        `${Particles2DErrorCode.unknownSortingLayer}: {entity} draws particles on the undeclared sorting layer {layer}; {fallback} was used.`,
        this.entity.name,
        named,
        FALLBACK_SORTING_LAYER,
      );
    }
    return FALLBACK_SORTING_LAYER;
  }

  /** Gives the sprite slots back to their layer. */
  #releaseBatch(): void {
    this.#batch?.dispose();
    this.#batch = null;
    this.#appliedAtlas = null;
    this.#appliedLayer = "";
    this.#spriteCount = 0;
  }

  /** Releases everything the applied definition built. */
  #teardown(): void {
    this.#releaseBatch();
    this.#aliveCount = 0;
    const service = this.#service;
    if (service !== null) {
      service.particles.release(this.#reserved);
    }
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
   * @throws IgnifxError with code `IGX-1752`.
   */
  #requireCore(method: string): ParticleEmitterCore {
    const service = this.#service;
    const core = service === null ? this.#core : this.#ensureCore(service);
    if (core !== null) {
      return core;
    }
    throw particles2DError(
      Particles2DErrorCode.noDefinition,
      `${this.entity.name} has a ParticleSystem2D with no definition, so ${method}() cannot run.`,
      {
        context: { entity: this.entity.name, method },
        hint: "Assign a loaded ParticleAsset handle to `definition` first.",
      },
    );
  }

  /**
   * Builds the `IGX-1753` argument error.
   *
   * @param method - The method.
   * @param expected - What it wanted.
   * @param value - What it got.
   * @returns The error.
   */
  #invalidArgument(method: string, expected: string, value: number): ReturnType<typeof particles2DError> {
    return particles2DError(
      Particles2DErrorCode.invalidArgument,
      `${method} needs ${expected}, not ${String(value)}.`,
      {
        context: { method, expected, value },
      },
    );
  }
}

/**
 * Writes one evaluated particle into one slot: X and Y in world metres, the size as the sprite's
 * width and height, the rotation in degrees, and the linear colour.
 *
 * @param batch - The batch to write into.
 * @param slot - The slot index.
 * @param state - The evaluated particle.
 */
function writeSlot(batch: SpriteBatch, slot: number, state: ParticleState): void {
  const position = state.position;
  const size = state.size;
  const color = state.color;
  batch.write(
    slot,
    position[0] ?? 0,
    position[1] ?? 0,
    size[0] ?? 0,
    size[1] ?? 0,
    state.frame,
    state.rotation * RAD_TO_DEG,
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    color[3] ?? 0,
  );
}

/**
 * Counts the records inside their lifetime at the shader's `f32` clock.
 *
 * @param core - The core whose ring is counted.
 * @returns The alive count.
 */
function countAlive(core: ParticleEmitterCore): number {
  const ring = core.ring;
  const floats = ring.floats;
  const capacity = ring.capacity;
  const written = ring.written;
  const clock = Math.fround(core.time);
  let alive = 0;
  for (let index = Math.max(0, written - capacity); index < written; index += 1) {
    const base = (index % capacity) * RECORD_FLOATS;
    const age = clock - (floats[base + RECORD_SPAWN_TIME] ?? 0);
    if (age >= 0 && age <= (floats[base + RECORD_LIFETIME] ?? 0)) {
      alive += 1;
    }
  }
  return alive;
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema, built inside a function so module scope holds no calls (`CONSTITUTION.md` §3.5).
 */
function particleSystem2DSchema(): Schema {
  return defineSchema({
    definition: asset(ParticleAsset, { tooltip: "The .particles.json this system plays." }),
    atlas: asset(SpriteAtlasAsset, { tooltip: "The atlas whose frames the particles draw." }),
    playOnAwake: bool(true, { tooltip: "Play the first frame the system is enabled, if the definition agrees." }),
    seed: u32(0, { tooltip: "The emission seed; 0 uses the definition's, and 0 there picks at random." }),
    sortingLayer: str(FALLBACK_SORTING_LAYER, { tooltip: "Which sorting layer the particles draw on." }),
  });
}
