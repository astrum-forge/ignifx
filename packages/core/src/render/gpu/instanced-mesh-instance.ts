import {
  addMeshToScene,
  cloneMeshUnderNode,
  detachMeshBounds,
  removeMeshFromScene,
  setMeshBounds,
  setMeshId,
  setMeshMaterial,
  setMeshPickable,
  setMeshReceiveShadows,
  setMeshRenderOrder,
  setMeshSubtreeVisible,
} from "../../lite/gpu/mesh.js";
import {
  clearThinInstanceLodPartner,
  enableThinInstanceDynamicDrawCount,
  enableThinInstanceGpuCulling,
  enableThinInstanceWorldBounds,
  flushThinInstances,
  setThinInstanceColors,
  setThinInstanceCount,
  setThinInstanceLodPartner,
  setThinInstances,
  trySetThinInstanceDrawCount,
} from "../../lite/gpu/thin-instances.js";
import { tagNode } from "../../lite/node.js";
import type { LiteMesh } from "../../lite/gpu/mesh.js";
import type { LiteMaterial } from "../../lite/material.js";
import type { LiteSceneNode, NodeTag } from "../../lite/node.js";
import type { LiteScene } from "../../lite/scene.js";

/**
 * One `InstancedMeshRenderer`'s near mesh and its optional LOD partner, and everything that writes
 * to them (`docs/plan/2026-09-terrain-particles-shaders.md` §3.5).
 *
 * Every line needs a WebGPU device, which is why it sits in `src/render/gpu/` — excluded from the
 * Node coverage floor and measured by the browser project — and why the component reaches it through
 * a dynamic `import()` (`../instanced-mesh-support.ts`).
 *
 * `capacity`, `gpuCulling` and the partner's identity are constructor arguments rather than `apply*`
 * methods because Lite fixes all three at `registerScene`; `distance` and `band` may be re-set live
 * by calling the pairing again. Both meshes share one matrix slab, which the pairing requires: it
 * compacts the near mesh's culling output into two buckets drawn from the same matrices.
 *
 * Bounds are the one thing an instanced caster needs that a plain mesh does not.
 * `computeDirectionalLightMatrix` composes `mesh.worldMatrix × mesh.boundMin/boundMax` directly
 * (`lib/shadow/shadow-base.js` 54) and never consults the `_expandWorldBounds` hook
 * `enableThinInstanceWorldBounds` installs, so a cloud left at its prototype's box casts nothing
 * (measured on SwiftShader, 2026-09-08). {@link InstancedMeshInstance.applyBounds} publishes the
 * union of the live placements instead; culling accuracy is unaffected because each instance's cull
 * sphere comes from the real vertices (`lib/mesh/thin-instance-gpu-culling.js` 426).
 */

/** What the component remembers between uploads. Mutated in place, so a frame allocates nothing. */
export interface InstancedUploadState {
  /** The whole slab has to be re-pointed and re-uploaded. */
  isSlabDirty: boolean;
  /** The caller mutated the slab in place, so the active range has to be re-uploaded. */
  isRangeDirty: boolean;
  /** The count the meshes were last told about. */
  appliedCount: number;
  /** The capacity the meshes were built with. */
  appliedCapacity: number;
  /** Whether the union bounds have been published at least once. */
  hasAppliedBounds: boolean;
  /** Whether the last upload carried a colour slab. */
  hadColors: boolean;
}

/** The LOD switch the component declares, as much of it as the adapter reads. */
export interface InstancedLodFields {
  /** The camera distance at which an instance switches to the partner. */
  readonly distance: number;
  /** The width of the per-instance dither window. */
  readonly band: number;
}

/** The LOD partner an instance is built with. */
export interface InstancedLodConfig {
  /** The coarse template to clone. */
  readonly template: LiteMesh;
  /** The camera distance, in world units, at which an instance switches to the partner. */
  readonly distance: number;
  /** The width of the per-instance dither window centred on `distance`. */
  readonly band: number;
}

/** The settings Lite fixes when the meshes are built. */
export interface InstancedMeshSettings {
  /** The largest instance count the meshes will ever draw. */
  readonly capacity: number;
  /** Whether the compute culling pass runs. */
  readonly gpuCulling: boolean;
  /** The LOD partner, or `null`. */
  readonly lod: InstancedLodConfig | null;
}

