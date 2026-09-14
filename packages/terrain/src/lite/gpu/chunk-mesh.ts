import {
  addToScene,
  createMeshFromData,
  removeFromScene,
  setSubtreeVisible,
  updateMeshNormals,
  updateMeshPositions,
} from "@babylonjs/lite";
import type { EngineContext, Material, Mesh, SceneContext, SceneNode } from "@babylonjs/lite";

/**
 * The chunk-mesh half of the terrain's Babylon Lite adapter
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2, `docs/architecture/07-rendering.md` §2.3).
 *
 * Terrain chunks are renderables that are not entities, so they cannot go through `MeshRenderer`;
 * this is the only file that touches Lite for them. Two facts drive the shapes below, both verified
 * against `@babylonjs/lite@1.27.0`: visibility must go through `setSubtreeVisible` (`index.d.ts`
 * 11199), because a direct `visible` write takes no effect until the visibility epoch bumps; and
 * removing a mesh from its last scene disposes it, so hiding is never removal.
 */

/**
 * The Babylon Lite mesh a terrain chunk is, under an ignifx name.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteChunkMesh = Mesh;

/**
 * The Babylon Lite node a terrain's chunks are parented under, under an ignifx name.
 *
 * @remarks
 * Unstable; excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteChunkNode = SceneNode;

/**
 * Creates one chunk mesh from its arrays, parents it, gives it a material, and adds it to the scene
 * hidden.
 *
 * @remarks
 * The material is assigned **before** `addToScene`: Lite buckets a mesh by its material's build
 * group on the way in, and a mesh that arrives without one leaves the render pass presenting
 * nothing (core measured this on SwiftShader, 2026-09-05). Starting hidden means the LOD system,
 * not the upload, decides which level shows first.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param scene - The render scene.
 * @param name - A debug name.
 * @param parent - The terrain entity's node.
 * @param material - The terrain's material.
 * @param positions - Three floats per vertex; retained by Lite.
 * @param normals - Three floats per vertex; retained by Lite.
 * @param uvs - Two floats per vertex; retained by Lite.
 * @param indices - Three indices per triangle; retained by Lite.
 * @returns The mesh, in the scene, hidden.
 *
 * @internal
 */
export function createChunkMesh(
  engine: EngineContext,
  scene: SceneContext,
  name: string,
  parent: SceneNode,
  material: Material,
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
): Mesh {
  const mesh = createMeshFromData(engine, name, positions, normals, indices, uvs);
  mesh.parent = parent;
  mesh.material = material;
  mesh.pickable = false;
  setSubtreeVisible(mesh, false);
  addToScene(scene, mesh);
  return mesh;
}

/**
 * Re-uploads a chunk's positions and normals after a sculpt, and rewrites its local bounds.
 *
 * @param engine - The engine that owns the buffers.
 * @param mesh - The chunk.
 * @param positions - Three floats per vertex, the whole mesh.
 * @param normals - Three floats per vertex, the whole mesh.
 * @param bounds - `[minX, minY, minZ, maxX, maxY, maxZ]` in the terrain's local frame.
 *
 * @internal
 */
export function updateChunkMesh(
  engine: EngineContext,
  mesh: Mesh,
  positions: Float32Array,
  normals: Float32Array,
  bounds: Float32Array,
): void {
  const vertexCount = positions.length / 3;
  updateMeshPositions(engine, mesh, positions, 0, vertexCount);
  updateMeshNormals(engine, mesh, normals, 0, vertexCount);
  setChunkBounds(mesh, bounds);
}

/**
 * Writes a chunk's object-local bounding box.
 *
 * @param mesh - The chunk.
 * @param bounds - `[minX, minY, minZ, maxX, maxY, maxZ]`.
 *
 * @internal
 */
export function setChunkBounds(mesh: Mesh, bounds: Float32Array): void {
  const min = mesh.boundMin;
  if (min === undefined) {
    mesh.boundMin = [bounds[0] ?? 0, bounds[1] ?? 0, bounds[2] ?? 0];
  } else {
    min[0] = bounds[0] ?? 0;
    min[1] = bounds[1] ?? 0;
    min[2] = bounds[2] ?? 0;
  }
  const max = mesh.boundMax;
  if (max === undefined) {
    mesh.boundMax = [bounds[3] ?? 0, bounds[4] ?? 0, bounds[5] ?? 0];
  } else {
    max[0] = bounds[3] ?? 0;
    max[1] = bounds[4] ?? 0;
    max[2] = bounds[5] ?? 0;
  }
}

/**
 * Shows or hides a chunk. A same-value call is a no-op inside Lite, so the LOD system may call it
 * every frame for every chunk without forcing a bundle re-record.
 *
 * @param mesh - The chunk.
 * @param visible - Whether it draws.
 *
 * @internal
 */
export function setChunkVisible(mesh: Mesh, visible: boolean): void {
  setSubtreeVisible(mesh, visible);
}

/**
 * Assigns a chunk's material. Assigning the one it already has is a no-op.
 *
 * @param mesh - The chunk.
 * @param material - The material.
 *
 * @internal
 */
export function setChunkMaterial(mesh: Mesh, material: Material): void {
  mesh.material = material;
}

/**
 * Sets whether shadow maps darken a chunk.
 *
 * @param mesh - The chunk.
 * @param receiveShadows - `true` to sample shadow maps.
 *
 * @internal
 */
export function setChunkReceiveShadows(mesh: Mesh, receiveShadows: boolean): void {
  mesh.receiveShadows = receiveShadows;
}

/**
 * Sets whether picking considers a chunk.
 *
 * @param mesh - The chunk.
 * @param pickable - `true` to allow picking.
 *
 * @internal
 */
export function setChunkPickable(mesh: Mesh, pickable: boolean): void {
  mesh.pickable = pickable;
}

/**
 * Removes a chunk from the scene, which releases its GPU buffers. Destruction, not hiding.
 *
 * @param scene - The render scene.
 * @param mesh - The chunk.
 *
 * @internal
 */
export function destroyChunkMesh(scene: SceneContext, mesh: Mesh): void {
  removeFromScene(scene, mesh);
}
