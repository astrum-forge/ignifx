import {
  createBoxMesh,
  createCapsuleMesh,
  createCylinderMesh,
  createGroundMesh,
  createMeshFromGeometry,
  createPlaneMesh,
  createSphereMesh,
  createTorusMesh,
  disposeMeshTemplate,
} from "../lite/gpu/mesh.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { LiteScene } from "../lite/scene.js";

/**
 * `MeshAsset` (`docs/architecture/07-rendering.md` §2.3): the geometry template a `MeshRenderer`
 * clones. One upload, many renderers — `cloneTransformNode` shallow-clones a mesh and shares its
 * `_gpu` wrapper under a reference count, so N renderers of one asset cost one set of vertex
 * buffers (ADR-0002 Validation, `src/lite/gpu/mesh.ts`).
 *
 * ## Why the factories return handles
 *
 * `MeshRenderer.mesh` is an `asset(MeshAsset)` field, and since Phase 2 the runtime value of an
 * `asset()` field is an `AssetHandle` (`05-assets-and-loading.md` §3). A primitive built in code
 * therefore has to be *published* before a renderer can hold it, which is what `Assets.register`
 * does: the factories below register the template under a `memory:mesh/<n>` address and hand back
 * the handle, already loaded, with one holder — the caller.
 *
 * Ownership follows from that. The caller releases the handle (or lets a `using` block do it); the
 * collector then runs the `mesh` type's `unload`, which is {@link MeshAsset.dispose}. Releasing
 * while renderers still hold clones is safe — Lite frees the shared buffers only when the last
 * co-owner has gone — but the template can no longer be cloned afterwards.
 *
 * ## Headless
 *
 * Every Lite mesh factory uploads through `engine._device`, which the null engine does not have
 * (`07-rendering.md` §6). Under a headless app a `MeshAsset` therefore carries no geometry:
 * `lite.mesh` is `null`, `dispose()` is a no-op, and a `MeshRenderer` that holds it keeps its state
 * without touching the scene. Tests assert on component state, not on Lite scene contents.
 */

/**
 * The asset type primitives are registered under.
 *
 * @public
 */
export const MESH_ASSET_TYPE = "mesh";

/**
 * How {@link MeshAsset.box} sizes its box, in metres. Give `size` for a cube, or the three
 * dimensions.
 *
 * @public
 */
export interface BoxMeshOptions {
  /** Edge length on every axis. */
  readonly size?: number;
  /** Size along X, overriding `size`. */
  readonly width?: number;
  /** Size along Y, overriding `size`. */
  readonly height?: number;
  /** Size along Z, overriding `size`. */
  readonly depth?: number;
}

/**
 * How {@link MeshAsset.sphere} tessellates its sphere.
 *
 * @public
 */
export interface SphereMeshOptions {
  /** Diameter on every axis, in metres. Lite defaults to 1. */
  readonly diameter?: number;
  /** Ring count; higher is smoother. Lite defaults to 32. */
  readonly segments?: number;
}

/**
 * How {@link MeshAsset.plane} sizes its quad, which lies in the XY plane facing `-Z`.
 *
 * @public
 */
export interface PlaneMeshOptions {
  /** Edge length on both axes, in metres. */
  readonly size?: number;
  /** Width, overriding `size`. */
  readonly width?: number;
  /** Height, overriding `size`. */
  readonly height?: number;
}

/**
 * How {@link MeshAsset.ground} sizes and subdivides its grid, which lies in the XZ plane facing
 * `+Y`.
 *
 * @public
 */
export interface GroundMeshOptions {
  /** Size along X, in metres. */
  readonly width?: number;
  /** Size along Z, in metres. */
  readonly height?: number;
  /** Quads per side. */
  readonly subdivisions?: number;
  /** UV multiplier, for tiling a texture across the grid. */
  readonly uvScale?: readonly [number, number];
}

/**
 * How {@link MeshAsset.cylinder} sizes its cylinder, which stands along Y.
 *
 * @public
 */
export interface CylinderMeshOptions {
  /** Height along Y, in metres. */
  readonly height?: number;
  /** Diameter of both ends. */
  readonly diameter?: number;
  /** Diameter of the top cap, overriding `diameter` — a cone is `diameterTop: 0`. */
  readonly diameterTop?: number;
  /** Diameter of the bottom cap, overriding `diameter`. */
  readonly diameterBottom?: number;
  /** Radial segment count. */
  readonly tessellation?: number;
}

/**
 * How {@link MeshAsset.capsule} sizes its capsule, which stands along Y.
 *
 * @remarks
 * `height` is the **total** height including both caps, the same convention `@ignifx/physics` uses
 * for a capsule collider, so one pair of numbers describes both.
 *
 * @public
 */
