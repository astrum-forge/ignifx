import type { ParticlesService } from "../service/particles-service.js";
import type { System, SystemContext } from "@ignifx/core";

// The two frame systems that drive every `ParticleSystem`
// (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3). Both walk the service's live list rather
// than the world's components, so the order is attach order and a detached system is already gone.

/** The counter indices, resolved once. */
interface CounterIndices {
  readonly systems: number;
  readonly alive: number;
  readonly emitted: number;
  readonly uploadBytes: number;
  readonly drawCalls: number;
}

/**
 * Advances every system's emitter core by the frame's scaled delta, or by nothing while the app is
 * paused. Runs late in `Update` so a script's `emit()` is drawn in the same frame.
 *
 * @beta
 */
export class ParticleUpdateSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/particles-update";

  readonly #service: ParticlesService;

  /**
   * Creates the system.
   *
   * @param service - The service whose list it walks.
   */
  constructor(service: ParticlesService) {
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
 * Uploads every system's new records, writes its uniforms, bounds its draw count, and publishes the
 * `particles` counters. Runs in `PreRender` before core's render sync.
 *
 * @beta
 */
export class ParticleRenderSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name: string = "ignifx/particles-render";

  readonly #service: ParticlesService;

  #indices: CounterIndices | null = null;

  /**
   * Creates the system.
   *
   * @param service - The service whose list it walks.
   */
  constructor(service: ParticlesService) {
    this.#service = service;
  }

  /** Runs the upload for one frame. */
  update(): void {
    const service = this.#service;
    const systems = service.systems;
    let alive = 0;
    let emitted = 0;
    let uploadBytes = 0;
    let drawCalls = 0;
    for (let index = 0; index < systems.length; index += 1) {
      const system = systems[index];
      if (system === undefined) {
        continue;
      }
      system.sync();
      alive += system.aliveCount;
      emitted += system.emittedThisFrame;
      uploadBytes += system.uploadedBytes;
      if (system.drawCount > 0 && system.renderer !== null && system.renderer.isVisible) {
        drawCalls += 1;
      }
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
        uploadBytes: counters.index("uploadBytes"),
        drawCalls: counters.index("drawCalls"),
      };
      this.#indices = indices;
    }
    counters.set(indices.systems, systems.length);
    counters.set(indices.alive, alive);
    counters.set(indices.emitted, emitted);
    counters.set(indices.uploadBytes, uploadBytes);
    counters.set(indices.drawCalls, drawCalls);
  }
}
