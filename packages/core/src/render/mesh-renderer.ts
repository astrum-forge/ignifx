import { Component } from "../component/component.js";
import { entityInternals } from "../entity/internals.js";
import { array, asset, bool, i32 } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { MeshInstance } from "./gpu/mesh-instance.js";
import { MaterialAsset } from "./material-asset.js";
import { MeshAsset } from "./mesh-asset.js";
import { rendererInternals } from "./renderer.js";
import type { RendererImpl } from "./renderer.js";
import type { AssetHandle } from "../assets/types.js";
import type { ComponentHooks } from "../component/component.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { LiteMaterial } from "../lite/material.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { Schema } from "../schema/types.js";

/**
 * The `MeshRenderer` component (`docs/architecture/07-rendering.md` §2.3): one clone of a
 * `MeshAsset`, drawn with a `MaterialAsset`.
 *
 * ## Cloning, not sharing
 *
 * The asset holds the template; the renderer holds a clone parented under the entity's node.
 * `cloneTransformNode` shallow-clones the mesh — fresh transform, **same** `_gpu` wrapper with its
 * reference count bumped — so a hundred renderers of one asset upload one set of vertex buffers
 * (ADR-0002 Validation). Removing the component calls `removeFromScene` on the clone, which is what
 * frees its share.
 *
 * ## Hiding is `visible`, never removal
 *
 * Lite disposes a mesh that leaves its last scene, so `enabled = false` must not remove anything.
 * `visible` is derived from `entity.activeInHierarchy && component.enabled` and written on the
 * clone's subtree; the mesh stays in the scene, keeps its buffers, and comes back the moment the
 * flag flips. That is `07-rendering.md` §2.3's rule, and the browser test asserts both halves: the
 * pixel returns to the clear colour, and the mesh is still in the scene.
 *
 * ## Decisions the documents left open
 *
 * - **The clone's Lite `id` is the entity's uid.** Lite's light include/exclude lists match on
 *   `Mesh.id` strings (`lib/render/lights-ubo.js`), and §2.2 maps `Light.includeOnly` onto them
 *   from *entity* references. The uid is the one identifier both sides can name.
 * - **`materials` beyond the first is accepted and ignored in Phase 2.** §2.3 says "one per
 *   submesh", but Lite's `Mesh.material` is a single value and Lite has no submesh material list in
 *   1.27.0. The field keeps its array shape so files do not have to change when submeshes land; the
 *   renderer uses index 0, or the default material when the array is empty.
 *
 * ## Headless
 *
 * A headless `MeshAsset` carries no geometry, so there is nothing to clone: the component keeps its
 * fields, reports `lite.mesh === null`, and touches no scene (`07-rendering.md` §6).
 */

/**
 * Draws a mesh asset with a material (`docs/architecture/07-rendering.md` §2.3).
 *
 * @example
 * ```ts
 * using box = MeshAsset.box(app, { size: 1 });
 * const cube = world.createEntity("Cube");
 * cube.addComponent(MeshRenderer, { mesh: box.retain(), castShadows: true });
 * ```
 *
 * @public
 */