export interface CapsuleMeshOptions {
  /** Total height including both caps, in metres. */
  readonly height?: number;
  /** Radius of the body and the caps. */
  readonly radius?: number;
  /** Radial segment count. */
  readonly tessellation?: number;
}

/**
 * How {@link MeshAsset.torus} sizes its ring, which lies in the XZ plane.
 *
 * @public
 */
export interface TorusMeshOptions {
  /** Outer diameter, in metres. */
  readonly diameter?: number;
  /** Tube thickness, in metres. */
  readonly thickness?: number;
  /** Segment count around the ring. */
  readonly tessellation?: number;
}

/**
 * Raw vertex data for {@link MeshAsset.fromData}.
 *
 * @remarks
 * Lite keeps references to these arrays rather than copying them — they are what its CPU ray pick
 * and its bounds read (`lib/mesh/mesh-factories.js`) — so a caller must not mutate them afterwards.
 *
 * @public
 */
export interface MeshGeometryData {
  /** Three floats per vertex. */
  readonly positions: Float32Array;
  /** Three floats per vertex, one normal each. */
  readonly normals: Float32Array;
  /** Three indices per triangle. */
  readonly indices: Uint32Array;
  /** Two floats per vertex, or omitted for a mesh with no texture coordinates. */
  readonly uvs?: Float32Array;
}

/**
 * The Babylon Lite objects a {@link MeshAsset} owns. Unstable escape hatch
 * (`docs/architecture/00-overview.md` §3).
 *
 * @public
 */
export interface MeshAssetLiteHandles {
  /** The template mesh, or `null` under a headless app, which uploads no geometry. */
  readonly mesh: LiteMesh | null;
}

/**
 * A geometry template a `MeshRenderer` draws (`docs/architecture/07-rendering.md` §2.3).
 *
 * @remarks
 * Build one with a primitive factory or {@link MeshAsset.fromData}; each returns the handle the
 * `MeshRenderer.mesh` field takes. A mesh that came from a file arrives as part of a `ModelAsset`
 * instead — a glTF is a tree of meshes, materials, and animations, not one buffer.
 *
 * @example
 * ```ts
 * using box = MeshAsset.box(app, { size: 2 });
 * const cube = app.world.createEntity("Cube");
 * cube.addComponent(MeshRenderer, { mesh: box.retain() });
 * ```
 *
 * @public
 */
export class MeshAsset {
  /** The type name the asset service registers meshes under. */
  static assetType: string = MESH_ASSET_TYPE;

  /** A human-readable name, used in diagnostics and as the Lite mesh's name. */
  readonly name: string;

  readonly #scene: LiteScene | null;

  #mesh: LiteMesh | null;

  #isDisposed = false;

  /**
   * Wraps a template mesh. Use the static factories; the engine constructs assets.
   *
   * @param name - A human-readable name.
   * @param mesh - The template, or `null` when the app is headless.
   * @param scene - The scene the template is released through, or `null` when there is nothing to
   * release.
   *
   * @internal
   */
  constructor(name: string, mesh: LiteMesh | null, scene: LiteScene | null) {
    this.name = name;
    this.#mesh = mesh;
    this.#scene = scene;
  }

  /**
   * The Babylon Lite objects the asset owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The template mesh, or `null` under a headless app.
   */
  get lite(): MeshAssetLiteHandles {
    return { mesh: this.#mesh };
  }

  /**
   * Whether the template's GPU buffers have been released.
   *
   * @returns `true` once {@link MeshAsset.dispose} has run.
   */
  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  /**
   * Releases the template's GPU buffers.
   *
   * @remarks
   * Lite exports no mesh disposer: a mesh's buffers are freed when it leaves its last scene, so the
   * adapter adds the template to a scene and takes it straight out again
   * (`src/lite/gpu/mesh.ts`). Clones still in a scene keep the shared buffers alive; what the
   * template loses is the ability to be cloned again. Calling it twice is a no-op, and it is a
   * no-op under a headless app, which has no buffers.
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    const mesh = this.#mesh;
    const scene = this.#scene;
    this.#mesh = null;
    if (mesh !== null && scene !== null) {
      disposeMeshTemplate(scene, mesh);
    }
  }

  /** Releases the template when the asset leaves a `using` block. */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Creates a box template and publishes it.
   *
   * @param app - The app whose engine uploads the geometry and whose asset service holds the handle.
   * @param options - A uniform `size`, or per-axis dimensions.
   * @returns The handle, with one holder — the caller.
   *
   * @example
   * ```ts
   * const box = MeshAsset.box(app, { width: 2, height: 1, depth: 3 });
   * ```
   */
  static box(app: App, options?: BoxMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "box", () =>
      createBoxMesh(app.lite.engine, options === undefined ? undefined : { ...options }),
    );
  }

