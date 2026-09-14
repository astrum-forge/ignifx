import {
  addToScene,
  cloneTransformNode,
  createBox,
  createCapsule,
  createCylinder,
  createGround,
  createMeshFromData,
  createPlane,
  createSphere,
  createTorus,
  removeFromScene,
  setSubtreeVisible,
  updateMeshColors as liteUpdateMeshColors,
  updateMeshNormals as liteUpdateMeshNormals,
  updateMeshPositions as liteUpdateMeshPositions,
  updateMeshUvs as liteUpdateMeshUvs,
} from "@babylonjs/lite";
import type {
  BoxOptions,
  CapsuleOptions,
  CylinderOptions,
  EngineContext,
  GroundOptions,
  Material,
  Mesh,
  PlaneOptions,
  SceneContext,
  SceneNode,
  SphereOptions,
  TorusOptions,
} from "@babylonjs/lite";

/**
 * Mesh half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §2.3). Every function
 * here needs a WebGPU device — `createMeshFromData` uploads four vertex buffers through
 * `engine._device` (`lib/mesh/mesh.js`, `uploadMeshToGPU`) and the null engine has no `_device` —
 * so the whole module lives under `src/lite/gpu/` and is covered by the browser test project.
 *
 * Everything here is `@internal`.
 *
 * ## Ownership, cloning, and disposal (verified against `@babylonjs/lite@1.27.0`)
 *
 * - `cloneTransformNode(mesh)` (`index.d.ts` 1776, `lib/scene/transform-node.js`) shallow-clones a
 *   mesh: the clone gets a fresh transform and **the same `_gpu` wrapper object**, with
 *   `retain(_gpu)` bumping a reference count. So N clones of one template share exactly one set of
 *   GPU buffers — that is spike S2.4's "instancing shares GPU buffers", and it is provable by
 *   object identity rather than by measuring memory.
 * - Disposal is driven entirely by scene membership. `removeFromScene` calls `unregisterMeshScene`,
 *   and only when the mesh has left its **last** scene does it queue `disposeMeshGpu`, which calls
 *   `release(_gpu)` and destroys the buffers only when the count drops to one
 *   (`lib/scene/scene-remove.js`, `lib/mesh/mesh-dispose.js`, `lib/resource/ref-count.js`). A
 *   template that is never added to a scene therefore keeps its buffers alive no matter how many
 *   clones come and go — which is what `docs/architecture/07-rendering.md` §2.3 means by "the
 *   template's buffers stay alive while the asset is retained".
 * - The flip side is that Lite exports **no** mesh disposer. The only public way to release a
 *   template's buffers is {@link disposeMeshTemplate}: add it to a scene and take it out again.
 * - `removeFromScene` also recursively removes a mesh's `children` and nulls its `parent`, so
 *   removing a `Model`'s root removes the whole instantiated subtree in one call.
 * - Hiding is `setSubtreeVisible` (exported as `setMeshVisible` too, `index.d.ts` 11199): it
 *   cascades `visible` down the subtree and bumps a global visibility epoch. Never remove a mesh
 *   from the scene to hide it — that disposes it.
 *
 * ## Updating a mesh's vertices (verified against `lib/mesh/mesh-factories.js`)
 *
 * `updateMesh*` writes the GPU buffer and **nothing else**. Three consequences, all of them
 * surprising enough to be worth stating where the calls are:
 *
 * 1. **The retained CPU arrays are not replaced.** `createMeshFromData` keeps `_cpuPositions`,
 *    `_cpuNormals`, `_cpuUvs` and `_cpuIndices` — the arrays it was handed — and Lite's CPU ray
 *    pick reads them (`lib/picking/ray-pick.js`). Only `updateMeshGeometry`/`resizeMeshGeometry`
 *    re-retain, through `retainMeshGeometry`. So an update that hands over a *different* array
 *    leaves picking looking at the old geometry, while an update after mutating the retained array
 *    in place leaves picking exact. `MeshAsset` keeps its own copy in step for that reason.
 * 2. **Bounds are not recomputed.** `retainMeshGeometry` is what calls `computeAabb` and writes
 *    `boundMin`/`boundMax`; the partial updaters do not. `Mesh`'s own declaration says a consumer
 *    "MAY overwrite these with a wider hand-computed box", so {@link setMeshBounds} exists and
 *    `MeshAsset.updatePositions` uses it.
 * 3. **A cloned template cannot be updated at all.** `writeVertexAttributeRange` throws
 *    (`ThrowLiteError(360)`) when `mesh._gpu._refCount > 1`, and cloning a mesh retains that very
 *    wrapper. A `MeshAsset` a `MeshRenderer` has drawn is therefore frozen; a mesh meant to be
 *    edited is a renderable of its own, which is the shape the terrain chunk adapter uses.
 */

