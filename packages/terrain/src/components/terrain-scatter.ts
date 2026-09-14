import {
  array,
  asset as assetField,
  bool,
  Component,
  createDefaults,
  defineSchema,
  f32,
  InstancedMeshRenderer,
  MaterialAsset,
  MeshAsset,
  str,
  u32,
  Vec3,
  vec2,
} from "@ignifx/core";
import { TerrainErrorCode, terrainError } from "../errors.js";
import { createScatterPlacements, generateScatter, scatterCapacity } from "../scatter/placement.js";
import { Terrain } from "./terrain.js";
import type { ScatterPlacements, ScatterRules } from "../scatter/placement.js";
import type { AssetHandle, ComponentHooks, MutableVec3, Schema, Vec2Like } from "@ignifx/core";

/**
 * `TerrainScatter`: seeded, rule-based foliage on one `InstancedMeshRenderer`
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.5).
 *
 * Placement is generated once and is a pure function of the seed, the terrain, and the rules, so a
 * headless test asserts the same instances a device draws. Change a rule and call
 * {@link TerrainScatter.regenerate}; nothing is re-evaluated per frame.
 */

/** Floats in one column-major 4x4 matrix. */
const MATRIX_FLOATS = 16;

/** Floats per position or normal in the placement arrays. */
const VECTOR_STRIDE = 3;

/** The height band a scatter accepts when it names none; JSON cannot carry an infinity. */
const HEIGHT_LIMIT = 1e9;

/** The `InstancedMeshRenderer` LOD band, in metres, either side of `lodDistance`. */
const LOD_BAND = 6;

/**
 * Builds the `TerrainScatter` field declarations (plan §5.5).
 *
 * @returns The schema.
 */
function scatterSchema(): Schema {
  return defineSchema({
    mesh: assetField(MeshAsset, { tooltip: "The mesh every instance draws." }),
    material: assetField(MaterialAsset, { tooltip: "The material, normally from foliageMaterialDefinition." }),
    lodMesh: assetField(MeshAsset, { tooltip: "A cheaper mesh drawn past lodDistance; null for none." }),
    lodDistance: f32(40, { min: 0, tooltip: "Metres past which the LOD mesh takes over." }),
    density: f32(0.5, { min: 0, tooltip: "Instances per square metre." }),
    layers: array(str(), [], { tooltip: "Splat layers to place on; empty places everywhere." }),
    layerThreshold: f32(0.5, { min: 0, max: 1, tooltip: "The splat weight a named layer must reach." }),
    slope: vec2({ x: 0, y: 35 }, { tooltip: "The slope band, in degrees." }),
    height: vec2({ x: -HEIGHT_LIMIT, y: HEIGHT_LIMIT }, { tooltip: "The height band, in metres." }),
    scale: vec2({ x: 0.8, y: 1.2 }, { tooltip: "The random uniform scale range." }),
    randomYaw: bool(true, { tooltip: "Whether each instance is turned randomly about Y." }),
    alignToNormal: bool(false, { tooltip: "Whether each instance stands along the surface normal." }),
    seed: u32(1, { tooltip: "The placement seed; the same seed places the same instances." }),
    maxInstances: u32(50_000, { tooltip: "The cap, which also sizes the GPU instance buffer." }),
  });
}

/**
 * Seeded foliage on a terrain.
 *
 * @remarks
 * `maxInstances` sizes the `InstancedMeshRenderer`'s instance buffer, which Babylon Lite fixes
 * before the scene is registered, so set it before `app.start()`.
 *
 * @example
 * ```ts
 * const grass = ground.addComponent(TerrainScatter, {
 *   mesh: card,
 *   material: foliage,
 *   density: 2,
 *   layers: ["grass"],
 *   maxInstances: 20_000,
 * });
 * ```
 *
 * @public
 */
