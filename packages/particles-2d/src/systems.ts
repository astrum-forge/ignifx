import type { Particles2DService } from "./service/particles-2d-service.js";
import type { System, SystemContext } from "@ignifx/core";

/**
 * The two frame systems that drive every `ParticleSystem2D`
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3, "Lifecycle").
 *
 * | System                    | Phase       | Order  | Why there                                                                    |
 * | ------------------------- | ----------- | ------ | ---------------------------------------------------------------------------- |
 * | `Particle2DUpdateSystem`  | `Update`    | `900`  | After every script's `update`, so `emit()` from a script is drawn this frame |
 * | `Particle2DWriteSystem`   | `PreRender` | `-460` | Before `@ignifx/2d`'s sprite sync at `-450`                                  |
 *
 * Both iterate the service's live list rather than `world.components(ParticleSystem2D)` so the
 * order is attach order and a system detached this frame is already gone.
 */

/**
 * Where the update system sits in `Update`: the same place `@ignifx/particles` puts its own.
 *
 * @public
 */
export const PARTICLE_2D_UPDATE_ORDER = 900;

/**
 * Where the write system sits in `PreRender`: before `@ignifx/2d`'s sprite sync (`-450`).
 *
 * @public
 */
export const PARTICLE_2D_WRITE_ORDER = -460;

/** The counter indices, resolved once. */
interface CounterIndices {
  readonly systems: number;
  readonly alive: number;
  readonly emitted: number;
  readonly sprites: number;
}

/**
 * Advances every system's emitter core by the frame's scaled delta, or by nothing while the app is
 * paused.
 *
 * @internal
 */
export class Particle2DUpdateSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/particles-2d-update";

  readonly #service: Particles2DService;

  /**
   * Creates the system.
   *
   * @param service - The service whose list it walks.
   */
  constructor(service: Particles2DService) {
    this.#service = service;
  }

  /**
   * Runs emission for one frame.
   *
   * @param ctx - The world, the clock, the phase, and the frame delta.
   */
  update(ctx: SystemContext): void {
    const dt = ctx.time.paused ? 0 : ctx.dt;
    const systems = this.#service.systems;
    for (let index = 0; index < systems.length; index += 1) {
      systems[index]?.tick(dt);
    }
  }
}

/**
 * Writes every system's live particles into its sprite batch and publishes the `particles-2d`
 * counters.
 *
 * @internal
 */
export class Particle2DWriteSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/particles-2d-write";

  readonly #service: Particles2DService;

  #indices: CounterIndices | null = null;

  /**
   * Creates the system.
   *
   * @param service - The service whose list it walks.
   */
  constructor(service: Particles2DService) {
    this.#service = service;
  }

  /**
   * Runs the write for one frame.
   *
   * @param ctx - The world, the clock, the phase, and the frame delta.
   */
  update(ctx: SystemContext): void {
    void ctx;
    const service = this.#service;
    const systems = service.systems;
    let alive = 0;
    let emitted = 0;
    let sprites = 0;
    for (let index = 0; index < systems.length; index += 1) {
      const system = systems[index];
      if (system === undefined) {
        continue;
      }
      system.write();
      alive += system.aliveCount;
      emitted += system.emittedThisFrame;
      sprites += system.spriteCount;
    }
    const counters = service.counters;
    if (counters === null) {
      return;
    }
    let indices = this.#indices;
    if (indices === null) {
      indices = {
        systems: counters.index("systems"),
        alive: counters.index("alive"),
        emitted: counters.index("emitted"),
        sprites: counters.index("sprites"),
      };
      this.#indices = indices;
    }
    counters.set(indices.systems, systems.length);
    counters.set(indices.alive, alive);
    counters.set(indices.emitted, emitted);
    counters.set(indices.sprites, sprites);
  }
}
