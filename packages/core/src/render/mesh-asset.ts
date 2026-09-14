import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import { createMeshFromGeometry } from "../lite/gpu/mesh.js";
import {
  buildBoxTemplate,
  buildCapsuleTemplate,
  buildCylinderTemplate,
  buildGroundTemplate,
  buildMeshTemplate,
  buildPlaneTemplate,
  buildSphereTemplate,
  buildTorusTemplate,
  releaseMeshTemplate,
  uploadMeshColors,
  uploadMeshNormals,
  uploadMeshPositions,
  uploadMeshUvs,
} from "./gpu/mesh-template.js";
import type { App } from "../app/types.js";
import type { AssetHandle } from "../assets/types.js";
import type { LiteMesh } from "../lite/gpu/mesh.js";
import type { LiteEngine, LiteScene } from "../lite/scene.js";

/**
 * Mesh templates share geometry with renderer clones (ADR-0002).
 * Factories register a loaded handle with one caller-owned hold; release it when no longer needed.
 * Existing clones survive collection, but a disposed template cannot make new clones.
 * Headless mesh assets keep component state without GPU geometry.
 */

/**
 * The asset type primitives are registered under.
 *
 * @public
 */
export const MESH_ASSET_TYPE = "mesh";

/** Floats per vertex in the position attribute. */
const FLOATS_PER_POSITION = 3;

/** Floats per vertex in the normal attribute. */
const FLOATS_PER_NORMAL = 3;

/** Floats per vertex in a UV attribute. */
const FLOATS_PER_UV = 2;