/**
 * A live instanced mesh, and its LOD partner, in a scene.
 *
 * @internal
 */
export class InstancedMeshInstance {
  /** The cloned near mesh, parented under the entity's node. */
  readonly clone: LiteSceneNode;

  readonly #lod: LiteSceneNode | null;

  #material: LiteMaterial;

  #receiveShadows: boolean | null = null;

  #renderOrder = Number.NaN;

  #pickable: boolean | null = null;

  #visible = false;

  #lodDistance: number;

  #lodBand: number;

  readonly #nearBox: Float64Array;

  readonly #lodBox: Float64Array | null;

  readonly #union = new Float64Array(6);

  /**
   * Clones the templates, gives them thin instances, applies the baked settings in Lite's required
   * order, and adds them to the scene.
   *
   * @param scene - The render scene.
   * @param template - The near mesh's template.
   * @param parent - The entity's transform node.
   * @param tag - The owning entity and component, for picking.
   * @param meshId - The string id Lite's light include/exclude sets match on.
   * @param material - The material both meshes draw with. Assigned **before** the meshes join the
   * scene, for the reason `MeshInstance`'s constructor records: `addToScene` buckets a mesh by its
   * material's build group.
   * @param settings - Capacity, GPU culling, and the LOD pairing.
   * @param matrices - The matrix slab, caller-owned and never copied.
   * @param count - How many instances draw.
   * @param colors - Four floats per instance, or `null`.
   */
  constructor(
    scene: LiteScene,
    template: LiteMesh,
    parent: LiteSceneNode,
    tag: NodeTag,
    meshId: string,
    material: LiteMaterial,
    settings: InstancedMeshSettings,
    matrices: Float32Array,
    count: number,
    colors: Float32Array | null,
  ) {
    const clone = cloneMeshUnderNode(template, parent);
    tagNode(clone, tag);
    const mesh = asMesh(clone);
    setMeshId(mesh, meshId);
    setMeshMaterial(mesh, material);
    // A clone shares the template's bound arrays, and `applyBounds` mutates them in place.
    detachMeshBounds(mesh);
    this.#nearBox = readBox(mesh);
    installThinInstances(mesh, settings.capacity, matrices, count, colors);
    enableThinInstanceGpuCulling(mesh, settings.gpuCulling);
    enableThinInstanceDynamicDrawCount(mesh);

    const lodConfig = settings.lod;
    let lodClone: LiteSceneNode | null = null;
    let lodBox: Float64Array | null = null;
    if (lodConfig !== null) {
      lodClone = cloneMeshUnderNode(lodConfig.template, parent);
      tagNode(lodClone, tag);
      const lodMesh = asMesh(lodClone);
      setMeshId(lodMesh, `${meshId}#lod`);
      setMeshMaterial(lodMesh, material);
      detachMeshBounds(lodMesh);
      lodBox = readBox(lodMesh);
      installThinInstances(lodMesh, settings.capacity, matrices, count, colors);
      setThinInstanceLodPartner(mesh, lodMesh, { distance: lodConfig.distance, band: lodConfig.band });
    }
    this.#lodBox = lodBox;

    this.#material = material;
    this.#lodDistance = lodConfig?.distance ?? 0;
    this.#lodBand = lodConfig?.band ?? 0;
    // Hidden until the first `applyVisible`, so a renderer on an inactive entity never flashes.
    setMeshSubtreeVisible(clone, false);
    addMeshToScene(scene, clone);
    if (lodClone !== null) {
      setMeshSubtreeVisible(lodClone, false);
      addMeshToScene(scene, lodClone);
    }
    this.clone = clone;
    this.#lod = lodClone;
  }

  /**
   * Whether the meshes are currently drawn.
   *
   * @returns `true` when Lite's `visible` is set on them.
   */
  get isVisible(): boolean {
    return this.#visible;
  }

  /**
   * The near mesh.
   *
   * @returns The clone, typed as a mesh.
   */
  get mesh(): LiteMesh {
    return asMesh(this.clone);
  }

  /**
   * The LOD partner.
   *
   * @returns The partner clone, or `null` when the renderer declares no LOD.
   */
  get lodMesh(): LiteMesh | null {
    const lod = this.#lod;
    return lod === null ? null : asMesh(lod);
  }