/**
 * The Babylon Lite mesh a `MeshAsset` template and a `MeshRenderer` clone are, re-exported under an
 * ignifx name so feature code can name the type without importing `@babylonjs/lite`
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable: it is Lite's own type, reachable only through documented `.lite` escape hatches, and it
 * is excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteMesh = Mesh;

/**
 * Creates a box template.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - A uniform size, or per-axis dimensions.
 * @returns The mesh. It belongs to no scene yet.
 *
 * @example
 * ```ts
 * const template = createBoxMesh(engine, { size: 2 });
 * const instance = cloneMeshUnderNode(template, entityNode);
 * addMeshToScene(scene, instance);
 * ```
 *
 * @internal
 */
export function createBoxMesh(engine: EngineContext, options?: number | BoxOptions): Mesh {
  return createBox(engine, options);
}

/**
 * Creates a sphere template.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Segment count and diameters.
 * @returns The mesh.
 *
 * @internal
 */
export function createSphereMesh(engine: EngineContext, options?: SphereOptions): Mesh {
  return createSphere(engine, options);
}

/**
 * Creates a plane template in the XY plane.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Size, or width and height.
 * @returns The mesh.
 *
 * @internal
 */
export function createPlaneMesh(engine: EngineContext, options?: PlaneOptions): Mesh {
  return createPlane(engine, options);
}

/**
 * Creates a subdivided ground template in the XZ plane.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Width, height, subdivisions, and UV scale.
 * @returns The mesh.
 *
 * @internal
 */
export function createGroundMesh(engine: EngineContext, options?: GroundOptions): Mesh {
  return createGround(engine, options);
}

/**
 * Creates a cylinder template along the Y axis.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Height, diameters, and tessellation.
 * @returns The mesh.
 *
 * @internal
 */
export function createCylinderMesh(engine: EngineContext, options?: CylinderOptions): Mesh {
  return createCylinder(engine, options);
}

/**
 * Creates a capsule template along the Y axis.
 *
 * @remarks
 * `height` is the **total** height including both caps (`index.d.ts` 1523), which is the same
 * convention `@ignifx/physics`'s capsule collider uses, so a renderer and a collider built from one
 * pair of numbers line up.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Height, radius, and tessellation.
 * @returns The mesh.
 *
 * @internal
 */
export function createCapsuleMesh(engine: EngineContext, options?: CapsuleOptions): Mesh {
  return createCapsule(engine, options);
}

/**
 * Creates a torus template in the XZ plane.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Diameter, thickness, and tessellation.
 * @returns The mesh.
 *
 * @internal
 */
export function createTorusMesh(engine: EngineContext, options?: TorusOptions): Mesh {
  return createTorus(engine, options);
}

/**
 * Creates a mesh from raw vertex data.
 *
 * @remarks
 * Lite keeps a reference to the arrays that are handed in — it does not copy them — and uses them
 * for CPU ray picking and bounds (`lib/mesh/mesh-factories.js`). Callers must not mutate them
 * afterwards.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param name - A debug name.
 * @param positions - Three floats per vertex.
 * @param normals - Three floats per vertex.
 * @param indices - Three indices per triangle.
 * @param uvs - Two floats per vertex, or omitted.
 * @param uvs2 - Two floats per vertex for the second UV set, or omitted.
 * @param tangents - Four floats per vertex, or omitted.
 * @param colors - Four floats per vertex, or omitted.
 * @returns The mesh.
 *
 * @internal
 */
export function createMeshFromGeometry(
  engine: EngineContext,
  name: string,
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
  uvs?: Float32Array,
  uvs2?: Float32Array,
  tangents?: Float32Array,
  colors?: Float32Array,
): Mesh {
  return createMeshFromData(engine, name, positions, normals, indices, uvs, uvs2, tangents, colors);
}

/**
 * Re-uploads part of a mesh's position buffer.
 *
 * @remarks
 * A no-op range is accepted; an out-of-range one, or a mesh whose GPU geometry has co-owners,
 * throws a Lite error (see the module note). It does **not** refresh the CPU picking geometry or
 * the bounds.
 *
 * @param engine - The engine that owns the buffer.
 * @param mesh - The mesh to update.
 * @param positions - Three floats per vertex, read from index 0.
 * @param vertexOffset - The first destination vertex to overwrite.
 * @param vertexCount - How many vertices to write.
 *
 * @internal
 */
