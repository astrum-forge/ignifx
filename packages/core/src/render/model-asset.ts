import { instantiateContainer, removeContainerFromScene, takeAnimationGroups } from "../lite/gpu/gltf.js";
import type { LiteAnimationGroup, LiteAssetContainer, LiteSkeleton, ModelInstance } from "../lite/gpu/gltf.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { LiteScene } from "../lite/scene.js";

/**
 * `ModelAsset` (`docs/architecture/05-assets-and-loading.md` §5 and §6,
 * `07-rendering.md` §2.4): the loaded glTF container a `Model` component instantiates.
 *
 * ## The container is a template, not a scene member
 *
 * `loadGltf` resolves to an `AssetContainer` whose `entities` is `[rootTransformNode]`
 * (`index.d.ts` 653). ignifx never adds that container to a scene. Each `Model` clones it instead
 * (`cloneTransformNode`), which deep-copies the transform hierarchy while every mesh shares the
 * original's GPU buffers under a reference count — so ten instances of a model upload one copy of
 * the geometry (`src/lite/gpu/gltf.ts`). Keeping the container out of the scene is also what makes
 * the first instance cost the same as the tenth, and what lets the asset outlive any one of them.
 *
 * ## Animation groups are taken, not ticked
 *
 * `addToScene` would register a container's `animationGroups` with Lite's own animation manager and
 * install a before-render hook for them. ADR-0003 says ignifx owns every clock, so the loader
 * removes them from the container the moment it is loaded and the asset keeps them
 * ({@link ModelAsset.animations}). Core exposes them and advances nothing; `@ignifx/3d`'s
 * `Animator` is what plays them.
 *
 * ## Instance counting
 *
 * Instances are counted so the template's GPU resources live until the last instance and the asset
 * handle are gone (`05-assets-and-loading.md` §6). {@link ModelAsset.retainInstance} and
 * {@link ModelAsset.releaseInstance} are that counter; `Model` calls them, and
 * {@link ModelAsset.instanceCount} is what a test asserts on.
 *
 * ## Headless
 *
 * `loadGltf` throws a `TypeError` under the null engine — it reaches for `engine._device` while
 * uploading (ADR-0002 Validation) — so a headless load skips it entirely and produces an asset with
 * `lite.container === null`. A `Model` that holds one keeps its fields, reports an empty `nodes`
 * map, and touches no scene (`07-rendering.md` §6).
 */

/**
 * The asset type models are registered under.
 *
 * @public
 */
export const MODEL_ASSET_TYPE = "model";

/**
 * The address suffixes that select the model loader.
 *
 * @public
 */
export const MODEL_FILE_EXTENSIONS: readonly string[] = Object.freeze([".glb", ".gltf"]);

/**
 * The Babylon Lite objects a {@link ModelAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface ModelAssetLiteHandles {
  /** The template container, or `null` under a headless app. */
  readonly container: LiteAssetContainer | null;
}

/**
 * One instantiated copy of a model, as a `Model` component holds it.
 *
 * @public
 */
export interface ModelInstantiation {
  /** The cloned container root, parented under the entity's node. */
  readonly root: LiteSceneNode;
  /** Every named node in the clone, keyed by its glTF node name. */
  readonly nodes: ReadonlyMap<string, LiteSceneNode>;
}

/**
 * A loaded glTF or GLB file (`docs/architecture/05-assets-and-loading.md` §5).
 *
 * @example
 * ```ts
 * const hero = await app.assets.loadAsync<ModelAsset>("models/hero.glb");
 * hero.value.animations.map((clip) => clip.name);
 * ```
 *
 * @public
 */
export class ModelAsset {
  /** The type name the asset service registers models under. */
  static assetType: string = MODEL_ASSET_TYPE;

  /** The address the model was loaded from. */
  readonly address: string;