/** Floats per vertex in the colour attribute — Lite's colour attribute is `vec4`. */
const FLOATS_PER_COLOR = 4;

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
 * and its bounds read (`lib/mesh/mesh-factories.js`). Mutating one behind Lite's back changes what
 * a pick reports without changing what the GPU draws; the sanctioned way to change geometry after
 * the fact is {@link MeshAsset.updatePositions} and its three siblings, which re-upload, keep this
 * copy in step, and re-fit the bounds.
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
  /**
   * Two floats per vertex for the second UV set (`uv2` in a shader), or omitted. Lightmaps, baked
   * ambient occlusion, and the parent-LOD height a terrain morph reads all ride here.
   */
  readonly uvs2?: Float32Array;
  /** Four floats per vertex — `xyz` plus a handedness `w` — or omitted. A normal map needs them. */
  readonly tangents?: Float32Array;
  /**
   * Four floats per vertex, linear RGBA, or omitted. A material has to be one that reads the colour
   * attribute; set `hasVertexAlpha` on the Lite mesh if the alpha is meant to blend.
   */
  readonly colors?: Float32Array;
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

  readonly #geometry: MeshGeometryData | null;

  readonly #engine: LiteEngine | null;

  #mesh: LiteMesh | null;

  #isDisposed = false;

  /**
   * Wraps a template mesh. Use the static factories; the engine constructs assets.
   *
   * @param name - A human-readable name.
   * @param mesh - The template, or `null` when the app is headless.
   * @param scene - The scene the template is released through, or `null` when there is nothing to
   * release.
   * @param geometry - The vertex arrays the asset was built from, when it came from
   * {@link MeshAsset.fromData}; `null` for a primitive, whose arrays Lite generated and never
   * handed back. It is what makes the `update*` methods legal.
   * @param engine - The engine an update writes through, or `null` under a headless app.
   *
   * @internal
   */
  constructor(
    name: string,
    mesh: LiteMesh | null,
    scene: LiteScene | null,
    geometry: MeshGeometryData | null = null,
    engine: LiteEngine | null = null,
  ) {
    this.name = name;
    this.#mesh = mesh;
    this.#scene = scene;
    this.#geometry = geometry;
    this.#engine = engine;
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
   * How many vertices the geometry has.
   *
   * @remarks
   * Known for a mesh built with {@link MeshAsset.fromData} — headless included — and `0` for a
   * primitive: Lite generates a primitive's arrays internally and 1.27.0's `Mesh` exposes no vertex
   * count, only the opaque `MeshGPU` handle it says a user never touches (`index.d.ts` 7230).
   *
   * @returns The vertex count, or `0`.
   */
  get vertexCount(): number {
    const geometry = this.#geometry;
    return geometry === null ? 0 : geometry.positions.length / FLOATS_PER_POSITION;
  }

  /**
   * How many indices the geometry has — three per triangle.
   *
   * @returns The index count, or `0`; see {@link MeshAsset.vertexCount}.
   */
  get indexCount(): number {
    return this.#geometry?.indices.length ?? 0;
  }

  /**
   * Re-uploads vertex positions and re-fits the bounds.
   *
   * @remarks
   * Only a mesh from {@link MeshAsset.fromData} can be updated, and only while nothing has cloned it:
   * Lite refuses to write a vertex buffer with more than one owner, and a `MeshRenderer` clone is a
   * second owner.
   *
   * Lite's `updateMeshPositions` writes the GPU buffer and stops there, so this also copies the range
   * into the asset's own position array — the one Lite retained and CPU picking reads — and rewrites
   * the bounds from the whole of it, `O(vertexCount)` per call. Passing the asset's own array skips
   * the copy.
   *
   * @param data - Three floats per vertex, read from index 0.
   * @param vertexOffset - The first vertex to overwrite. Defaults to `0`.
   * @param vertexCount - How many vertices to write. Defaults to as many as `data` holds.
   * @throws IgnifxError with code `IGX-0702` when the mesh did not come from
   * {@link MeshAsset.fromData}, or has been disposed.
   * @throws IgnifxError with code `IGX-0725` when the range falls outside the mesh or `data` is too
   * short for it.
   *
   * @example
   * ```ts
   * const grid = MeshAsset.fromData(app, "grid", { positions, normals, indices });
   * positions[1] += 0.5;
   * grid.value.updatePositions(positions);
   * ```
   */
  updatePositions(data: Float32Array, vertexOffset = 0, vertexCount?: number): void {
    const geometry = this.#requireGeometry("updatePositions");
    const count = this.#resolveRange("updatePositions", data, FLOATS_PER_POSITION, vertexOffset, vertexCount);
    copyRange(data, geometry.positions, FLOATS_PER_POSITION, vertexOffset, count);
    uploadMeshPositions(this.#engine, this.#mesh, data, vertexOffset, count, geometry.positions);
  }

  /**
   * Re-uploads vertex normals.
   *
   * @remarks
   * The same rules as {@link MeshAsset.updatePositions}, minus the bounds: a normal cannot move a
   * bounding box. The range is copied into the asset's own normal array so that a later
   * `updatePositions` sees a consistent mesh.
   *
   * @param data - Three floats per vertex.
   * @param vertexOffset - The first vertex to overwrite. Defaults to `0`.
   * @param vertexCount - How many vertices to write. Defaults to as many as `data` holds.
   * @throws IgnifxError with code `IGX-0702` or `IGX-0725`; see
   * {@link MeshAsset.updatePositions}.
   */
  updateNormals(data: Float32Array, vertexOffset = 0, vertexCount?: number): void {
    const geometry = this.#requireGeometry("updateNormals");
    const count = this.#resolveRange("updateNormals", data, FLOATS_PER_NORMAL, vertexOffset, vertexCount);
    copyRange(data, geometry.normals, FLOATS_PER_NORMAL, vertexOffset, count);
    uploadMeshNormals(this.#engine, this.#mesh, data, vertexOffset, count);
  }

  /**
   * Re-uploads texture coordinates.
   *
   * @remarks
   * Lite makes the upload a **no-op** when the mesh was created without UVs, rather than an error,
   * so a mesh whose `MeshGeometryData` named none silently ignores this. The range check still runs.
   *
   * @param data - Two floats per vertex.
   * @param vertexOffset - The first vertex to overwrite. Defaults to `0`.
   * @param vertexCount - How many vertices to write. Defaults to as many as `data` holds.
   * @throws IgnifxError with code `IGX-0702` or `IGX-0725`; see
   * {@link MeshAsset.updatePositions}.
   */
  updateUvs(data: Float32Array, vertexOffset = 0, vertexCount?: number): void {
    const geometry = this.#requireGeometry("updateUvs");
    const count = this.#resolveRange("updateUvs", data, FLOATS_PER_UV, vertexOffset, vertexCount);
    const retained = geometry.uvs;
    if (retained !== undefined) {
      copyRange(data, retained, FLOATS_PER_UV, vertexOffset, count);
    }
    uploadMeshUvs(this.#engine, this.#mesh, data, vertexOffset, count);
  }

  /**
   * Re-uploads vertex colours.
   *
   * @remarks
   * Four floats per vertex, linear RGBA. A no-op on the GPU when the mesh was created without
   * colours, exactly as {@link MeshAsset.updateUvs} is.
   *
   * @param data - Four floats per vertex.
   * @param vertexOffset - The first vertex to overwrite. Defaults to `0`.
   * @param vertexCount - How many vertices to write. Defaults to as many as `data` holds.
   * @throws IgnifxError with code `IGX-0702` or `IGX-0725`; see
   * {@link MeshAsset.updatePositions}.
   */
  updateColors(data: Float32Array, vertexOffset = 0, vertexCount?: number): void {
    const geometry = this.#requireGeometry("updateColors");
    const count = this.#resolveRange("updateColors", data, FLOATS_PER_COLOR, vertexOffset, vertexCount);
    const retained = geometry.colors;
    if (retained !== undefined) {
      copyRange(data, retained, FLOATS_PER_COLOR, vertexOffset, count);
    }
    uploadMeshColors(this.#engine, this.#mesh, data, vertexOffset, count);
  }

  /**
   * The retained geometry, or a misuse error.
   *
   * @param member - The method name the error names.
   * @returns The geometry arrays.
   * @throws IgnifxError with code `IGX-0702` when there are none.
   */
  #requireGeometry(member: string): MeshGeometryData {
    const geometry = this.#geometry;
    if (geometry !== null && !this.#isDisposed) {
      return geometry;
    }
    throw new IgnifxError(
      CoreErrorCode.invalidRuntime,
      `${this.name} was ${this.#isDisposed ? "disposed" : "not created by MeshAsset.fromData"}, so ` +
        `${member}() cannot run.`,
      {
        context: { asset: this.name, member: `MeshAsset.${member}()` },
        hint: "Only a mesh built with MeshAsset.fromData carries the vertex arrays an update validates against.",
      },
    );
  }

  /**
   * Resolves and checks an update's vertex range.
   *
   * @param member - The method name the error names.
   * @param data - The source array.
   * @param components - Floats per vertex for this attribute.
   * @param vertexOffset - The first destination vertex.
   * @param vertexCount - The requested count, or `undefined` for "as many as `data` holds".
   * @returns The resolved count.
   * @throws IgnifxError with code `IGX-0725` when the range does not fit.
   */
  #resolveRange(
    member: string,
    data: Float32Array,
    components: number,
    vertexOffset: number,
    vertexCount: number | undefined,
  ): number {
    const available = Math.floor(data.length / components);
    const count = vertexCount ?? available;
    const total = this.vertexCount;
    const fits =
      Number.isInteger(vertexOffset) &&
      vertexOffset >= 0 &&
      Number.isInteger(count) &&
      count >= 0 &&
      count <= available &&
      vertexOffset + count <= total;
    if (fits) {
      return count;
    }
    throw new IgnifxError(
      CoreErrorCode.invalidGeometryUpdate,
      `${this.name}: an update of ${String(count)} vertices at offset ${String(vertexOffset)} does not fit the ` +
        `${String(total)}-vertex mesh, or the source array holds only ${String(available)}.`,
      {
        context: { asset: this.name, member: `MeshAsset.${member}()`, offset: vertexOffset, count, total },
        hint: "An update writes inside the geometry it was created with; rebuild the asset to change its size.",
      },
    );
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
    this.#mesh = null;
    releaseMeshTemplate(this.#scene, mesh);
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
    return publish(app, "box", (engine) => buildBoxTemplate(engine, options));
  }

  /**
   * Creates a sphere template and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Diameter and ring count.
   * @returns The handle, with one holder.
   */
  static sphere(app: App, options?: SphereMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "sphere", (engine) => buildSphereTemplate(engine, options));
  }

  /**
   * Creates a quad template in the XY plane and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - A uniform `size`, or width and height.
   * @returns The handle, with one holder.
   */
  static plane(app: App, options?: PlaneMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "plane", (engine) => buildPlaneTemplate(engine, options));
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
    return publish(app, "ground", (engine) => buildGroundTemplate(engine, lite));
  }

  /**
   * Creates a cylinder template standing along Y and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Height, diameters, and tessellation.
   * @returns The handle, with one holder.
   */
  static cylinder(app: App, options?: CylinderMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "cylinder", (engine) => buildCylinderTemplate(engine, options));
  }

  /**
   * Creates a capsule template standing along Y and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Total height, radius, and tessellation.
   * @returns The handle, with one holder.
   */
  static capsule(app: App, options?: CapsuleMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "capsule", (engine) => buildCapsuleTemplate(engine, options));
  }

  /**
   * Creates a torus template in the XZ plane and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param options - Diameter, thickness, and tessellation.
   * @returns The handle, with one holder.
   */
  static torus(app: App, options?: TorusMeshOptions): AssetHandle<MeshAsset> {
    return publish(app, "torus", (engine) => buildTorusTemplate(engine, options));
  }

  /**
   * Creates a template from raw vertex data and publishes it.
   *
   * @param app - The app that owns the engine and the asset service.
   * @param name - A human-readable name.
   * @param data - Positions, normals, indices, and any of the four optional attributes. Lite keeps
   * references to the arrays; a caller that means to edit them afterwards does so through the
   * `update*` methods, which keep Lite's own copy and its bounds in step.
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
    return publish(
      app,
      name,
      (engine) =>
        createMeshFromGeometry(
          engine,
          name,
          data.positions,
          data.normals,
          data.indices,
          data.uvs,
          data.uvs2,
          data.tangents,
          data.colors,
        ),
      data,
    );
  }
}

/**
 * Copies one attribute's vertex range from a source array into the array the asset retains, when
 * they are not already the same array.
 *
 * @remarks
 * An indexed loop rather than `target.set(source.subarray(...), offset)`, because `subarray`
 * allocates a view and sculpting a terrain is not a place to allocate per call
 * (coding standards §7).
 *
 * @param source - The values the caller handed in, read from index 0.
 * @param target - The retained array.
 * @param components - Floats per vertex for this attribute.
 * @param vertexOffset - The first destination vertex.
 * @param count - How many vertices to copy.
 */
function copyRange(
  source: Float32Array,
  target: Float32Array,
  components: number,
  vertexOffset: number,
  count: number,
): void {
  const floats = count * components;
  const base = vertexOffset * components;
  if (source === target) {
    // The same array, so the ranges can overlap; `copyWithin` is defined for that and is a no-op
    // when the offset is zero, which is the ordinary "I edited it in place" case.
    target.copyWithin(base, 0, floats);
    return;
  }
  target.set(source.subarray(0, floats), base);
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
 * @param geometry - The vertex arrays, for a mesh built from data; `null` for a primitive.
 * @returns The handle, with one holder.
 */
function publish(
  app: App,
  name: string,
  build: (engine: LiteEngine) => LiteMesh,
  geometry: MeshGeometryData | null = null,
): AssetHandle<MeshAsset> {
  const handles = buildMeshTemplate(app.isHeadless, app.lite.scene, app.lite.engine, build);
  const asset = new MeshAsset(name, handles.mesh, handles.scene, geometry, handles.engine);
  return app.assets.register(asset, { type: MESH_ASSET_TYPE });
}
