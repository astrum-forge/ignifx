import type { ReflectionProbeRuntime } from "./reflection-probes.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { World } from "../../world/world.js";
import type { ReflectionProbe } from "../reflection-probe.js";

/**
 * The renderer's handle on reflection probes (GI B1): it loads the probe chunk
 * (`./reflection-probes.ts`) the first frame a world has a probe and forwards every frame to it.
 * Device-only, like the rest of `src/render/gpu/`: a headless renderer never creates one.
 *
 * @internal
 */
export class ReflectionProbeHost {
  readonly #engine: LiteEngine;

  readonly #scene: LiteScene;

  readonly #onError: (error: unknown) => void;

  #runtime: ReflectionProbeRuntime | null = null;

  #isLoading = false;

  #isDisposed = false;

  /**
   * Creates the host; nothing loads until a probe exists.
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
   * Whether the chunk is loaded and running.
   *
   * @returns `true` once a probe has loaded it.
   */
  get isActive(): boolean {
    return this.#runtime !== null;
  }

  /**
   * Runs one frame of probe work, loading the chunk first when a probe exists.
   *
   * @param world - The world.
   * @param probes - Every `ReflectionProbe` in it.
   * @param isHdr - Whether `rendering.hdr` is on.
   */
  update(world: World, probes: readonly ReflectionProbe[], isHdr: boolean): void {
    if (this.#runtime !== null) {
      this.#runtime.update(world, probes, isHdr);
      return;
    }
    if (probes.length === 0 || this.#isLoading || this.#isDisposed) {
      return;
    }
    this.#isLoading = true;
    import("./reflection-probes.js")
      .then(async (module) => module.createReflectionProbeRuntime(this.#engine, this.#scene))
      .then((created) => {
        if (this.#isDisposed) {
          created.dispose();
          return;
        }
        this.#runtime = created;
      })
      .catch(this.#onError);
  }

  /** Frees every probe. Idempotent. */
  dispose(): void {
    this.#isDisposed = true;
    this.#runtime?.dispose();
    this.#runtime = null;
  }
}
