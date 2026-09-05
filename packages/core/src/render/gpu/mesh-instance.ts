import {
  addMeshToScene,
  cloneMeshUnderNode,
  removeMeshFromScene,
  setMeshId,
  setMeshMaterial,
  setMeshPickable,
  setMeshReceiveShadows,
  setMeshRenderOrder,
  setMeshSubtreeVisible,
} from "../../lite/gpu/mesh.js";
import { tagNode } from "../../lite/node.js";
import type { LiteMesh } from "../../lite/gpu/mesh.js";
import type { LiteMaterial } from "../../lite/material.js";
import type { LiteSceneNode, NodeTag } from "../../lite/node.js";
import type { LiteScene } from "../../lite/scene.js";

/**
 * One `MeshRenderer`'s clone of a `MeshAsset` template, and everything writing to it
 * (`docs/architecture/07-rendering.md` §2.3).
 *
 * Every line here needs a WebGPU device: a clone only exists when the template does, and a template
 * only exists when the engine uploaded its buffers. That is why the module lives under
 * `src/render/gpu/`, the render layer's half of the rule R1 established for `src/lite/gpu/`: the
 * root Vitest coverage config excludes both, and the browser project is what measures them.
 *
 * The per-field "did it change" cache lives here rather than on the component for the same reason.
 * It is only consulted when there is something to write to, so leaving it on the component would
 * put a dozen branches no unit test can reach in a file unit tests otherwise cover completely.
 */

/**
 * A live clone in a scene.
 *
 * @internal
 */
export class MeshInstance {
  /** The cloned subtree root, parented under the entity's node. */
  readonly clone: LiteSceneNode;

  #material: LiteMaterial | null = null;

  #receiveShadows: boolean | null = null;

  #renderOrder = Number.NaN;

  #pickable: boolean | null = null;

  #visible = false;

  /**
   * Clones a template under an entity's node, tags it, and adds it to the scene.
   *
   * @param scene - The render scene.
   * @param template - The `MeshAsset`'s template mesh.
   * @param parent - The entity's transform node.
   * @param tag - The owning entity and component, for picking.
   * @param meshId - The string id Lite's light include/exclude sets match on.
   * @param material - The material to draw with. It is assigned **before** the mesh joins the
   * scene: `addToScene` buckets a mesh by its material's build group, and a mesh that arrives
   * without one takes a path that leaves the scene's render pass presenting nothing at all
   * (measured on SwiftShader, 2026-09-05).
   */
  constructor(
    scene: LiteScene,
    template: LiteMesh,
    parent: LiteSceneNode,
    tag: NodeTag,
    meshId: string,
    material: LiteMaterial,
  ) {
    const clone = cloneMeshUnderNode(template, parent);
    tagNode(clone, tag);
    const mesh = asMesh(clone);
    setMeshId(mesh, meshId);
    setMeshMaterial(mesh, material);
    this.#material = material;
    // A fresh clone is visible until the first `applyVisible`; starting it hidden means a renderer
    // on an inactive entity never flashes for one frame.
    setMeshSubtreeVisible(clone, false);
    addMeshToScene(scene, clone);
    this.clone = clone;
  }

  /**
   * Whether the clone is currently drawn.
   *
   * @returns `true` when Lite's `visible` is set on the subtree.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * The clone as a mesh, for the shadow caster list.
   *
   * @returns The clone.
   */
  get mesh(): LiteMesh {
    return asMesh(this.clone);
  }

  /**
   * Assigns the material, when it changed.
   *
   * @param material - The Lite material to draw with.
   */
  applyMaterial(material: LiteMaterial): void {
    if (material === this.#material) {
      return;
    }
    this.#material = material;
    setMeshMaterial(this.mesh, material);
  }

  /**
   * Writes the per-mesh flags that changed.
   *
   * @param receiveShadows - Whether shadow maps darken the mesh.
   * @param renderOrder - The sort key within its phase.
   * @param pickable - Whether picking considers the mesh at all.
   */
  applyFlags(receiveShadows: boolean, renderOrder: number, pickable: boolean): void {
    const mesh = this.mesh;
    if (this.#receiveShadows !== receiveShadows) {
      this.#receiveShadows = receiveShadows;
      setMeshReceiveShadows(mesh, receiveShadows);
    }
    if (this.#renderOrder !== renderOrder) {
      this.#renderOrder = renderOrder;
      setMeshRenderOrder(mesh, renderOrder);
    }
    if (this.#pickable !== pickable) {
      this.#pickable = pickable;
      setMeshPickable(mesh, pickable);
    }
  }

  /**
   * Shows or hides the clone, when the state changed.
   *
   * @param visible - `entity.activeInHierarchy && component.enabled`.
   */
  applyVisible(visible: boolean): void {
    if (visible === this.#visible) {
      return;
    }
    this.#visible = visible;
    setMeshSubtreeVisible(this.clone, visible);
  }

  /**
   * Removes the clone from the scene, releasing its share of the template's buffers.
   *
   * @param scene - The render scene.
   */
  destroy(scene: LiteScene): void {
    removeMeshFromScene(scene, this.clone);
  }
}

/**
 * Narrows a cloned subtree root to a mesh.
 *
 * @remarks
 * `cloneTransformNode` is typed as returning the wider `SceneNode` because it also clones plain
 * transform nodes; the clone of a mesh is a mesh (coding standards §5.2).
 *
 * @param node - The clone.
 * @returns The same object, typed as a mesh.
 */
function asMesh(node: LiteSceneNode): LiteMesh {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the note above.
  return node as LiteMesh;
}