export class TerrainScatter extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/TerrainScatter";

  /** One scatter per entity; a second kind of foliage goes on a child. */
  static allowMultiple = false;

  /** The renderer the instances are drawn through; added automatically. */
  static requires: readonly [typeof InstancedMeshRenderer] = [InstancedMeshRenderer];

  /** The declarative fields (ADR-0004). */
  static schema: Schema = scatterSchema();

  /** The mesh every instance draws. */
  declare mesh: AssetHandle<MeshAsset> | null;

  /** The material, normally built by `foliageMaterialDefinition`. */
  declare material: AssetHandle<MaterialAsset> | null;

  /** A cheaper mesh drawn past {@link TerrainScatter.lodDistance}, or `null`. */
  declare lodMesh: AssetHandle<MeshAsset> | null;

  /** Metres past which the LOD mesh takes over. */
  declare lodDistance: number;

  /** Instances per square metre of terrain. */
  declare density: number;

  /** Splat layer names to place on; empty places everywhere. */
  declare layers: string[];

  /** The splat weight a named layer must reach before a candidate stands. */
  declare layerThreshold: number;

  /** The slope band, in degrees from horizontal. */
  declare slope: Vec2Like;

  /** The height band, in metres. */
  declare height: Vec2Like;

  /** The random uniform scale range. */
  declare scale: Vec2Like;

  /** Whether each instance is turned by a random angle about Y. */
  declare randomYaw: boolean;

  /** Whether each instance stands along the surface normal rather than straight up. */
  declare alignToNormal: boolean;

  /** The placement seed. */
  declare seed: number;

  /** The cap on instances, which also sizes the GPU instance buffer. */
  declare maxInstances: number;

  #count = 0;

  #placements: ScatterPlacements | null = null;

  #matrices: Float32Array = new Float32Array(0);

  #terrain: Terrain | null = null;

  #generatedFor: object | null = null;

  #needsPlacement = true;

  readonly #point: MutableVec3 = new Vec3();

  readonly #normal: MutableVec3 = new Vec3();

  readonly #right: MutableVec3 = new Vec3();

  readonly #forward: MutableVec3 = new Vec3();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(TerrainScatter.schema));
  }

  /**
   * How many instances are placed.
   *
   * @returns The count.
   */
  get count(): number {
    return this.#count;
  }

  /** Sizes the instance buffer before the scene is registered. */
  onAttach(): void {
    const renderer = this.entity.requireComponent(InstancedMeshRenderer);
    renderer.capacity = Math.max(1, this.maxInstances);
    renderer.gpuCulling = true;
    renderer.castShadows = true;
    renderer.receiveShadows = false;
    this.#needsPlacement = true;
  }

  /** Empties the renderer, so a disabled scatter draws nothing. */
  onDetach(): void {
    const renderer = this.entity.getComponent(InstancedMeshRenderer);
    renderer?.setCount(0);
    this.#count = 0;
    this.#terrain = null;
    this.#generatedFor = null;
    this.#needsPlacement = true;
  }

  /**
   * Places the instances again, which is what a changed rule needs.
   *
   * @throws IgnifxError with code `IGX-1612` when no `Terrain` is on this entity or an ancestor, or
   * `IGX-1611` when {@link TerrainScatter.layers} names a layer the terrain does not declare.
   */
  regenerate(): void {
    const terrain = this.#requireTerrain();
    const asset = terrain.asset;
    if (asset === null) {
      throw terrainError(
        TerrainErrorCode.terrainNotLoaded,
        `${this.entity.name} has no terrain field yet; wait for the asset to load before scattering on it.`,
        { context: { entity: this.entity.name } },
      );
    }
    const rules = this.#rules(asset.definition.layers.length, terrain);
    const capacity = Math.max(1, scatterCapacity(asset.field, this.density, rules.maxInstances));
    if (this.#placements === null || this.#placements.yaw.length < capacity) {
      this.#placements = createScatterPlacements(capacity);
      this.#matrices = new Float32Array(capacity * MATRIX_FLOATS);
    }
    this.#count = generateScatter(asset.field, asset.control, rules, this.#placements);
    this.#writeMatrices(terrain);
    this.#applyRenderer();
    this.#generatedFor = asset;
    this.#needsPlacement = false;
  }

  /**
   * Generates the placement once the terrain's asset has arrived, and again after a sculpt.
   *
   * @internal
   */
  syncPlacement(): void {
    const terrain = this.entity.getComponentInParent(Terrain);
    if (terrain === null) {
      return;
    }
    if (terrain !== this.#terrain) {
      this.#terrain = terrain;
      terrain.onHeightsChanged.connect(
        (): void => {
          this.#needsPlacement = true;
        },
        { owner: this },
      );
      this.#needsPlacement = true;
    }
    const asset = terrain.asset;
    if (asset === null) {
      return;
    }
    if (!this.#needsPlacement && asset === this.#generatedFor) {
      return;
    }
    this.regenerate();
  }

  /**
   * The terrain this scatter stands on.
   *
   * @returns The terrain.
   * @throws IgnifxError with code `IGX-1612` when there is none.
   */
  #requireTerrain(): Terrain {
    const terrain = this.#terrain ?? this.entity.getComponentInParent(Terrain);
    if (terrain === null) {
      throw terrainError(
        TerrainErrorCode.scatterNeedsTerrain,
        `${this.entity.name} carries a TerrainScatter but no Terrain is on it or on any ancestor.`,
        {
          context: { entity: this.entity.name },
          hint: "Add the TerrainScatter to the terrain's entity or to a child of it.",
        },
      );
    }
    this.#terrain = terrain;
    return terrain;
  }

  /**
   * Turns the component's fields into placement rules, resolving layer names to channels.
   *
   * @param layerCount - How many layers the terrain declares.
   * @param terrain - The terrain, for the layer lookup.
   * @returns The rules.
   * @throws IgnifxError with code `IGX-1611` when a named layer is not declared.
   */
  #rules(layerCount: number, terrain: Terrain): ScatterRules {
    const asset = terrain.asset;
    const indices: number[] = [];
    for (let index = 0; index < this.layers.length; index += 1) {
      const name = this.layers[index] ?? "";
      const found = asset === null ? -1 : asset.layerIndex(name);
      if (found < 0 || found >= layerCount) {
        throw terrainError(
          TerrainErrorCode.unknownLayer,
          `${this.entity.name} scatters on the layer ${name}, which the terrain does not declare.`,
          { context: { file: asset?.address ?? this.entity.name, layer: name } },
        );
      }
      indices.push(found);
    }
    return {
      density: this.density,
      layers: indices,
      layerThreshold: this.layerThreshold,
      slopeMin: Math.min(this.slope.x, this.slope.y),
      slopeMax: Math.max(this.slope.x, this.slope.y),
      heightMin: Math.min(this.height.x, this.height.y),
      heightMax: Math.max(this.height.x, this.height.y),
      scaleMin: Math.min(this.scale.x, this.scale.y),
      scaleMax: Math.max(this.scale.x, this.scale.y),
      randomYaw: this.randomYaw,
      seed: this.seed,
      maxInstances: this.maxInstances,
    };
  }

  /**
   * Turns the placements into instance matrices in this entity's frame.
   *
   * @param terrain - The terrain the placements are stated in.
   */
  #writeMatrices(terrain: Terrain): void {
    const placements = this.#placements;
    if (placements === null) {
      return;
    }
    const sameFrame = terrain.entity === this.entity;
    const source = terrain.transform;
    const target = this.transform;
    const matrices = this.#matrices;
    for (let index = 0; index < this.#count; index += 1) {
      const at = index * VECTOR_STRIDE;
      this.#point.set(
        placements.positions[at] ?? 0,
        placements.positions[at + 1] ?? 0,
        placements.positions[at + 2] ?? 0,
      );
      this.#normal.set(placements.normals[at] ?? 0, placements.normals[at + 1] ?? 1, placements.normals[at + 2] ?? 0);
      if (!sameFrame) {
        source.transformPoint(this.#point, this.#point);
        target.inverseTransformPoint(this.#point, this.#point);
        source.transformDirection(this.#normal, this.#normal);
        target.inverseTransformDirection(this.#normal, this.#normal);
      }
      this.#writeMatrix(matrices, index * MATRIX_FLOATS, placements.yaw[index] ?? 0, placements.scale[index] ?? 1);
    }
  }

  /**
   * Writes one column-major instance matrix from the scratch point, normal, yaw, and scale.
   *
   * @param out - The matrix slab.
   * @param at - Where the matrix starts.
   * @param yaw - The rotation about the instance's up axis, in radians.
   * @param scale - The uniform scale.
   */
  #writeMatrix(out: Float32Array, at: number, yaw: number, scale: number): void {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    let upX = 0;
    let upY = 1;
    let upZ = 0;
    if (this.alignToNormal) {
      upX = this.#normal.x;
      upY = this.#normal.y;
      upZ = this.#normal.z;
      const length = Math.hypot(upX, upY, upZ);
      const inverse = length > 0 ? 1 / length : 0;
      upX *= inverse;
      upY *= inverse;
      upZ *= inverse;
    }
    // A yaw in the plane of the up axis: cross the turned forward `(sin, 0, cos)` with up, then
    // re-cross for forward. The forward's Y is zero, so two terms of the cross drop out.
    this.#right.set(upY * cos, upZ * sin - upX * cos, -upY * sin);
    const rightLength = Math.hypot(this.#right.x, this.#right.y, this.#right.z);
    if (rightLength < 1e-6) {
      this.#right.set(cos, 0, -sin);
    } else {
      this.#right.set(this.#right.x / rightLength, this.#right.y / rightLength, this.#right.z / rightLength);
    }
    this.#forward.set(
      this.#right.y * upZ - this.#right.z * upY,
      this.#right.z * upX - this.#right.x * upZ,
      this.#right.x * upY - this.#right.y * upX,
    );
    out[at] = this.#right.x * scale;
    out[at + 1] = this.#right.y * scale;
    out[at + 2] = this.#right.z * scale;
    out[at + 3] = 0;
    out[at + 4] = upX * scale;
    out[at + 5] = upY * scale;
    out[at + 6] = upZ * scale;
    out[at + 7] = 0;
    out[at + 8] = this.#forward.x * scale;
    out[at + 9] = this.#forward.y * scale;
    out[at + 10] = this.#forward.z * scale;
    out[at + 11] = 0;
    out[at + 12] = this.#point.x;
    out[at + 13] = this.#point.y;
    out[at + 14] = this.#point.z;
    out[at + 15] = 1;
  }

  /** Pushes the mesh, material, LOD partner, and matrices onto the renderer. */
  #applyRenderer(): void {
    const renderer = this.entity.getComponent(InstancedMeshRenderer);
    if (renderer === null) {
      return;
    }
    renderer.mesh = this.mesh;
    renderer.materials = [this.material];
    const lodMesh = this.lodMesh;
    renderer.lod = lodMesh === null ? null : { mesh: lodMesh, distance: this.lodDistance, band: LOD_BAND };
    renderer.setMatrices(this.#matrices, this.#count);
  }
}