export function updateMeshPositions(
  engine: EngineContext,
  mesh: Mesh,
  positions: Float32Array,
  vertexOffset: number,
  vertexCount: number,
): void {
  liteUpdateMeshPositions(engine, mesh, positions, vertexOffset, vertexCount);
}

/**
 * Re-uploads part of a mesh's normal buffer.
 *
 * @param engine - The engine that owns the buffer.
 * @param mesh - The mesh to update.
 * @param normals - Three floats per vertex.
 * @param vertexOffset - The first destination vertex to overwrite.
 * @param vertexCount - How many vertices to write.
 *
 * @internal
 */
export function updateMeshNormals(
  engine: EngineContext,
  mesh: Mesh,
  normals: Float32Array,
  vertexOffset: number,
  vertexCount: number,
): void {
  liteUpdateMeshNormals(engine, mesh, normals, vertexOffset, vertexCount);
}

/**
 * Re-uploads part of a mesh's UV buffer.
 *
 * @remarks
 * Lite makes it a no-op when the mesh was created without UVs, rather than an error.
 *
 * @param engine - The engine that owns the buffer.
 * @param mesh - The mesh to update.
 * @param uvs - Two floats per vertex.
 * @param vertexOffset - The first destination vertex to overwrite.
 * @param vertexCount - How many vertices to write.
 *
 * @internal
 */
export function updateMeshUvs(
  engine: EngineContext,
  mesh: Mesh,
  uvs: Float32Array,
  vertexOffset: number,
  vertexCount: number,
): void {
  liteUpdateMeshUvs(engine, mesh, uvs, vertexOffset, vertexCount);
}

/**
 * Re-uploads part of a mesh's vertex-colour buffer.
 *
 * @remarks
 * The colour attribute is `vec4`, and Lite makes the call a no-op when the mesh was created without
 * colours.
 *
 * @param engine - The engine that owns the buffer.
 * @param mesh - The mesh to update.
 * @param colors - Four floats per vertex.
 * @param vertexOffset - The first destination vertex to overwrite.
 * @param vertexCount - How many vertices to write.
 *
 * @internal
 */
export function updateMeshColors(
  engine: EngineContext,
  mesh: Mesh,
  colors: Float32Array,
  vertexOffset: number,
  vertexCount: number,
): void {
  liteUpdateMeshColors(engine, mesh, colors, vertexOffset, vertexCount);
}

/**
 * Writes a mesh's object-local bounding box.
 *
 * @remarks
 * `Mesh.boundMin`/`boundMax` are declared consumer-writable, and writing them is the only way to
 * keep the shadow fit, the thin-instance culler and the Havok shape extents honest after a partial
 * vertex update — none of the partial updaters recomputes them. The existing arrays are mutated in
 * place when they are there, so repeated sculpting allocates nothing.
 *
 * @param mesh - The mesh to re-bound.
 * @param minX - The smallest X.
 * @param minY - The smallest Y.
 * @param minZ - The smallest Z.
 * @param maxX - The largest X.
 * @param maxY - The largest Y.
 * @param maxZ - The largest Z.
 *
 * @internal
 */
export function setMeshBounds(
  mesh: Mesh,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): void {
  const boundMin = mesh.boundMin;
  if (boundMin === undefined) {
    mesh.boundMin = [minX, minY, minZ];
  } else {
    boundMin[0] = minX;
    boundMin[1] = minY;
    boundMin[2] = minZ;
  }
  const boundMax = mesh.boundMax;
  if (boundMax === undefined) {
    mesh.boundMax = [maxX, maxY, maxZ];
  } else {
    boundMax[0] = maxX;
    boundMax[1] = maxY;
    boundMax[2] = maxZ;
  }
}

/**
 * Gives a cloned mesh bounding-box arrays of its own.
 *
 * @remarks
 * `cloneMeshNode` shallow-spreads the template (`lib/scene/transform-node.js`), so a clone starts
 * out sharing the template's `boundMin`/`boundMax` arrays and {@link setMeshBounds} — which mutates
 * in place — would write through to the template and to every other clone. Any caller that re-bounds
 * one clone alone has to call this first.
 *
 * @param mesh - The clone.
 *
 * @internal
 */
export function detachMeshBounds(mesh: Mesh): void {
  const boundMin = mesh.boundMin;
  if (boundMin !== undefined) {
    mesh.boundMin = [boundMin[0], boundMin[1], boundMin[2]];
  }
  const boundMax = mesh.boundMax;
  if (boundMax !== undefined) {
    mesh.boundMax = [boundMax[0], boundMax[1], boundMax[2]];
  }
}

