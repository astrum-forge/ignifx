import {
  createBoxMesh,
  createCapsuleMesh,
  createCylinderMesh,
  createGroundMesh,
  createPlaneMesh,
  createSphereMesh,
  createTorusMesh,
  disposeMeshTemplate,
  recomputeMeshBounds,
  updateMeshColors,
  updateMeshNormals,
  updateMeshPositions,
  updateMeshUvs,
} from "../../lite/gpu/mesh.js";
import type { LiteMesh } from "../../lite/gpu/mesh.js";
import type { LiteEngine, LiteScene } from "../../lite/scene.js";
import type {
  BoxMeshOptions,
  CapsuleMeshOptions,
  CylinderMeshOptions,
  PlaneMeshOptions,
  SphereMeshOptions,
  TorusMeshOptions,
} from "../mesh-asset.js";

/**
 * The device-only half of `MeshAsset`: the Lite calls a template makes once it has an engine
 * (`docs/architecture/07-rendering.md` §6).
 *
 * Every function here takes the engine, mesh or scene as a nullable and returns early when it is
 * `null`, so the component keeps no headless branch of its own. It lives under `src/render/gpu/`
 * because that is where the render layer puts code every line of which needs `engine._device`.
 */

/**
 * Copies a readonly options record into the mutable shape Babylon Lite's factories take.
 *
 * @typeParam Options - Lite's option type.
 * @param options - What the caller declared, or `undefined`.
 * @returns A shallow copy, or `undefined`.
 */
function copyOptions<Options>(options: Options | undefined): Options | undefined {
  return options === undefined ? undefined : { ...options };
}

/**
 * Creates a box template.
 *
 * @param engine - The engine that owns the GPU buffers.
 * @param options - Size, or the per-axis record.
 * @returns The template.
 *
 * @internal
 */
export function buildBoxTemplate(engine: LiteEngine, options?: BoxMeshOptions): LiteMesh {
  return createBoxMesh(engine, copyOptions(options));
}

/**
 * Creates a sphere template.
 *
 * @param engine - The engine.
 * @param options - Diameter and ring count.
 * @returns The template.
 *
 * @internal
 */
export function buildSphereTemplate(engine: LiteEngine, options?: SphereMeshOptions): LiteMesh {
  return createSphereMesh(engine, copyOptions(options));
}

/**
 * Creates a plane template.
 *
 * @param engine - The engine.
 * @param options - Size.
 * @returns The template.
 *
 * @internal
 */
export function buildPlaneTemplate(engine: LiteEngine, options?: PlaneMeshOptions): LiteMesh {
  return createPlaneMesh(engine, copyOptions(options));
}

/**
 * Creates a ground template.
 *
 * @param engine - The engine.
 * @param options - Already converted to Lite's mutable shape by the caller.
 * @returns The template.
 *
 * @internal
 */
export function buildGroundTemplate(engine: LiteEngine, options?: Parameters<typeof createGroundMesh>[1]): LiteMesh {
  return createGroundMesh(engine, options);
}

/**
 * Creates a cylinder template.
 *
 * @param engine - The engine.
 * @param options - Height and diameters.
 * @returns The template.
 *
 * @internal
 */
export function buildCylinderTemplate(engine: LiteEngine, options?: CylinderMeshOptions): LiteMesh {
  return createCylinderMesh(engine, copyOptions(options));
}

/**
 * Creates a capsule template.
 *
 * @param engine - The engine.
 * @param options - Height, radius and tessellation.
 * @returns The template.
 *
 * @internal
 */
export function buildCapsuleTemplate(engine: LiteEngine, options?: CapsuleMeshOptions): LiteMesh {
  return createCapsuleMesh(engine, copyOptions(options));
}

/**
 * Creates a torus template.
 *
 * @param engine - The engine.
 * @param options - Diameter, thickness and tessellation.
 * @returns The template.
 *
 * @internal
 */
export function buildTorusTemplate(engine: LiteEngine, options?: TorusMeshOptions): LiteMesh {
  return createTorusMesh(engine, copyOptions(options));
}

