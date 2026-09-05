import { Component } from "../component/component.js";
import { entityInternals } from "../entity/internals.js";
import { linkParent } from "../lite/node.js";
import { asset, bool, map } from "../schema/field-kinds.js";
import { createDefaults, defineSchema } from "../schema/schema.js";
import { ModelInstance } from "./gpu/model-instance.js";
import { MaterialAsset } from "./material-asset.js";
import { ModelAsset } from "./model-asset.js";
import { rendererInternals } from "./renderer.js";
import type { RendererImpl } from "./renderer.js";
import type { AssetHandle } from "../assets/types.js";
import type { ComponentHooks } from "../component/component.js";
import type { Entity } from "../entity/entity.js";
import type { LiteAnimationGroup, LiteSkeleton } from "../lite/gpu/gltf.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { LiteMaterial } from "../lite/material.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { Schema } from "../schema/types.js";

/**
 * The `Model` component (`docs/architecture/07-rendering.md` §2.4): one instance of a loaded glTF,
 * cloned under the entity's node.
 *
 * ## The instanced subtree is opaque
 *
 * §2.4 is explicit that the Lite subtree "is not expanded into entities in the MVP": one entity
 * holds one model, and the glTF nodes inside it are reachable by name through
 * {@link Model.nodes} rather than as entities of their own. {@link Model.attachToNode} covers the
 * case that actually needs an entity inside the model — a weapon in a hand — by parenting an
 * entity's node under a glTF node, which makes it follow that bone with no per-frame copy.
 *
 * ## Decisions the documents left open
 *
 * - **glTF cameras and lights are ignored, and Phase 2 has no way to ask otherwise.** §2.4 says
 *   they are imported only when `importLights`/`importCameras` are set in the asset's
 *   `.meta.json`. Lite gates cameras behind a process-global `enableGltfCameras()` that must run
 *   before the **first** load (`src/lite/render-features.ts`), so a per-asset sidecar flag cannot
 *   decide it: whichever asset loads first would fix the answer for every later one. Rather than
 *   ship a flag that silently means "whatever the first model wanted", Phase 2 imports neither and
 *   the adapter keeps `enableGltfCameraImport` ready for the phase that adds a project-level
 *   setting. Lights inside a container are shallow-copied by Lite's own clone and are not added to
 *   the scene by ignifx, so they never light anything.
 * - **`materialOverrides` matches on the glTF material *name*.** §2.4 says "by material name",
 *   which is the only stable identifier a glTF gives a material. Phase 2 records the map and
 *   applies it to the nodes whose material carries that name; a name nothing matches is ignored.
 * - **`animations` are exposed, not advanced.** ADR-0003 gives every clock to ignifx, so the
 *   loader strips the clips off the container and this component republishes them. Playing them is
 *   `@ignifx/3d`'s animator; in Phase 2 they are read-only metadata, and the property is `@beta`
 *   because its element type is Lite's.
 *
 * ## Shadows are the whole subtree, decided once
 *
 * `castShadows` and `receiveShadows` mean for a model exactly what they mean for a `MeshRenderer`
 * (§2.3, §2.4): the instance contributes to `setShadowTaskCasterMeshes` while it casts, and Lite's
 * per-mesh `receiveShadows` is written across it. Both are answered from the mesh list
 * {@link ModelInstance} collects when the subtree is instantiated, never by walking the clone tree
 * per frame — the tree's shape is fixed once `instantiateContainer` built it (coding standards §7).
 * Instantiating a model, hiding it, or flipping `castShadows` reports a caster change through
 * {@link Model.consumeCasterChange}, which is what makes the `PreRender` system rebuild the caster
 * lists that frame. Destroying one cannot: the component has left the world's list by the time the
 * system runs, so `onDetach` raises `RendererImpl.needsCasterRebuild` instead and the next frame
 * picks it up.
 *
 * ## Headless
 *
 * A headless `ModelAsset` has no container, so there is nothing to clone: the component keeps its
 * fields, reports an empty `nodes` map and no animations, touches no scene, and casts nothing.
 */

/**
 * The empty node map a model without an instance reports, built once on first use and shared from
 * then on. It is a lazy cache rather than a module-scope constant because a `Map` allocates, and
 * coding standards §4 keeps allocation out of import time.
 */