  /**
   * Creates a sphere template and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Diameter and ring count.
   * @returns The handle, with one holder.
   */
  static sphere(app: App, options?: SphereMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "sphere", () =>
      createSphereMesh(app.lite.engine, options === undefined ? undefined : { ...options }),
    );
  }

  /**
   * Creates a quad template in the XY plane and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - A uniform `size`, or width and height.
   * @returns The handle, with one holder.
   */
  static plane(app: App, options?: PlaneMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "plane", () =>
      createPlaneMesh(app.lite.engine, options === undefined ? undefined : { ...options }),
    );
  }

  /**
   * Creates a subdivided grid in the XZ plane and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Width, depth, subdivisions, and UV scale.
   * @returns The handle, with one holder.
   */
  static ground(app: App, options?: GroundMeshOptions): AssetHandle<MeshAsset> {
    const lite = toGroundOptions(options);
    return publish(app, "ground", () => createGroundMesh(app.lite.engine, lite));
  }

  /**
   * Creates a cylinder template standing along Y and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Height, diameters, and tessellation.
   * @returns The handle, with one holder.
   */
  static cylinder(app: App, options?: CylinderMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "cylinder", () =>
      createCylinderMesh(app.lite.engine, options === undefined ? undefined : { ...options }),
    );
  }

  /**
   * Creates a capsule template standing along Y and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Total height, radius, and tessellation.
   * @returns The handle, with one holder.
   */
  static capsule(app: App, options?: CapsuleMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "capsule", () =>
      createCapsuleMesh(app.lite.engine, options === undefined ? undefined : { ...options }),
    );
  }

  /**
   * Creates a torus template in the XZ plane and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Diameter, thickness, and tessellation.
   * @returns The handle, with one holder.
   */
  static torus(app: App, options?: TorusMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "torus", () =>
      createTorusMesh(app.lite.engine, options === undefined ? undefined : { ...options }),
    );
  }

  /**
   * Creates a template from raw vertex data and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param name - A human-readable name.
   * @param data - Positions, normals, indices, and optional texture coordinates. Lite keeps
   * references to the arrays; do not mutate them afterwards.
   * @returns The handle, with one holder.
   *
   * @example
   * ```ts
   * const triangle = MeshAsset.fromData(app, "triangle", {
   *   positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
   *   normals: Float32Array.from([0, 0, -1, 0, 0, -1, 0, 0, -1]),
   *   indices: Uint32Array.from([0, 1, 2]),
   * });
   * ```
   */
  static fromData(app: App, name: string, data: MeshGeometryData): AssetHandle<MeshAsset> {
    return publish(app, name, () =>
      createMeshFromGeometry(app.lite.engine, name, data.positions, data.normals, data.indices, data.uvs),
    );
  }
}

/**
 * Copies the ignifx ground options onto Lite's, which types `uvScale` as a mutable tuple.
 *
 * @param options - The declared options.
 * @returns Lite's options, or `undefined` when the caller declared none.
 */
function toGroundOptions(
  options: GroundMeshOptions | undefined,
): { width?: number; height?: number; subdivisions?: number; uvScale?: [number, number] } | undefined {
  if (options === undefined) {
    return undefined;
  }
  const result: { width?: number; height?: number; subdivisions?: number; uvScale?: [number, number] } = {};
  if (options.width !== undefined) {
    result.width = options.width;
  }
  if (options.height !== undefined) {
    result.height = options.height;
  }
  if (options.subdivisions !== undefined) {
    result.subdivisions = options.subdivisions;
  }
  const uvScale = options.uvScale;
  if (uvScale !== undefined) {
    result.uvScale = [uvScale[0], uvScale[1]];
  }
  return result;
}

/**
 * Builds a template — skipping the upload under a headless app — and registers it as an in-memory
 * asset.
 *
 * @param app - The app that owns the engine and the asset service.
 * @param name - A human-readable name.
 * @param build - Creates the Lite mesh. Never called when the app is headless.
 * @returns The handle, with one holder.
 */
function publish(app: App, name: string, build: () => LiteMesh): AssetHandle<MeshAsset> {
  const scene = app.lite.scene;
  const mesh = app.isHeadless ? null : build();
  return app.assets.register(new MeshAsset(name, mesh, app.isHeadless ? null : scene), { type: MESH_ASSET_TYPE });
}