/**
 * Re-uploads a vertex range and re-fits the bounds, when there is a device.
 *
 * @param engine - The engine, or `null` under a headless app.
 * @param mesh - The template, or `null`.
 * @param data - The caller's floats.
 * @param vertexOffset - The first vertex to overwrite.
 * @param count - How many vertices to write.
 * @param positions - The asset's own position array, which the bounds are recomputed from.
 *
 * @internal
 */
export function uploadMeshPositions(
  engine: LiteEngine | null,
  mesh: LiteMesh | null,
  data: Float32Array,
  vertexOffset: number,
  count: number,
  positions: Float32Array,
): void {
  if (engine === null || mesh === null) {
    return;
  }
  updateMeshPositions(engine, mesh, data, vertexOffset, count);
  recomputeMeshBounds(mesh, positions);
}

/**
 * Re-uploads a vertex-normal range, when there is a device.
 *
 * @param engine - The engine, or `null`.
 * @param mesh - The template, or `null`.
 * @param data - Three floats per vertex.
 * @param vertexOffset - The first vertex to overwrite.
 * @param count - How many vertices to write.
 *
 * @internal
 */
export function uploadMeshNormals(
  engine: LiteEngine | null,
  mesh: LiteMesh | null,
  data: Float32Array,
  vertexOffset: number,
  count: number,
): void {
  if (engine === null || mesh === null) {
    return;
  }
  updateMeshNormals(engine, mesh, data, vertexOffset, count);
}

/**
 * Re-uploads a UV range, when there is a device.
 *
 * @param engine - The engine, or `null`.
 * @param mesh - The template, or `null`.
 * @param data - Two floats per vertex.
 * @param vertexOffset - The first vertex to overwrite.
 * @param count - How many vertices to write.
 *
 * @internal
 */
export function uploadMeshUvs(
  engine: LiteEngine | null,
  mesh: LiteMesh | null,
  data: Float32Array,
  vertexOffset: number,
  count: number,
): void {
  if (engine === null || mesh === null) {
    return;
  }
  updateMeshUvs(engine, mesh, data, vertexOffset, count);
}

/**
 * Re-uploads a vertex-colour range, when there is a device.
 *
 * @param engine - The engine, or `null`.
 * @param mesh - The template, or `null`.
 * @param data - Four floats per vertex.
 * @param vertexOffset - The first vertex to overwrite.
 * @param count - How many vertices to write.
 *
 * @internal
 */
export function uploadMeshColors(
  engine: LiteEngine | null,
  mesh: LiteMesh | null,
  data: Float32Array,
  vertexOffset: number,
  count: number,
): void {
  if (engine === null || mesh === null) {
    return;
  }
  updateMeshColors(engine, mesh, data, vertexOffset, count);
}

/**
 * Frees a template's GPU buffers, when it has any.
 *
 * @param scene - The scene it belongs to, or `null`.
 * @param mesh - The template, or `null`.
 *
 * @internal
 */
export function releaseMeshTemplate(scene: LiteScene | null, mesh: LiteMesh | null): void {
  if (scene === null || mesh === null) {
    return;
  }
  disposeMeshTemplate(scene, mesh);
}

/** What a template needs to remember about the device it was built on. */
export interface MeshTemplateHandles {
  /** The Lite mesh, or `null` under a headless app. */
  readonly mesh: LiteMesh | null;
  /** The scene the template belongs to, or `null`. */
  readonly scene: LiteScene | null;
  /** The engine that owns its buffers, or `null`. */
  readonly engine: LiteEngine | null;
}

/**
 * Builds a template and collects the Lite handles it has to keep, or three nulls when headless.
 *
 * @param isHeadless - Whether the app has a device.
 * @param scene - The app's render scene.
 * @param engine - The app's engine.
 * @param build - Creates the mesh; called only when there is a device.
 * @returns The handles.
 *
 * @internal
 */
export function buildMeshTemplate(
  isHeadless: boolean,
  scene: LiteScene,
  engine: LiteEngine,
  build: (engine: LiteEngine) => LiteMesh,
): MeshTemplateHandles {
  if (isHeadless) {
    return { mesh: null, scene: null, engine: null };
  }
  return { mesh: build(engine), scene, engine };
}