let noNodes: ReadonlyMap<string, LiteSceneNode> | null = null;

/**
 * The shared empty node map.
 *
 * @returns A map that is always empty; every caller sees the same instance.
 */
function emptyNodes(): ReadonlyMap<string, LiteSceneNode> {
  noNodes ??= new Map<string, LiteSceneNode>();
  return noNodes;
}

/** The empty clip list a model without an asset reports. */
const NO_ANIMATIONS: readonly LiteAnimationGroup[] = Object.freeze([]);

/** The empty skeleton list a model without an asset reports. */
const NO_SKELETONS: readonly LiteSkeleton[] = Object.freeze([]);

/**
 * One instance of a loaded model (`docs/architecture/07-rendering.md` §2.4).
 *
 * @example
 * ```ts
 * const hero = await app.assets.loadAsync<ModelAsset>("models/hero.glb");
 * const entity = world.createEntity("Hero");
 * const model = entity.addComponent(Model, { model: hero.retain() });
 * model.attachToNode("hand.R", sword);
 * ```
 *
 * @public
 */
export class Model extends Component implements ComponentHooks {
  /** The namespaced registration id. */
  static typeId = "ignifx/Model";

  /** One model per entity: a second instance under the same transform wants its own entity. */
  static allowMultiple = false;

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = modelSchema();

  declare model: AssetHandle<ModelAsset> | null;

  declare materialOverrides: Record<string, AssetHandle<MaterialAsset> | null>;

  declare castShadows: boolean;

  declare receiveShadows: boolean;

