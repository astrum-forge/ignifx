import type { ReflectionProbeRuntime } from "./reflection-probes.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type { World } from "../../world/world.js";
import type { ReflectionProbe } from "../reflection-probe.js";
import type { RenderingQualityPreset } from "../rendering-settings.js";

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

  readonly #warn: (message: string, entityName: string) => void;

  #runtime: ReflectionProbeRuntime | null = null;

  #isLoading = false;

  #isDisposed = false;

  /**
   * Creates the host; nothing loads until a probe exists.
   *
   * @param engine - The engine.
   * @param scene - The registered render scene.
   * @param onError - Where a failed chunk load goes.
   * @param warn - Where a probe's warning goes: a message with an `{entity}` slot, and the name.
   */
  constructor(
    engine: LiteEngine,
    scene: LiteScene,
    onError: (error: unknown) => void,
    warn: (message: string, entityName: string) => void,
  ) {
    this.#engine = engine;
    this.#scene = scene;
    this.#onError = onError;
    this.#warn = warn;
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
   * @param tier - The `rendering.quality` preset; `null` for `"custom"`.
   */
  update(world: World, probes: readonly ReflectionProbe[], isHdr: boolean, tier: RenderingQualityPreset | null): void {
    if (this.#runtime !== null) {
      this.#runtime.update(world, probes, isHdr, tier);
      return;
    }
    if (probes.length === 0 || this.#isLoading || this.#isDisposed) {
      return;
    }
    this.#isLoading = true;
    import("./reflection-probes.js")
      .then(async (module) => module.createReflectionProbeRuntime(this.#engine, this.#scene, this.#warn))
      .then((created) => {
        if (this.#isDisposed) {
          created.dispose();
          return;
        }
        this.#runtime = created;
      })
      .catch(this.#onError);
  }

  /**
   * Drops the probes' GPU state when the device is lost (`app.events.onDeviceLost`), before Lite's
   * recovery rebuilds the materials; they capture again once frames resume.
   */
  handleDeviceLost(): void {
    this.#runtime?.handleDeviceLost();
  }

  /** Frees every probe. Idempotent. */
  dispose(): void {
    this.#isDisposed = true;
    this.#runtime?.dispose();
    this.#runtime = null;
  }
}
