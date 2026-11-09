import { CoreErrorCode } from "../../errors/error-codes.js";
import { isIdentityLightmapPlacement } from "../lightmap-asset.js";
import type { LightmapRuntime } from "./lightmaps.js";
import type { App } from "../../app/types.js";
import type { LiteMaterial } from "../../lite/material.js";
import type { LiteScene } from "../../lite/scene.js";
import type { MaterialAsset } from "../material-asset.js";
import type { MeshRenderer } from "../mesh-renderer.js";

/**
 * The renderer's handle on lightmaps (GI B3): it decides whether a `MeshRenderer` samples its
 * lightmap, loads the lightmap chunk (`./lightmaps.ts`) the first time one does, and hands the
 * renderer its lightmapped material. Device-only, like the rest of `src/render/gpu/`: only a
 * renderer with a clone in the scene asks.
 *
 * @internal
 */
export class LightmapHost {
  readonly #app: App;

  readonly #scene: LiteScene;

  readonly #onError: (error: unknown) => void;

  #runtime: LightmapRuntime | null = null;

  #isLoading = false;

  #isDisposed = false;

  /** The last `IGX-0735` reason reported per renderer, so each is logged once. */
  readonly #reported = new WeakMap<MeshRenderer, string>();

  /**
   * Creates the host; nothing loads until a renderer samples a lightmap.
   *
   * @param app - The app, for the clones and the log.
   * @param scene - The registered render scene.
   * @param onError - Where a failed chunk load goes.
   */
  constructor(app: App, scene: LiteScene, onError: (error: unknown) => void) {
    this.#app = app;
    this.#scene = scene;
    this.#onError = onError;
  }

  /**
   * How many renderers draw with a lightmap right now.
   *
   * @returns The number of lightmapped clones.
   */
  get count(): number {
    return this.#runtime?.count ?? 0;
  }

  /**
   * The material a renderer draws with this frame.
   *
   * @remarks
   * A renderer samples its lightmap when its `lightmap.asset` is loaded, its entity is static and its
   * material is PBR; otherwise it draws with `base`, and a static or PBR mismatch logs `IGX-0735`
   * once. A placement other than the identity also logs `IGX-0735`, and the whole texture is used.
   *
   * @param owner - The renderer.
   * @param base - The material it declares (or the default material).
   * @returns The Lite material to draw with.
   */
  materialFor(owner: MeshRenderer, base: MaterialAsset): LiteMaterial {
    const settings = owner.lightmap;
    const handle = settings?.asset ?? null;
    const lightmap = handle !== null && handle.state === "loaded" ? handle.value : null;
    if (settings === null || lightmap === null || this.#isDisposed) {
      this.release(owner);
      return base.lite.material;
    }
    const entity = owner.entity;
    let problem: string | null = null;
    if (!entity.isStatic) {
      problem = "its entity is not static (entity.isStatic)";
    } else if (base.kind !== "pbr") {
      problem = `its material is a ${base.kind} material; lightmaps need a pbr one`;
    }
    if (problem !== null) {
      this.#report(owner, problem);
      this.release(owner);
      return base.lite.material;
    }
    if (!isIdentityLightmapPlacement(lightmap.placementOf(entity.uid))) {
      this.#report(
        owner,
        "its lightmap entry has a scale or offset, which is not applied yet; it samples the whole texture",
      );
    }
    const runtime = this.#runtime;
    if (runtime === null) {
      this.#load();
      return base.lite.material;
    }
    return runtime.materialFor(owner, base, lightmap, settings);
  }

  /**
   * Drops a renderer's lightmapped clone, if it has one.
   *
   * @param owner - The renderer.
   */
  release(owner: MeshRenderer): void {
    this.#runtime?.release(owner);
  }

  /** Rebuilds the clones made this frame; the renderer calls it after every `MeshRenderer` synced. */
  flush(): void {
    this.#runtime?.flush();
  }

  /** Drops every clone. Idempotent. */
  dispose(): void {
    this.#isDisposed = true;
    this.#runtime?.dispose();
    this.#runtime = null;
  }

  /** Loads the chunk once. */
  #load(): void {
    if (this.#isLoading || this.#isDisposed) {
      return;
    }
    this.#isLoading = true;
    import("./lightmaps.js")
      .then((module) => module.createLightmapRuntime(this.#app, this.#scene))
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
   * Logs `IGX-0735` for a renderer, once per distinct reason.
   *
   * @param owner - The renderer.
   * @param problem - Why its lightmap is not drawn as declared.
   */
  #report(owner: MeshRenderer, problem: string): void {
    if (this.#reported.get(owner) === problem) {
      return;
    }
    this.#reported.set(owner, problem);
    this.#app.log.warn(
      `${CoreErrorCode.lightmapNotApplied}: {entity}'s MeshRenderer lightmap: ${problem}.`,
      owner.entity.name,
    );
  }
}