  declare pickable: boolean;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Model.schema));
  }

  #asset: ModelAsset | null = null;

  #instance: ModelInstance | null = null;

  #appliedCastShadows = false;

  /**
   * The glTF nodes of this instance, by their names in the file.
   *
   * @remarks
   * The map is the instance's own, so two `Model`s of one asset never hand out each other's nodes.
   * It is empty until the asset is loaded, and under a headless app.
   *
   * @returns The nodes, keyed by glTF node name.
   */
  get nodes(): ReadonlyMap<string, LiteSceneNode> {
    return this.#instance?.nodes ?? emptyNodes();
  }

  /**
   * The clips the file declared.
   *
   * @remarks
   * Unstable: these are Lite's own animation groups, and ignifx does not advance them in Phase 2
   * (ADR-0003 — `@ignifx/3d`'s animator owns playback).
   *
   * @returns The clips, in load order.
   *
   * @beta
   */
  get animations(): readonly LiteAnimationGroup[] {
    return this.#asset?.animations ?? NO_ANIMATIONS;
  }

  /**
   * The skeletons the file declared. Empty unless the `boneControl` rendering feature was on before
   * the asset loaded.
   *
   * @returns The skeletons.
   *
   * @beta
   */
  get skeletons(): readonly LiteSkeleton[] {
    return this.#asset?.skeletons ?? NO_SKELETONS;
  }

  /**
   * The Babylon Lite objects this instance owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The cloned root, or `null` when there is nothing instantiated.
   */
  get lite(): { readonly root: LiteSceneNode | null } {
    return { root: this.#instance?.root ?? null };
  }

  /**
   * Parents an entity under one of the model's glTF nodes — the "weapon in hand" case
   * (`docs/architecture/07-rendering.md` §2.4).
   *
   * @remarks
   * The entity keeps its **local** transform, so it lands at the node's origin and then follows it
   * for free: Lite composes `parentWorld × local` on every read, so a bone attachment costs no
   * per-frame work at all. Detach by re-parenting the entity in the ordinary way.
   *
   * @param nodeName - The glTF node name, as the file spells it.
   * @param entity - The entity to attach.
   * @returns `true` when the node exists and the entity was attached.
   *
   * @example
   * ```ts
   * model.attachToNode("hand.R", sword);
   * ```
   */
  attachToNode(nodeName: string, entity: Entity): boolean {
    const node = this.nodes.get(nodeName);
    if (node === undefined) {
      return false;
    }
    linkParent(entityInternals(entity).node, node);
    return true;
  }

  /** Nothing to do at attach: the instance is built on the first sync, once `model` is decoded. */
  onAttach(): void {
    this.#asset = null;
  }

  /** Removes the instance from the scene and gives back its share of the template's buffers. */
  onDetach(): void {
    const renderer = rendererInternals(this.app.renderer);
    // A destroyed model leaves the world's component list, so the `PreRender` system will never ask
    // it for casters again — and would otherwise hand the generators a list still holding meshes
    // that are no longer in the scene. `needsCasterRebuild` is the one signal that survives the
    // component. It is raised unconditionally: a model that was not casting rebuilds to the same
    // list, so the flag says "the caster set may have moved", which is exactly what is true here.
    renderer.needsCasterRebuild = true;
    this.#appliedCastShadows = false;
    this.#release(renderer);
  }

  /**
   * Instantiates the template when `model` changed, then writes the flags that changed. The
   * `PreRender` system calls it.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when the scene's renderable set changed.
   *
   * @internal
   */
  sync(renderer: RendererImpl): boolean {
    const changed = this.#ensureInstance(renderer);
    // The map is resolved whether or not there is an instance: it is the component's own state,
    // and resolving it here keeps the instance half free of asset-handle bookkeeping.
    const overrides = this.#resolvedOverrides();
    const instance = this.#instance;
    if (instance === null) {
      return changed;
    }
    instance.applyOverrides(overrides);
    instance.applyReceiveShadows(this.receiveShadows);
    instance.applyVisible(this.isEnabledInHierarchy);
    return changed;
  }

  /**
   * Appends every mesh of the instantiated subtree to a shadow caster list, when the model casts.
   *
   * @param out - The caster list being built.
   *
   * @internal
   */
  collectCasters(out: LiteMesh[]): void {
    if (this.castShadows) {
      this.#instance?.collectCasters(out);
    }
  }

  /**
   * Whether the caster contribution of this model changed since the last frame.
   *
   * @returns `true` when `castShadows` or visibility moved — which covers the model being
   * instantiated, destroyed, hidden, or shown, because each of those moves visibility.
   *
   * @internal
   */
  consumeCasterChange(): boolean {
    const casting = this.castShadows && this.#instance?.isVisible === true;
    const changed = casting !== this.#appliedCastShadows;
    this.#appliedCastShadows = casting;
    return changed;
  }

  /**
   * The override map with every entry resolved to a loaded Lite material.
   *
   * @returns Source glTF material name to replacement material; empty when nothing resolved.
   */
  #resolvedOverrides(): ReadonlyMap<string, LiteMaterial> {
    const byName = new Map<string, LiteMaterial>();
    for (const name of Object.keys(this.materialOverrides)) {
      const handle = this.materialOverrides[name];
      if (handle != null && handle.state === "loaded") {
        byName.set(name, handle.value.lite.material);
      }
    }
    return byName;
  }

  /**
   * Builds or rebuilds the instance when the `model` field changed.
   *
   * @param renderer - The rendering service, for the scene.
   * @returns `true` when a subtree was added to or removed from the scene.
   */
  #ensureInstance(renderer: RendererImpl): boolean {
    const loaded = this.model?.state === "loaded" ? this.model.value : null;
    if (loaded === this.#asset) {
      return false;
    }
    this.#release(renderer);
    this.#asset = loaded;
    if (loaded === null) {
      return false;
    }
    const instantiation = loaded.instantiate(entityInternals(this.entity).node);
    if (instantiation === null) {
      return false;
    }
    this.#instance = new ModelInstance(renderer.scene, loaded, instantiation, {
      entity: this.entity.handle,
      component: this.handle,
    });
    return true;
  }

  /**
   * Removes the instantiated subtree from the scene.
   *
   * @param renderer - The rendering service, for the scene.
   */
  #release(renderer: RendererImpl): void {
    const instance = this.#instance;
    this.#instance = null;
    this.#asset = null;
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
function modelSchema(): Schema {
  return defineSchema({
    model: asset(ModelAsset, { tooltip: "The glTF template to instantiate." }),
    materialOverrides: map(asset(MaterialAsset), { tooltip: "Replaces a glTF material, by its name." }),
    castShadows: bool(true, { tooltip: "Whether the instance is rendered into shadow maps." }),
    receiveShadows: bool(true, { tooltip: "Whether shadow maps darken the instance." }),
    pickable: bool(true, { tooltip: "Whether picking considers the instance at all." }),
  });
}