  /**
   * Assigns the material to both meshes, when it changed.
   *
   * @param material - The Lite material to draw with.
   */
  applyMaterial(material: LiteMaterial): void {
    if (material === this.#material) {
      return;
    }
    this.#material = material;
    setMeshMaterial(this.mesh, material);
    const lod = this.lodMesh;
    if (lod !== null) {
      setMeshMaterial(lod, material);
    }
  }

  /**
   * Writes the per-mesh flags that changed, to both meshes.
   *
   * @param receiveShadows - Whether shadow maps darken the meshes.
   * @param renderOrder - The sort key within the phase.
   * @param pickable - Whether picking considers the meshes at all.
   */
  applyFlags(receiveShadows: boolean, renderOrder: number, pickable: boolean): void {
    if (this.#receiveShadows !== receiveShadows) {
      this.#receiveShadows = receiveShadows;
      this.#eachMesh(setMeshReceiveShadows, receiveShadows);
    }
    if (this.#renderOrder !== renderOrder) {
      this.#renderOrder = renderOrder;
      this.#eachMesh(setMeshRenderOrder, renderOrder);
    }
    if (this.#pickable !== pickable) {
      this.#pickable = pickable;
      this.#eachMesh(setMeshPickable, pickable);
    }
  }

  /**
   * Re-sets the LOD switch distance and dither band, when either changed.
   *
   * @param distance - The camera distance at which an instance switches to the partner.
   * @param band - The width of the per-instance dither window centred on `distance`.
   */
  applyLod(distance: number, band: number): void {
    const lod = this.lodMesh;
    if (lod === null || (distance === this.#lodDistance && band === this.#lodBand)) {
      return;
    }
    this.#lodDistance = distance;
    this.#lodBand = band;
    setThinInstanceLodPartner(this.mesh, lod, { distance, band });
  }

  /**
   * Shows or hides both meshes, when the state changed.
   *
   * @param visible - `entity.activeInHierarchy && component.enabled`.
   */
  applyVisible(visible: boolean): void {
    if (visible === this.#visible) {
      return;
    }
    this.#visible = visible;
    setMeshSubtreeVisible(this.clone, visible);
    const lod = this.#lod;
    if (lod !== null) {
      setMeshSubtreeVisible(lod, visible);
    }
  }

  /**
   * Re-points both meshes at a matrix slab and re-uploads the active range.
   *
   * @param capacity - The capacity the meshes were built with; re-stating it keeps `_capacity`
   * unchanged, which is what stops Lite from re-creating the GPU buffer.
   * @param matrices - The slab, caller-owned.
   * @param count - How many instances draw.
   * @param colors - Four floats per instance, or `null`.
   */
  applySlab(capacity: number, matrices: Float32Array, count: number, colors: Float32Array | null): void {
    installThinInstances(this.mesh, capacity, matrices, count, colors);
    const lod = this.lodMesh;
    if (lod !== null) {
      installThinInstances(lod, capacity, matrices, count, colors);
    }
  }

  /**
   * Changes how many instances draw, by the cheapest route Lite accepts.
   *
   * @param count - The active count, at most the capacity.
   */
  applyCount(count: number): void {
    applyMeshCount(this.mesh, count);
    const lod = this.lodMesh;
    if (lod !== null) {
      applyMeshCount(lod, count);
    }
  }

  /**
   * Marks the whole active range dirty, after the caller mutated the slab in place.
   *
   * @param colors - The colour slab, when the renderer has one, so its own dirty range moves too.
   */
  flush(colors: Float32Array | null): void {
    flushThinInstances(this.mesh);
    const lod = this.lodMesh;
    if (lod !== null) {
      flushThinInstances(lod);
    }
    if (colors !== null) {
      setThinInstanceColors(this.mesh, colors);
      if (lod !== null) {
        setThinInstanceColors(lod, colors);
      }
    }
  }

  /**
   * Publishes the union of the live instance placements as both meshes' object-local bounds, so a
   * directional light's shadow frustum is fitted to the cloud rather than to the prototype.
   *
   * @remarks
   * `O(count)`, allocation-free, and worth paying only for a caster — see the module note. A count
   * of zero restores the prototype's own box, so an empty cloud does not report an infinite one.
   *
   * @param matrices - The live matrix slab.
   * @param count - How many instances are drawn.
   */
  applyBounds(matrices: Float32Array, count: number): void {
    const near = this.#nearBox;
    const lodBox = this.#lodBox;
    const lod = this.lodMesh;
    if (count <= 0) {
      writeBox(this.mesh, near);
      if (lod !== null && lodBox !== null) {
        writeBox(lod, lodBox);
      }
      return;
    }
    const union = this.#union;
    unionOfPlacements(matrices, count, near, union);
    setMeshBounds(this.mesh, union[0] ?? 0, union[1] ?? 0, union[2] ?? 0, union[3] ?? 0, union[4] ?? 0, union[5] ?? 0);
    if (lod !== null && lodBox !== null) {
      unionOfPlacements(matrices, count, lodBox, union);
      setMeshBounds(lod, union[0] ?? 0, union[1] ?? 0, union[2] ?? 0, union[3] ?? 0, union[4] ?? 0, union[5] ?? 0);
    }
  }

  /**
   * Writes everything the component changed since the last frame onto both meshes.
   *
   * @param state - The component's upload state, mutated in place.
   * @param material - The material both meshes draw with.
   * @param receiveShadows - Whether shadow maps darken them.
   * @param renderOrder - The sort key within the phase.
   * @param pickable - Whether picking considers them.
   * @param lod - The LOD record, whose `distance` and `band` Lite re-applies live; `null` for none.
   * @param matrices - The caller-owned matrix slab.
   * @param count - How many instances draw.
   * @param colors - Four floats per instance, or `null`.
   * @param castShadows - Whether the union bounds have to be published for a shadow frustum.
   * @param visible - `entity.activeInHierarchy && component.enabled`.
   * @returns `true` when the compiled pipeline has to change, which only a colour slab arriving or
   * leaving does.
   */
  sync(
    state: InstancedUploadState,
    material: LiteMaterial,
    receiveShadows: boolean,
    renderOrder: number,
    pickable: boolean,
    lod: InstancedLodFields | null,
    matrices: Float32Array,
    count: number,
    colors: Float32Array | null,
    castShadows: boolean,
    visible: boolean,
  ): boolean {
    this.applyMaterial(material);
    this.applyFlags(receiveShadows, renderOrder, pickable);
    if (lod !== null) {
      this.applyLod(lod.distance, lod.band);
    }
    let renderablesChanged = false;
    let placementsMoved = false;
    if (state.isSlabDirty) {
      state.isSlabDirty = false;
      state.isRangeDirty = false;
      this.applySlab(state.appliedCapacity, matrices, count, colors);
      state.appliedCount = count;
      placementsMoved = true;
      const hasColors = colors !== null;
      renderablesChanged = hasColors !== state.hadColors;
      state.hadColors = hasColors;
    } else {
      if (state.isRangeDirty) {
        state.isRangeDirty = false;
        this.flush(colors);
        placementsMoved = true;
      }
      if (count !== state.appliedCount) {
        state.appliedCount = count;
        this.applyCount(count);
        placementsMoved = true;
      }
    }
    // Only a caster pays the `O(count)` bounds pass, and only in a frame whose placements moved.
    if (castShadows && (placementsMoved || !state.hasAppliedBounds)) {
      state.hasAppliedBounds = true;
      this.applyBounds(matrices, count);
    }
    this.applyVisible(visible);
    return renderablesChanged;
  }

  /**
   * Appends both meshes to a shadow caster list, when the renderer casts and they are drawn.
   *
   * @param castShadows - Whether the renderer casts.
   * @param out - The caster list being built.
   */
  collectCasters(castShadows: boolean, out: LiteMesh[]): void {
    if (!castShadows || !this.#visible) {
      return;
    }
    out.push(this.mesh);
    const lod = this.lodMesh;
    if (lod !== null) {
      out.push(lod);
    }
  }

  /**
   * Dissolves the LOD pairing and removes both meshes from the scene, releasing their share of the
   * templates' buffers.
   *
   * @param scene - The render scene.
   */
  destroy(scene: LiteScene): void {
    const lod = this.#lod;
    if (lod !== null) {
      clearThinInstanceLodPartner(this.mesh);
      removeMeshFromScene(scene, lod);
    }
    removeMeshFromScene(scene, this.clone);
  }

  /**
   * Runs a per-mesh Lite setter over the near mesh and the partner.
   *
   * @typeParam T - The setter's value type.
   * @param write - The adapter function to call.
   * @param value - What to write.
   */
  #eachMesh<T>(write: (mesh: LiteMesh, value: T) => void, value: T): void {
    write(this.mesh, value);
    const lod = this.lodMesh;
    if (lod !== null) {
      write(lod, value);
    }
  }
}