  /**
   * The clips the file declared, stripped from the container so Lite never ticks them.
   *
   * @remarks
   * Unstable: these are Lite's own animation groups, handed on to `@ignifx/3d`'s `Animator`, and
   * they are excluded from the stability guarantees of `CONSTITUTION.md` Article IV. To core they
   * are read-only metadata: nothing here advances or re-binds them.
   *
   * @beta
   */
  readonly animations: readonly LiteAnimationGroup[];

  /**
   * The skeletons the file declared. Empty unless the `boneControl` rendering feature was on before
   * the load, because Lite builds them only then (`index.d.ts` 653).
   *
   * @beta
   */
  readonly skeletons: readonly LiteSkeleton[];

  readonly #scene: LiteScene | null;

  #container: LiteAssetContainer | null;

  #instances = 0;

  /**
   * Wraps a loaded container. The `model` loader constructs these.
   *
   * @param address - The address it was loaded from.
   * @param container - The template container, or `null` when the app is headless.
   * @param animations - The clips taken off the container.
   * @param skeletons - The skeletons the loader found.
   * @param scene - The scene the container is released through, or `null` when headless.
   *
   * @internal
   */
  constructor(
    address: string,
    container: LiteAssetContainer | null,
    animations: readonly LiteAnimationGroup[],
    skeletons: readonly LiteSkeleton[],
    scene: LiteScene | null,
  ) {
    this.address = address;
    this.#container = container;
    this.animations = animations;
    this.skeletons = skeletons;
    this.#scene = scene;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch.
   *
   * @returns The template container, or `null` under a headless app.
   */
  get lite(): ModelAssetLiteHandles {
    return { container: this.#container };
  }

  /**
   * How many `Model` components currently hold a copy of this template.
   *
   * @returns The live instance count.
   */
  get instanceCount(): number {
    return this.#instances;
  }

  /**
   * Clones the template under an entity's node.
   *
   * @param parent - The entity's transform node, or `null` for world space.
   * @returns The cloned root and its named nodes, or `null` when there is nothing to clone — a
   * headless app, or a file that declared only lights.
   */
  instantiate(parent: LiteSceneNode | null): ModelInstantiation | null {
    const container = this.#container;
    if (container === null) {
      return null;
    }
    const instance: ModelInstance | null = instantiateContainer(container, parent);
    if (instance === null) {
      return null;
    }
    return { root: instance.root, nodes: instance.nodesByName };
  }

  /** Records that one more `Model` holds a copy. */
  retainInstance(): void {
    this.#instances += 1;
  }

  /** Records that one fewer `Model` holds a copy. Releasing below zero is a no-op. */
  releaseInstance(): void {
    if (this.#instances > 0) {
      this.#instances -= 1;
    }
  }

  /**
   * Releases the template's GPU resources.
   *
   * @remarks
   * The container was never added to a scene, so the round trip `removeFromScene` needs is the same
   * one `MeshAsset.dispose` performs: this hands it to the scene and takes it straight back out,
   * which drops its share of every buffer. Clones still in a scene keep theirs. Calling it twice is
   * a no-op, and it is a no-op under a headless app.
   */
  dispose(): void {
    const container = this.#container;
    const scene = this.#scene;
    this.#container = null;
    if (container !== null && scene !== null) {
      removeContainerFromScene(scene, container);
    }
  }

  /** Releases the template when the asset leaves a `using` block. */
  [Symbol.dispose](): void {
    this.dispose();
  }
}

/**
 * Strips a freshly loaded container's clips and skeletons and wraps it as an asset.
 *
 * @param address - The address it was loaded from.
 * @param container - The container, or `null` when the app is headless.
 * @param scene - The scene the container is released through, or `null` when headless.
 * @returns The asset.
 *
 * @internal
 */
export function createModelAsset(
  address: string,
  container: LiteAssetContainer | null,
  scene: LiteScene | null,
): ModelAsset {
  if (container === null) {
    return new ModelAsset(address, null, [], [], null);
  }
  const animations = takeAnimationGroups(container);
  const skeletons = container.skeletons ?? [];
  return new ModelAsset(address, container, animations, skeletons, scene);
}