/**
 * Recomputes a mesh's object-local bounding box from a position array and writes it.
 *
 * @remarks
 * The partial vertex updaters leave `boundMin`/`boundMax` alone (see the module note), and every
 * consumer that fits a shadow cascade, culls a thin instance, or measures a Havok shape reads them.
 * One linear pass, no allocation. A position array too short to hold one vertex leaves the bounds
 * as they were.
 *
 * @param mesh - The mesh to re-bound.
 * @param positions - Three floats per vertex.
 *
 * @internal
 */
export function recomputeMeshBounds(mesh: Mesh, positions: Float32Array): void {
  if (positions.length < 3) {
    return;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    minX = x < minX ? x : minX;
    minY = y < minY ? y : minY;
    minZ = z < minZ ? z : minZ;
    maxX = x > maxX ? x : maxX;
    maxY = y > maxY ? y : maxY;
    maxZ = z > maxZ ? z : maxZ;
  }
  setMeshBounds(mesh, minX, minY, minZ, maxX, maxY, maxZ);
}

/**
 * Clones a template — mesh or transform-node subtree — and parents the clone under an entity node.
 *
 * @remarks
 * The clone shares the template's GPU buffers (see the module note). Cloning a mesh whose buffers
 * were already released throws, which is Lite's way of telling you the template outlived its asset.
 *
 * Only the `parent` link is written; the clone is deliberately **not** pushed into the parent's
 * `children` array, for the same reason cameras and lights are not (`./camera.ts`): ignifx
 * transform nodes are never added to a Lite scene, so nothing in Lite walks their children, and
 * `removeFromScene` nulls a removed mesh's `parent` without touching the array it was listed in —
 * so maintaining it would only create a stale entry to clean up.
 *
 * @param template - The mesh or subtree to clone.
 * @param parent - The entity's transform node, or `null` for world space.
 * @returns The cloned root. Add it to the scene with {@link addMeshToScene}.
 *
 * @internal
 */
export function cloneMeshUnderNode(template: SceneNode, parent: SceneNode | null): SceneNode {
  const clone = cloneTransformNode(template);
  clone.parent = parent;
  return clone;
}

/**
 * Adds a mesh — or a transform-node subtree containing meshes — to a render scene.
 *
 * @remarks
 * `addToScene` recurses into `children` and re-parents each one, so a whole instantiated model goes
 * in with one call. When the scene is already registered, the mesh joins Lite's runtime
 * material-swap queue and appears once its material family's renderable has been rebuilt
 * (`docs/architecture/07-rendering.md` §1.1 and ADR-0014).
 *
 * @param scene - The render scene.
 * @param node - The mesh or subtree root to add.
 *
 * @internal
 */
export function addMeshToScene(scene: SceneContext, node: SceneNode): void {
  addToScene(scene, node);
}

/**
 * Removes a mesh — and everything under it — from a render scene, releasing its GPU buffers when it
 * has left its last scene.
 *
 * @remarks
 * This is destruction, not hiding: use {@link setMeshSubtreeVisible} to hide.
 *
 * @param scene - The render scene.
 * @param node - The mesh or subtree root to remove.
 *
 * @internal
 */
export function removeMeshFromScene(scene: SceneContext, node: SceneNode): void {
  removeFromScene(scene, node);
}

/**
 * Shows or hides a mesh and everything under it.
 *
 * @param node - The subtree root.
 * @param visible - `true` to show it, `false` to hide it.
 *
 * @internal
 */
export function setMeshSubtreeVisible(node: SceneNode, visible: boolean): void {
  setSubtreeVisible(node, visible);
}

/**
 * Assigns a mesh's material.
 *
 * @remarks
 * `Mesh.material` is an accessor once the mesh has joined a scene: writing it queues a material
 * swap on every scene the mesh belongs to (`lib/scene/mesh-scene-registry.js`,
 * `installMaterialSetter`). Assigning the material the mesh already has is a no-op.
 *
 * @param mesh - The mesh to change.
 * @param material - The material to draw it with.
 *
 * @internal
 */
export function setMeshMaterial(mesh: Mesh, material: Material): void {
  mesh.material = material;
}

/**
 * Sets whether a mesh is darkened by shadow maps.
 *
 * @param mesh - The mesh to change.
 * @param receiveShadows - `true` to sample shadow maps on this mesh.
 *
 * @internal
 */
export function setMeshReceiveShadows(mesh: Mesh, receiveShadows: boolean): void {
  mesh.receiveShadows = receiveShadows;
}