/**
 * Builds the live meshes, filling in the LOD pairing when both templates exist.
 *
 * @param scene - The render scene.
 * @param template - The near mesh's template.
 * @param lodTemplate - The coarse template, or `null`.
 * @param lod - The LOD record the component declares, or `null`.
 * @param parent - The entity's transform node.
 * @param tag - The owning entity and component, for picking.
 * @param meshId - The string id Lite's light include/exclude sets match on.
 * @param material - The material both meshes draw with.
 * @param capacity - The largest instance count the meshes will ever draw.
 * @param gpuCulling - Whether the compute culling pass runs.
 * @param matrices - The matrix slab.
 * @param count - How many instances draw.
 * @param colors - Four floats per instance, or `null`.
 * @returns The instance.
 *
 * @internal
 */
export function createInstancedMesh(
  scene: LiteScene,
  template: LiteMesh,
  lodTemplate: LiteMesh | null,
  lod: InstancedLodFields | null,
  parent: LiteSceneNode,
  tag: NodeTag,
  meshId: string,
  material: LiteMaterial,
  capacity: number,
  gpuCulling: boolean,
  matrices: Float32Array,
  count: number,
  colors: Float32Array | null,
): InstancedMeshInstance {
  const pairing: InstancedLodConfig | null =
    lodTemplate === null || lod === null ? null : { template: lodTemplate, distance: lod.distance, band: lod.band };
  return new InstancedMeshInstance(
    scene,
    template,
    parent,
    tag,
    meshId,
    material,
    { capacity, gpuCulling, lod: pairing },
    matrices,
    count,
    colors,
  );
}

