import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { LiteMaterial } from "../lite/material.js";
import type { LiteSceneNode, NodeTag } from "../lite/node.js";
import type { InstancedMeshInstance, InstancedLodFields } from "./gpu/instanced-mesh-instance.js";
import type { LiteScene } from "../lite/scene.js";

/**
 * The gate `InstancedMeshRenderer` reaches its Babylon Lite adapter through
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §3.5, "Bundle cost" in §3.1).
 *
 * The component is registered by the core extension, so it is in every app's static graph; Lite's
 * thin-instance code is not, and a game that draws no instance cloud must not pay for it
 * (`CONSTITUTION.md` §2.5). The component declares the load in `onAttach` through
 * `renderer.requireGpuAdapter`, which is what makes `app.start()` wait for the chunk before its one
 * reconciliation — Lite bakes thin-instance culling and LOD pairings at `registerScene`.
 */

/** The part of `./gpu/instanced-mesh-instance.ts` the component calls. */
export interface InstancedMeshSupport {
  /** Builds the live meshes, filling in the LOD pairing when both templates exist. */
  createInstancedMesh(
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
  ): InstancedMeshInstance;
  /** Removes the meshes from the scene, when there are any. */
  releaseInstancedMesh(instance: InstancedMeshInstance | null, scene: LiteScene): boolean;
}

/** The dynamically imported adapter, memoised for the process. */
let layer: InstancedMeshSupport | null = null;

/**
 * Loads the thin-instance adapter, once per process.
 *
 * @returns The adapter.
 *
 * @internal
 */
export async function loadInstancedMeshSupport(): Promise<InstancedMeshSupport> {
  // The annotation is what checks `InstancedMeshSupport` against the module it stands for.
  const loaded: InstancedMeshSupport = layer ?? (await import("./gpu/instanced-mesh-instance.js"));
  layer = loaded;
  return loaded;
}

/**
 * The thin-instance adapter, if it has been loaded.
 *
 * @returns The adapter, or `null` before the first `InstancedMeshRenderer` attached on a device.
 *
 * @internal
 */
export function instancedMeshSupport(): InstancedMeshSupport | null {
  return layer;
}
