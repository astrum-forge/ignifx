import {
  addMeshToScene,
  collectSubtreeMeshes,
  overrideSubtreeMaterials,
  removeMeshFromScene,
  setMeshReceiveShadows,
  setMeshSubtreeVisible,
} from "../../lite/gpu/mesh.js";
import { tagNode } from "../../lite/node.js";
import type { LiteMesh } from "../../lite/gpu/mesh.js";
import type { LiteMaterial } from "../../lite/material.js";
import type { LiteSceneNode, NodeTag } from "../../lite/node.js";
import type { LiteScene } from "../../lite/scene.js";
import type { ModelAsset, ModelInstantiation } from "../model-asset.js";

/**
 * One `Model`'s instantiated copy of a `ModelAsset`, and everything writing to it
 * (`docs/architecture/07-rendering.md` §2.4).
 *
 * Device-only, for the same reason as `./mesh-instance.ts`: an instance only exists when the
 * container does, and a container only exists when `loadGltf` uploaded it. The root Vitest coverage
 * config excludes `src/render/gpu/**`; the browser project measures it.
 */

/**
 * A live instantiated model subtree in a scene.
 *
 * @internal
 */
export class ModelInstance {
  /** The cloned container root, parented under the entity's node. */
  readonly root: LiteSceneNode;

  /** Every named node in the clone, keyed by its glTF node name. */
  readonly nodes: ReadonlyMap<string, LiteSceneNode>;

  /**
   * Every mesh in the clone, collected once at instantiation.
   *
   * @remarks
   * It is the shadow-caster contribution of the whole model and the list `receiveShadows` is
   * written across. Collected here rather than per frame because the clone tree's shape is fixed
   * the moment `instantiateContainer` built it (coding standards §7).
   */
  readonly meshes: readonly LiteMesh[];

  readonly #asset: ModelAsset;

  #visible = false;

  #receiveShadows: boolean | null = null;

  #overrideCount = -1;

  /**
   * Wraps a freshly instantiated subtree, tags it, and adds it to the scene.
   *
   * @param scene - The render scene.
   * @param asset - The template the subtree was cloned from; its instance count is bumped.
   * @param instantiation - What the asset's `instantiate` produced.
   * @param tag - The owning entity and component, for picking.
   */
  constructor(scene: LiteScene, asset: ModelAsset, instantiation: ModelInstantiation, tag: NodeTag) {
    this.root = instantiation.root;
    this.nodes = instantiation.nodes;
    const meshes: LiteMesh[] = [];
    collectSubtreeMeshes(instantiation.root, meshes);
    this.meshes = meshes;
    this.#asset = asset;
    asset.retainInstance();
    tagNode(instantiation.root, tag);
    setMeshSubtreeVisible(instantiation.root, false);
    addMeshToScene(scene, instantiation.root);
  }

  /**
   * Whether the subtree is currently drawn.
   *
   * @returns `true` when Lite's `visible` is set on it.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * Shows or hides the subtree, when the state changed.
   *
   * @param visible - `entity.activeInHierarchy && component.enabled`.
   */
  applyVisible(visible: boolean): void {
    if (visible === this.#visible) {
      return;
    }
    this.#visible = visible;
    setMeshSubtreeVisible(this.root, visible);
  }

  /**
   * Appends every mesh of the subtree to a shadow caster list, when the subtree is drawn.
   *
   * @remarks
   * A hidden model casts nothing, exactly as a hidden `MeshRenderer` does: `visible` is what
   * `entity.activeInHierarchy && component.enabled` is materialised onto, and a shadow from an
   * object that is not there would be a bug the player can see.
   *
   * @param out - The caster list being built.
   */
  collectCasters(out: LiteMesh[]): void {
    if (!this.#visible) {
      return;
    }
    const meshes = this.meshes;
    for (let index = 0; index < meshes.length; index += 1) {
      const mesh = meshes[index];
      if (mesh !== undefined) {
        out.push(mesh);
      }
    }
  }

  /**
   * Writes the receive-shadows flag across every mesh in the subtree, when it changed.
   *
   * @remarks
   * The same flag `MeshRenderer` writes onto its single clone (`src/render/gpu/mesh-instance.ts`),
   * fanned out over the instantiated tree: Lite reads `receiveShadows` per mesh
   * (`index.d.ts` 7160), so a model is a receiver only when each of its meshes is.
   *
   * @param receiveShadows - Whether shadow maps darken the instance.
   */
  applyReceiveShadows(receiveShadows: boolean): void {
    if (receiveShadows === this.#receiveShadows) {
      return;
    }
    this.#receiveShadows = receiveShadows;
    const meshes = this.meshes;
    for (let index = 0; index < meshes.length; index += 1) {
      const mesh = meshes[index];
      if (mesh !== undefined) {
        setMeshReceiveShadows(mesh, receiveShadows);
      }
    }
  }

  /**
   * Re-materials the subtree when the override map changed size.
   *
   * @remarks
   * Size is the change signal because the map is short, inspector-edited data and walking the
   * subtree every frame to catch a same-size swap would cost more than the case is worth
   * (coding standards §7). Assigning a mesh the material it already has is a no-op in Lite, so a
   * rebuild after a real change is idempotent.
   *
   * @param overrides - Source glTF material name to replacement material.
   */
  applyOverrides(overrides: ReadonlyMap<string, LiteMaterial>): void {
    if (overrides.size === this.#overrideCount) {
      return;
    }
    this.#overrideCount = overrides.size;
    if (overrides.size > 0) {
      overrideSubtreeMaterials(this.root, overrides);
    }
  }

  /**
   * Removes the subtree from the scene and gives back its share of the template's buffers.
   *
   * @param scene - The render scene.
   */
  destroy(scene: LiteScene): void {
    this.#asset.releaseInstance();
    removeMeshFromScene(scene, this.root);
  }
}
