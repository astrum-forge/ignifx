import type { LightProbeRuntime } from "./light-probes.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { LightProbeVolume } from "../light-probe-volume.js";

/**
 * The renderer's handle on light probes (GI B2): it loads the light-probe chunk (`./light-probes.ts`)
 * the first frame a world has a `LightProbeVolume` and forwards every frame to it. Device-only, like
 * the rest of `src/render/gpu/`: a headless renderer never creates one.
 *
 * @internal
 */
export class LightProbeHost {
  readonly #engine: LiteEngine;

  readonly #scene: LiteScene;

  readonly #onError: (error: unknown) => void;

  #runtime: LightProbeRuntime | null = null;

  #isLoading = false;

  #isDisposed = false;

  /**
   * Creates the host; nothing loads until a volume exists.
   *
   * @param engine - The engine.
   * @param scene - The registered render scene.
   * @param onError - Where a failed chunk load goes.
   */
  constructor(engine: LiteEngine, scene: LiteScene, onError: (error: unknown) => void) {
    this.#engine = engine;
    this.#scene = scene;
    this.#onError = onError;
  }

  /**
   * Whether the chunk is loaded and a grid lights the scene.
   *
   * @returns `true` while a volume's grid is applied to the materials.
   */
  get isLighting(): boolean {
    return this.#runtime?.isLighting === true;
  }

  /**
   * Runs one frame of light-probe work, loading the chunk first when a volume exists.
   *
   * @param volumes - Every `LightProbeVolume` in the world.
   */
  update(volumes: readonly LightProbeVolume[]): void {
    if (this.#runtime !== null) {
      this.#runtime.update(volumes);
      return;
    }
    if (volumes.length === 0 || this.#isLoading || this.#isDisposed) {
      return;
    }
    this.#isLoading = true;
    import("./light-probes.js")
      .then((module) => module.createLightProbeRuntime(this.#engine, this.#scene))
      .then((created) => {
        if (this.#isDisposed) {
          created.dispose();
          return;
        }
        this.#runtime = created;
      })
      .catch(this.#onError);
  }

  /** Takes the grid off every material and frees it. Idempotent. */
  dispose(): void {
    this.#isDisposed = true;
    this.#runtime?.dispose();
    this.#runtime = null;
  }
}