/**
 * Removes the meshes from the scene, when there are any.
 *
 * @param instance - The live meshes, or `null`.
 * @param scene - The render scene.
 * @returns `true` when something left the scene.
 *
 * @internal
 */
export function releaseInstancedMesh(instance: InstancedMeshInstance | null, scene: LiteScene): boolean {
  if (instance === null) {
    return false;
  }
  instance.destroy(scene);
  return true;
}

/**
 * Gives one mesh its thin instances in the order Lite requires, at a fixed capacity.
 *
 * @remarks
 * `setThinInstances` is handed the **capacity** so that `_capacity` — and the GPU buffer it sizes —
 * never moves; the active count is then lowered in the same breath, before any frame can read the
 * range in between (`src/lite/gpu/thin-instances.ts`).
 *
 * @param mesh - The mesh to instance.
 * @param capacity - The capacity to fix.
 * @param matrices - The slab, caller-owned.
 * @param count - How many instances draw.
 * @param colors - Four floats per instance, or `null`.
 */
function installThinInstances(
  mesh: LiteMesh,
  capacity: number,
  matrices: Float32Array,
  count: number,
  colors: Float32Array | null,
): void {
  setThinInstances(mesh, matrices, capacity);
  setThinInstanceCount(mesh, count);
  setThinInstanceColors(mesh, colors);
  enableThinInstanceWorldBounds(mesh);
}

/**
 * Changes one mesh's active count without re-uploading when Lite allows it, and with a re-upload
 * when it does not.
 *
 * @param mesh - The instanced mesh.
 * @param count - The active count.
 */
function applyMeshCount(mesh: LiteMesh, count: number): void {
  if (!trySetThinInstanceDrawCount(mesh, count)) {
    setThinInstanceCount(mesh, count);
  }
}

/**
 * Reads a mesh's object-local box into six numbers.
 *
 * @remarks
 * A mesh built by any Lite factory carries bounds; the fallback half-metre cube is the same default
 * `computeDirectionalLightMatrix` uses for a mesh that does not
 * (`lib/shadow/shadow-base.js` 62).
 *
 * @param mesh - The mesh to read.
 * @returns `minX, minY, minZ, maxX, maxY, maxZ`.
 */