export class MeshRenderer extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/MeshRenderer";

  /** Several renderers on one entity draw several meshes from one transform, which is useful. */
  static allowMultiple = true;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = meshRendererSchema();

  declare mesh: AssetHandle<MeshAsset> | null;

  declare materials: (AssetHandle<MaterialAsset> | null)[];

  declare castShadows: boolean;

  declare receiveShadows: boolean;

  declare renderOrder: number;

  declare pickable: boolean;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(MeshRenderer.schema));
  }

  #instance: MeshInstance | null = null;

  #appliedMesh: MeshAsset | null = null;

  #appliedCastShadows = true;

  /**
   * The Babylon Lite mesh this renderer draws. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The clone, or `null` when there is nothing to draw.
   */
  get lite(): { readonly mesh: LiteSceneNode | null } {
    return { mesh: this.#instance?.clone ?? null };
  }

  /**
   * Whether the mesh is currently drawn: its own `enabled` flag and its entity's
   * `activeInHierarchy`, materialised onto Lite's `visible`.
   *
   * @returns `true` when the clone is visible.
   */
  get isVisible(): boolean {
    return this.#instance?.isVisible === true;
  }

  /** Nothing to do at attach: the clone is built on the first sync, once `mesh` has been decoded. */
  onAttach(): void {
    this.#appliedMesh = null;
  }

  /** Removes the clone from the scene, releasing its share of the template's buffers. */
  onDetach(): void {
    this.#releaseClone(rendererInternals(this.app.renderer));
  }

  /**
   * Rebuilds the clone when `mesh` changed, then writes every other field that changed. The
   * `PreRender` system calls it.
   *
   * @param renderer - The rendering service, for the scene and the default material.
   * @returns `true` when the scene's renderable set changed, which the system coalesces into one
   * `rebuildSceneRenderables`.
   *
   * @internal
   */
  sync(renderer: RendererImpl): boolean {
    const changed = this.#ensureClone(renderer);
    const instance = this.#instance;
    if (instance === null) {
      return changed;
    }
    instance.applyMaterial(this.#material(renderer));
    instance.applyFlags(this.receiveShadows, this.renderOrder, this.pickable);
    instance.applyVisible(this.isEnabledInHierarchy);
    return changed;
  }

  /**
   * Appends this renderer's mesh to a shadow caster list, when it casts.
   *
   * @param out - The caster list being built.
   *
   * @internal
   */
  collectCasters(out: LiteMesh[]): void {
    const instance = this.#instance;
    if (instance !== null && this.castShadows && instance.isVisible) {
      out.push(instance.mesh);
    }
  }

  /**
   * Whether the caster contribution of this renderer changed since the last frame.
   *
   * @returns `true` when `castShadows` or visibility moved.
   *
   * @internal
   */
  consumeCasterChange(): boolean {
    const casting = this.castShadows && this.isVisible;
    if (casting === this.#appliedCastShadows) {
      return false;
    }
    this.#appliedCastShadows = casting;
    return true;
  }

  /**
   * Builds or rebuilds the clone when the `mesh` field changed.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when a mesh was added to or removed from the scene.
   */
  #ensureClone(renderer: RendererImpl): boolean {
    const loaded = this.mesh?.state === "loaded" ? this.mesh.value : null;
    if (loaded === this.#appliedMesh) {
      return false;
    }
    this.#releaseClone(renderer);
    this.#appliedMesh = loaded;
    const template = loaded?.lite.mesh ?? null;
    if (template === null) {
      return false;
    }
    this.#instance = new MeshInstance(
      renderer.scene,
      template,
      entityInternals(this.entity).node,
      { entity: this.entity.handle, component: this.handle },
      this.entity.uid,
      this.#material(renderer),
    );
    return true;
  }

  /**
   * The material this renderer draws with: the first it declares, or the app's default.
   *
   * @param renderer - The rendering service, for the default material.
   * @returns The Lite material.
   */
  #material(renderer: RendererImpl): LiteMaterial {
    const declared = this.materials[0];
    return declared?.state === "loaded" ? declared.value.lite.material : renderer.defaultMaterial().lite.material;
  }

  /**
   * Removes the clone from the scene, when there is one.
   *
   * @param renderer - The rendering service, for the scene.
   */
  #releaseClone(renderer: RendererImpl): void {
    const instance = this.#instance;
    this.#instance = null;
    this.#appliedMesh = null;
    instance?.destroy(renderer.scene);
  }
}

/**
 * Builds the component's declared fields.
 *
 * @returns The schema. Built inside a function, not at module scope: a schema field is a function
 * call, and module scope holds declarations and immutable constants only
 * (`CONSTITUTION.md` §3.5, coding standards §4).
 */
function meshRendererSchema(): Schema {
  return defineSchema({
    mesh: asset(MeshAsset, { tooltip: "The geometry template to clone." }),
    materials: array(asset(MaterialAsset), [], { tooltip: "One per submesh; empty uses the default material." }),
    castShadows: bool(true, { tooltip: "Whether this mesh is rendered into shadow maps." }),
    receiveShadows: bool(true, { tooltip: "Whether shadow maps darken this mesh." }),
    renderOrder: i32(0, { tooltip: "Sort key within the opaque or transparent phase; lower draws first." }),
    pickable: bool(true, { tooltip: "Whether picking considers this mesh at all." }),
  });
}