/**
 * Sets a mesh's sort key within its phase. Lower values are drawn first.
 *
 * @param mesh - The mesh to change.
 * @param renderOrder - The sort key; it only orders within the opaque or the transparent phase.
 *
 * @internal
 */
export function setMeshRenderOrder(mesh: Mesh, renderOrder: number): void {
  mesh.renderOrder = renderOrder;
}

/**
 * Sets whether picking considers a mesh at all.
 *
 * @remarks
 * `pickable === false` removes the mesh from both the GPU picker's candidate list and the CPU ray
 * test, so it neither occludes nor returns a hit (`index.d.ts` 7214, `lib/picking/ray-pick.js`).
 *
 * @param mesh - The mesh to change.
 * @param pickable - `true` to allow picking.
 *
 * @internal
 */
export function setMeshPickable(mesh: Mesh, pickable: boolean): void {
  mesh.pickable = pickable;
}

/**
 * Gives a mesh the string id Lite's light include/exclude sets match on.
 *
 * @param mesh - The mesh to name.
 * @param id - The id. It should be unique within the scene.
 *
 * @internal
 */
export function setMeshId(mesh: Mesh, id: string): void {
  mesh.id = id;
}

/**
 * Replaces the materials of every mesh in a subtree whose current material carries one of the given
 * names.
 *
 * @remarks
 * `Material.name` is "populated by loaders from the source asset (e.g. the glTF material name) so
 * callers can look a material up by name" (`index.d.ts`), which is the identifier
 * `docs/architecture/07-rendering.md` §2.4 means by "by material name". Assigning `Mesh.material`
 * queues a material swap on every scene the mesh belongs to; assigning the material a mesh already
 * has is a no-op, so re-running this is cheap.
 *
 * @param node - The subtree root.
 * @param overrides - Source material name to replacement material.
 * @returns How many meshes were re-materialled.
 *
 * @internal
 */
export function overrideSubtreeMaterials(node: SceneNode, overrides: ReadonlyMap<string, Material>): number {
  let changed = 0;
  if ("material" in node) {
    // A scene node that carries `material` is a mesh —
    // the same structural test Lite's own scene walk uses.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const mesh = node as Mesh;
    const name = mesh.material.name;
    const replacement = name === undefined ? undefined : overrides.get(name);
    if (replacement !== undefined && replacement !== mesh.material) {
      mesh.material = replacement;
      changed += 1;
    }
  }
  const children = node.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      changed += overrideSubtreeMaterials(child, overrides);
    }
  }
  return changed;
}

/**
 * Releases a template mesh's GPU buffers.
 *
 * @remarks
 * Lite exports no mesh disposer: a mesh's buffers are freed only when it leaves its last scene
 * (`lib/scene/scene-remove.js`). A template that was never added to a scene therefore has to be
 * added and removed to be released, which is exactly what this does. Two consequences the caller
 * must respect:
 *
 * 1. The template must carry no material, or the round trip will build and immediately tear down a
 *    renderable for it. Templates created by the factories above start with none.
 * 2. Any clone still alive keeps the shared buffers: the reference count only reaches zero when the
 *    last co-owner has gone. Releasing the template while clones are in a scene is safe, but the
 *    template can no longer be cloned afterwards.
 *
 * @param scene - Any scene on the template's engine; it is used only as the round trip's vehicle.
 * @param template - The template to release.
 *
 * @internal
 */
export function disposeMeshTemplate(scene: SceneContext, template: Mesh): void {
  addToScene(scene, template);
  removeFromScene(scene, template);
}

/**
 * Collects every mesh in a subtree — the root included — in depth-first order.
 *
 * @remarks
 * A scene node that carries `material` is a mesh: the same structural test
 * {@link overrideSubtreeMaterials} and Lite's own scene walk use (`index.d.ts` 7156 declares
 * `material` on `Mesh` and nowhere on `SceneNode`, 10104).
 *
 * Call it **once**, when the subtree is instantiated. The clone tree `instantiateContainer` built
 * never changes shape afterwards, so walking it again every frame would put a recursion on the
 * render path for an answer that cannot have moved (coding standards §7).
 *
 * @param node - The subtree root.
 * @param out - The list the meshes are appended to; it is not cleared first.
 *
 * @internal
 */
export function collectSubtreeMeshes(node: SceneNode, out: Mesh[]): void {
  if ("material" in node) {
    // See the note above.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    out.push(node as Mesh);
  }
  const children = node.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child !== undefined) {
      collectSubtreeMeshes(child, out);
    }
  }
}
