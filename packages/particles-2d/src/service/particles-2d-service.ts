import type { ParticleSystem2D } from "../component/particle-system-2d.js";
import type { SpriteBatch, SpriteBatchOptions, TwoDService } from "@ignifx/2d";
import type { DiagnosticsGroup, Vec3Like } from "@ignifx/core";
import type { ParticlesService } from "@ignifx/particles";

/**
 * What the two frame systems walk, and the one place 2D particles meet the shared budget
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §4.3).
 *
 * It owns no budget: `maxParticles`, `qualityScale` and `gravity` all live on `app.particles`, so
 * both dimensions draw from one pool. Only the counters are separate, because
 * `@ignifx/particles`' render system overwrites the `particles` group every frame with its own
 * totals.
 */

/**
 * The diagnostics group name.
 *
 * @public
 */
export const PARTICLES_2D_DIAGNOSTICS_GROUP = "particles-2d";

/**
 * The counters the group carries, in index order.
 *
 * @public
 */
export const PARTICLES_2D_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "systems",
  "alive",
  "emitted",
  "sprites",
]);

/**
 * The 2D particles service: the live system list, the shared budget, and the counters.
 *
 * @example
 * ```ts
 * app.particles.qualityScale = 0.5; // halves emission for 2D and 3D systems alike
 * ```
 *
 * @public
 */
export class Particles2DService {
  /** The 3D particles service every capacity reservation goes through. */
  readonly particles: ParticlesService;

  readonly #twoD: TwoDService;

  readonly #sortingLayers: readonly string[];

  readonly #systems: ParticleSystem2D[] = [];

  #counters: DiagnosticsGroup | null = null;

  /**
   * Creates the service.
   *
   * @param particles - The shared budget, from `ctx.require(ParticlesService)`.
   * @param twoD - The sprite-layer service batches are claimed from.
   * @param sortingLayers - The project's declared sorting layers, for `IGX-1756`.
   */
  constructor(particles: ParticlesService, twoD: TwoDService, sortingLayers: readonly string[]) {
    this.particles = particles;
    this.#twoD = twoD;
    this.#sortingLayers = sortingLayers;
  }

  /**
   * Every attached `ParticleSystem2D`, in attach order.
   *
   * @returns The live list; iterate it without copying.
   */
  get systems(): readonly ParticleSystem2D[] {
    return this.#systems;
  }

  /**
   * The `particles-2d` diagnostics group, once the extension registered it.
   *
   * @returns The group, or `null` before registration.
   */
  get counters(): DiagnosticsGroup | null {
    return this.#counters;
  }

  /**
   * The `0`–`1` emission multiplier `app.particles` holds.
   *
   * @returns The multiplier.
   */
  get qualityScale(): number {
    return this.particles.qualityScale;
  }

  /**
   * The world gravity a definition's `gravityMultiplier` scales, in metres per second squared.
   *
   * @returns `app.particles.gravity`.
   */
  get gravity(): Vec3Like {
    return this.particles.gravity;
  }

  /**
   * Installs the counters group the extension registered.
   *
   * @param group - The group.
   *
   * @internal
   */
  setCounters(group: DiagnosticsGroup): void {
    this.#counters = group;
  }

  /**
   * Adds a system to the live list.
   *
   * @param system - The system.
   *
   * @internal
   */
  attach(system: ParticleSystem2D): void {
    if (!this.#systems.includes(system)) {
      this.#systems.push(system);
    }
  }

  /**
   * Removes a system from the live list.
   *
   * @param system - The system.
   *
   * @internal
   */
  detach(system: ParticleSystem2D): void {
    const index = this.#systems.indexOf(system);
    if (index >= 0) {
      this.#systems.splice(index, 1);
    }
  }

  /**
   * Whether the project declares a sorting layer.
   *
   * @param name - The layer name.
   * @returns `true` when a batch may be placed on it.
   *
   * @internal
   */
  hasSortingLayer(name: string): boolean {
    return this.#sortingLayers.includes(name);
  }

  /**
   * Claims a batch of sprite slots.
   *
   * @param options - The atlas, the capacity, the sorting layer, and the blend.
   * @returns The batch.
   *
   * @internal
   */
  createBatch(options: SpriteBatchOptions): SpriteBatch {
    return this.#twoD.createSpriteBatch(options);
  }

  /** Forgets every attached system. The extension calls it on dispose. */
  dispose(): void {
    this.#systems.length = 0;
  }
}