function readBox(mesh: LiteMesh): Float64Array {
  const min = mesh.boundMin ?? [-0.5, -0.5, -0.5];
  const max = mesh.boundMax ?? [0.5, 0.5, 0.5];
  return Float64Array.of(min[0], min[1], min[2], max[0], max[1], max[2]);
}

/**
 * Writes a six-number box back onto a mesh.
 *
 * @param mesh - The mesh to re-bound.
 * @param box - `minX, minY, minZ, maxX, maxY, maxZ`.
 */
function writeBox(mesh: LiteMesh, box: Float64Array): void {
  setMeshBounds(mesh, box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0, box[4] ?? 0, box[5] ?? 0);
}

/**
 * The axis-aligned union of a prototype box placed under every live instance matrix.
 *
 * @remarks
 * The same oriented-box-to-AABB composition Lite's own
 * `expandThinInstanceWorldBounds` uses, minus the world matrix — because `Mesh.boundMin`/`boundMax`
 * are documented to be **object-local**, the frame `worldMatrix` maps out of. Degenerate matrices
 * are skipped, exactly as Lite skips them, so a slot that has not been written yet does not drag
 * the box to the origin.
 *
 * @param matrices - The slab, 16 column-major floats per instance.
 * @param count - How many instances to consider.
 * @param box - The prototype's own box.
 * @param out - Receives `minX, minY, minZ, maxX, maxY, maxZ`.
 */
function unionOfPlacements(matrices: Float32Array, count: number, box: Float64Array, out: Float64Array): void {
  const centreX = ((box[0] ?? 0) + (box[3] ?? 0)) * 0.5;
  const centreY = ((box[1] ?? 0) + (box[4] ?? 0)) * 0.5;
  const centreZ = ((box[2] ?? 0) + (box[5] ?? 0)) * 0.5;
  const extentX = ((box[3] ?? 0) - (box[0] ?? 0)) * 0.5;
  const extentY = ((box[4] ?? 0) - (box[1] ?? 0)) * 0.5;
  const extentZ = ((box[5] ?? 0) - (box[2] ?? 0)) * 0.5;
  out[0] = Number.POSITIVE_INFINITY;
  out[1] = Number.POSITIVE_INFINITY;
  out[2] = Number.POSITIVE_INFINITY;
  out[3] = Number.NEGATIVE_INFINITY;
  out[4] = Number.NEGATIVE_INFINITY;
  out[5] = Number.NEGATIVE_INFINITY;
  const usable = Math.min(count, Math.floor(matrices.length / 16));
  let placed = 0;
  for (let index = 0; index < usable; index += 1) {
    const base = index * 16;
    let scale = 0;
    for (let element = 0; element < 12; element += 1) {
      if (element % 4 !== 3) {
        scale += Math.abs(matrices[base + element] ?? 0);
      }
    }
    if (scale < 1e-9) {
      continue;
    }
    placed += 1;
    for (let row = 0; row < 3; row += 1) {
      const m0 = matrices[base + row] ?? 0;
      const m1 = matrices[base + 4 + row] ?? 0;
      const m2 = matrices[base + 8 + row] ?? 0;
      const centre = (matrices[base + 12 + row] ?? 0) + m0 * centreX + m1 * centreY + m2 * centreZ;
      const radius = Math.abs(m0) * extentX + Math.abs(m1) * extentY + Math.abs(m2) * extentZ;
      const low = centre - radius;
      const high = centre + radius;
      if (low < (out[row] ?? 0)) {
        out[row] = low;
      }
      if (high > (out[row + 3] ?? 0)) {
        out[row + 3] = high;
      }
    }
  }
  if (placed === 0) {
    out.set(box);
  }
}

/**
 * Narrows a cloned subtree root to a mesh.
 *
 * @remarks
 * The same boundary assertion `MeshInstance` makes, for the same reason: `cloneTransformNode` is
 * typed as returning the wider `SceneNode` because it also clones plain transform nodes, and the
 * clone of a mesh is a mesh (coding standards §5.2).
 *
 * @param node - The clone.
 * @returns The same object, typed as a mesh.
 */
function asMesh(node: LiteSceneNode): LiteMesh {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the note above.
  return node as LiteMesh;
}
