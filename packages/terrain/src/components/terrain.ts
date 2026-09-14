import {
  asset as assetField,
  bool,
  Component,
  createDefaults,
  createMaterialAsset,
  createRay,
  Mat4,
  defineSchema,
  f32,
  pbrMaterialDefinition,
  Quat,
  Signal,
  Vec3,
} from "@ignifx/core";
import { TerrainAsset } from "../assets/terrain-asset.js";
import { TerrainErrorCode, terrainError } from "../errors.js";
import { buildChunkGeometry, chunkBounds, writeChunkVertices } from "../geometry/chunk-geometry.js";
import { createTerrainHit } from "../heightfield/height-field.js";
import {
  createChunkMesh,
  destroyChunkMesh,
  setChunkBounds,
  setChunkReceiveShadows,
  setChunkVisible,
  updateChunkMesh,
} from "../lite/gpu/chunk-mesh.js";
import { selectLod } from "../lod/lod-select.js";
import { LAYERS_PER_CONTROL_MAP } from "../material/splat-rules.js";
import { TERRAIN_SPLAT_NAME } from "../material/terrain-splat.surface.wgsl.js";
import type { TerrainSize } from "../definition/types.js";
import type { ChunkGeometry } from "../geometry/chunk-geometry.js";
import type { HeightField, TerrainHit, TerrainRegion } from "../heightfield/height-field.js";
import type { LiteChunkMesh } from "../lite/gpu/chunk-mesh.js";
import type { Frustum } from "../lod/frustum.js";
import type {
  AssetHandle,
  ComponentHooks,
  MaterialAsset,
  MutableVec3,
  Ray,
  Schema,
  SurfaceShaderBinding,
  TextureAsset,
  Vec3Like,
} from "@ignifx/core";

/**
 * `Terrain`: the component that turns a {@link TerrainAsset} into chunk meshes and answers every
 * gameplay query about the ground (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2–§5.4,
 * `docs/adr/0023-terrain-chunked-geomipmapping.md`).
 *
 * Queries read the **height field**, never a collider, so a terrain answers `heightAt` with no
 * physics registered and under a headless app. They honour the entity's translation and scale;
 * a terrain rotated about Y logs `IGX-1604` once and is read as if it were not.
 */

/** Floats in one axis-aligned box: `minX, minY, minZ, maxX, maxY, maxZ`. */
const BOX_STRIDE = 6;

/** Bytes per RGBA texel of a control map. */
const BYTES_PER_TEXEL = 4;

/** How close a quaternion's `w` must be to 1 before the entity counts as unrotated. */
const ROTATION_EPSILON = 1e-4;

/** The sample ring a sculpt touches beyond its own region, because normals read their neighbours. */
const NORMAL_MARGIN = 1;

/** Babylon Lite's own default plugin priority; the terrain has only one surface shader. */
const SPLAT_PRIORITY = 500;

/**
 * What a `HeightfieldCollider` needs, by data: `@ignifx/terrain` never imports `@ignifx/physics`
 * (plan §5.4), so this is the shape rather than the type.
 *
 * @public
 */
export interface TerrainColliderInit {
  /**
   * `samplesX * samplesZ` heights in metres, in the terrain's local frame. Rows run from the
   * largest Z to the smallest, which is the order Babylon Lite's heightfield reads.
   */
  readonly heights: number[];
  /** Samples along X, at least 2. */
  readonly samplesX: number;
  /** Samples along Z, at least 2. */
  readonly samplesZ: number;
  /** The covered extent in metres; `y` is the terrain's full height range. */
  readonly size: Vec3Like;
}

/**
 * Builds the `Terrain` field declarations.
 *
 * @returns The schema.
 */
function terrainSchema(): Schema {
  return defineSchema({
    definition: assetField(TerrainAsset, { tooltip: "The .terrain.json this terrain draws." }),
    lodBias: f32(1, { min: 0.05, tooltip: "Multiplies every LOD threshold; above 1 keeps detail further out." }),
    receiveShadows: bool(true, { tooltip: "Whether shadow maps darken the terrain." }),
    frustumCulling: bool(true, { tooltip: "Whether chunks outside the camera's frustum are hidden." }),
  });
}

/**
 * A chunked, geomipmapped terrain.
 *
 * @example
 * ```ts
 * const ground = app.world.createEntity("Terrain");
 * const terrain = ground.addComponent(Terrain, { definition: island });
 * terrain.heightAt(0, 0);
 * ```
 *
 * @public
 */
export class Terrain extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/Terrain";

  /** One terrain per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = terrainSchema();

  /** The terrain document this component draws. */
  declare definition: AssetHandle<TerrainAsset> | null;

  /** Multiplies every LOD threshold; above `1` keeps fine meshes further from the camera. */
  declare lodBias: number;

  /** Whether shadow maps darken the terrain. Chunks never **cast**; see the skill's gotchas. */
  declare receiveShadows: boolean;

  /** Whether chunks outside the camera's frustum are hidden. */
  declare frustumCulling: boolean;

  #asset: TerrainAsset | null = null;

  #material: AssetHandle<MaterialAsset> | null = null;

  #meshes: (LiteChunkMesh | null)[] = [];

  #geometry: (ChunkGeometry | null)[] = [];

  #localBounds: Float32Array = new Float32Array(0);

  #worldBounds: Float32Array = new Float32Array(0);

  #lods: Int32Array = new Int32Array(0);

  #chunksPerSide = 0;

  #lodLevels = 0;

  #visibleChunks = 0;

  #hasWarnedAboutRotation = false;

  #transformVersion = -1;

  #appliedReceiveShadows = true;

  #splatBinding: SurfaceShaderBinding | null = null;

  readonly #origin: Float32Array = new Float32Array(2);

  readonly #invSize: Float32Array = new Float32Array(2);

  readonly #onHeightsChanged: Signal<TerrainRegion> = new Signal<TerrainRegion>();

  readonly #position: MutableVec3 = new Vec3();

  readonly #scale: MutableVec3 = new Vec3(1, 1, 1);

  readonly #rotation: Quat = new Quat();

  readonly #scratch: MutableVec3 = new Vec3();

  readonly #box: Float32Array = new Float32Array(BOX_STRIDE);

  readonly #localRay: Ray = createRay();

  readonly #localHit: TerrainHit = createTerrainHit();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(Terrain.schema));
  }

  /**
   * Fires after {@link Terrain.setHeights} with the sample rectangle that changed, so a collider
   * and a scatter can follow.
   *
   * @returns The signal.
   */
  get onHeightsChanged(): Signal<TerrainRegion> {
    return this.#onHeightsChanged;
  }

  /**
   * Whether the asset has been delivered and the terrain is ready to answer queries.
   *
   * @returns `true` once the document has loaded.
   */
  get isLoaded(): boolean {
    return this.#asset !== null;
  }

  /**
   * The loaded asset.
   *
   * @returns The asset, or `null` until it is delivered.
   */
  get asset(): TerrainAsset | null {
    return this.#asset;
  }

  /**
   * The material the chunks draw with: one PBR material carrying the `terrainSplat` surface shader.
   *
   * @returns The material, or `null` headless and before the asset loads.
   */
  get material(): AssetHandle<MaterialAsset> | null {
    return this.#material;
  }

  /**
   * The extent in metres the document declares, before the entity's scale.
   *
   * @returns The size.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  get size(): TerrainSize {
    return this.#require().definition.size;
  }

  /**
   * Samples per side.
   *
   * @returns The resolution.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  get resolution(): number {
    return this.#require().field.resolution;
  }

  /**
   * The heights in metres, row-major, in the terrain's local frame. Write through
   * {@link Terrain.setHeights}; a direct write rebuilds nothing.
   *
   * @returns The live array.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  get heights(): Float32Array {
    return this.#require().field.heights;
  }

  /**
   * How many chunks the terrain is cut into.
   *
   * @returns The chunk count; `0` before the asset is delivered.
   */
  get chunkCount(): number {
    return this.#chunksPerSide * this.#chunksPerSide;
  }

  /**
   * How many chunks the last LOD pass left visible.
   *
   * @returns The count.
   */
  get visibleChunks(): number {
    return this.#visibleChunks;
  }

  /**
   * How many draw calls the terrain costs: one per visible chunk, because every chunk is one mesh
   * with one material. `engine.drawCallCount` counts hidden bindings and is not this number.
   *
   * @returns The count.
   */
  get drawCalls(): number {
    return this.#visibleChunks;
  }

  /** Builds nothing: the asset may still be loading, so the LOD system does the work. */
  onAttach(): void {
    this.#hasWarnedAboutRotation = false;
  }

  /** Destroys the chunk meshes and releases the material. */
  onDetach(): void {
    this.#teardown();
  }

  /**
   * The height of the surface under a world-space point, bilinearly interpolated. Points outside
   * the terrain read the nearest edge.
   *
   * @param x - The world X, in metres.
   * @param z - The world Z, in metres.
   * @returns The world Y of the surface, in metres.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  heightAt(x: number, z: number): number {
    const field = this.#require().field;
    this.#readTransform();
    const scale = this.#scale;
    const position = this.#position;
    const local = field.heightAt((x - position.x) / scale.x, (z - position.z) / scale.z);
    return local * scale.y + position.y;
  }

  /**
   * The unit surface normal under a world-space point.
   *
   * @param x - The world X, in metres.
   * @param z - The world Z, in metres.
   * @param out - Receives the normal.
   * @returns `out`, for chaining.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  normalAt(x: number, z: number, out: MutableVec3): MutableVec3 {
    const field = this.#require().field;
    this.#readTransform();
    const scale = this.#scale;
    const position = this.#position;
    field.normalAt((x - position.x) / scale.x, (z - position.z) / scale.z, out);
    // A normal transforms by the inverse transpose, which for an axis scale is a divide per axis.
    out.x /= scale.x;
    out.y /= scale.y;
    out.z /= scale.z;
    const length = Math.hypot(out.x, out.y, out.z);
    const inverse = length > 0 ? 1 / length : 0;
    out.x *= inverse;
    out.y *= inverse;
    out.z *= inverse;
    return out;
  }

  /**
   * The slope under a world-space point, in degrees from horizontal.
   *
   * @param x - The world X, in metres.
   * @param z - The world Z, in metres.
   * @returns `0` flat, `90` vertical.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  slopeAt(x: number, z: number): number {
    const normal = this.normalAt(x, z, this.#scratch);
    const cosine = normal.y > 1 ? 1 : normal.y < -1 ? -1 : normal.y;
    return (Math.acos(cosine) * 180) / Math.PI;
  }

  /**
   * Marches a world-space ray across the terrain and reports where it first meets the surface.
   *
   * @param ray - The ray, in world metres.
   * @param out - Receives the hit, in world space.
   * @returns `true` when the ray hit inside `ray.length`.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  raycast(ray: Ray, out: TerrainHit): boolean {
    const field = this.#require().field;
    this.#readTransform();
    const scale = this.#scale;
    const position = this.#position;
    const local = this.#localRay;
    local.origin.x = (ray.origin.x - position.x) / scale.x;
    local.origin.y = (ray.origin.y - position.y) / scale.y;
    local.origin.z = (ray.origin.z - position.z) / scale.z;
    local.direction.x = ray.direction.x / scale.x;
    local.direction.y = ray.direction.y / scale.y;
    local.direction.z = ray.direction.z / scale.z;
    // The local ray's direction is not unit length under a non-uniform scale, so the marched
    // distance is measured in world metres only after the hit is scaled back.
    const localLength = Math.hypot(local.direction.x, local.direction.y, local.direction.z);
    const worldLength = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
    local.length = worldLength > 0 ? (ray.length * localLength) / worldLength : ray.length;
    const hit = this.#localHit;
    if (!field.raycast(local, hit)) {
      return false;
    }
    out.point.set(
      hit.point.x * scale.x + position.x,
      hit.point.y * scale.y + position.y,
      hit.point.z * scale.z + position.z,
    );
    this.normalAt(out.point.x, out.point.z, out.normal);
    out.distance = localLength > 0 ? (hit.distance * worldLength) / localLength : hit.distance;
    return true;
  }

  /**
   * The terrain's world-space bounding box, skirts excluded.
   *
   * @param out - Receives `[minX, minY, minZ, maxX, maxY, maxZ]`.
   * @returns `out`, for chaining.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  bounds(out: Float32Array): Float32Array {
    const field = this.#require().field;
    this.#readTransform();
    field.minMax(0, 0, field.resolution, field.resolution, this.#box);
    const low = this.#box[0] ?? 0;
    const high = this.#box[1] ?? 0;
    const position = this.#position;
    const scale = this.#scale;
    out[0] = (-field.width / 2) * scale.x + position.x;
    out[1] = low * scale.y + position.y;
    out[2] = (-field.depth / 2) * scale.z + position.z;
    out[3] = (field.width / 2) * scale.x + position.x;
    out[4] = high * scale.y + position.y;
    out[5] = (field.depth / 2) * scale.z + position.z;
    return out;
  }

  /**
   * The fractional sample coordinate of a world-space point.
   *
   * @param x - The world X, in metres.
   * @param z - The world Z, in metres.
   * @param out - Receives `[column, row]`, unclamped.
   * @returns `out`, for chaining.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  worldToSample(x: number, z: number, out: Float32Array): Float32Array {
    const field = this.#require().field;
    this.#readTransform();
    out[0] = field.localToSampleX((x - this.#position.x) / this.#scale.x);
    out[1] = field.localToSampleZ((z - this.#position.z) / this.#scale.z);
    return out;
  }

  /**
   * The world-space position of a sample.
   *
   * @param ix - The sample column.
   * @param iz - The sample row.
   * @param out - Receives the position.
   * @returns `out`, for chaining.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered.
   */
  sampleToWorld(ix: number, iz: number, out: MutableVec3): MutableVec3 {
    const field = this.#require().field;
    this.#readTransform();
    out.set(
      field.sampleToLocalX(ix) * this.#scale.x + this.#position.x,
      field.sample(ix, iz) * this.#scale.y + this.#position.y,
      field.sampleToLocalZ(iz) * this.#scale.z + this.#position.z,
    );
    return out;
  }

  /**
   * The initialisation a `HeightfieldCollider` takes, by data.
   *
   * @remarks
   * Values are in the terrain's **local** frame; the collider applies the entity's scale itself
   * (`packages/physics/src/components/colliders.ts`). A `HeightfieldCollider` always centres its
   * shape on its own entity and ignores `Collider.center`, so a `region` collider belongs on a
   * child entity placed at {@link Terrain.regionCenter}.
   *
   * @param region - The sample rectangle to cover. Defaults to the whole field.
   * @returns The init object.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered, or `IGX-1610` when the
   * region falls outside the field or is smaller than two samples on a side.
   *
   * @example
   * ```ts
   * const collider = ground.addComponent(HeightfieldCollider, terrain.colliderInit());
   * terrain.onHeightsChanged.connect(() => {
   *   Object.assign(collider, terrain.colliderInit());
   *   collider.rebuild();
   * }, { owner: this });
   * ```
   */
  colliderInit(region?: TerrainRegion): TerrainColliderInit {
    const field = this.#require().field;
    const area = region ?? { x: 0, z: 0, width: field.resolution, depth: field.resolution };
    field.assertRegion(area.x, area.z, area.width, area.depth);
    if (area.width < 2 || area.depth < 2) {
      throw terrainError(
        TerrainErrorCode.regionOutOfRange,
        `A heightfield collider needs at least 2 samples on each side, and the region is ${String(area.width)}x${String(area.depth)}.`,
        { context: { x: area.x, z: area.z, width: area.width, depth: area.depth, resolution: field.resolution } },
      );
    }
    // Rows run from the largest Z to the smallest: Babylon Lite's heightfield reads the array the
    // way its own ground-mesh path writes it (`lib/physics/havok-heightfield.js`), which is
    // `data[(rows - 1 - iz) * columns + ix]`. Feeding it ascending Z mirrors the collider in Z.
    const heights: number[] = [];
    for (let row = 0; row < area.depth; row += 1) {
      const sampleZ = area.z + area.depth - 1 - row;
      for (let column = 0; column < area.width; column += 1) {
        heights.push(field.sample(area.x + column, sampleZ));
      }
    }
    return {
      heights,
      samplesX: area.width,
      samplesZ: area.depth,
      size: {
        x: (area.width - 1) * field.spacingX,
        y: field.height,
        z: (area.depth - 1) * field.spacingZ,
      },
    };
  }

  /**
   * Where a region's centre sits in the terrain's local frame.
   *
   * @remarks
   * A `HeightfieldCollider` centres its shape on its own entity, so a collider built from
   * {@link Terrain.colliderInit} with a `region` goes on a child entity whose `localPosition` is
   * this point. The whole field's centre is the origin, which is why a full-field collider needs no
   * child entity at all.
   *
   * @param region - The sample rectangle.
   * @param out - Receives the centre; `y` is always `0`.
   * @returns `out`, for chaining.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered, or `IGX-1610` when the
   * region falls outside the field.
   */
  regionCenter(region: TerrainRegion, out: MutableVec3): MutableVec3 {
    const field = this.#require().field;
    field.assertRegion(region.x, region.z, region.width, region.depth);
    out.set(
      field.sampleToLocalX(region.x) + ((region.width - 1) * field.spacingX) / 2,
      0,
      field.sampleToLocalZ(region.z) + ((region.depth - 1) * field.spacingZ) / 2,
    );
    return out;
  }

  /**
   * Overwrites a rectangle of heights and rebuilds the chunks it touches.
   *
   * @param x - The first sample column.
   * @param z - The first sample row.
   * @param width - How many columns.
   * @param depth - How many rows.
   * @param heights - `width * depth` heights in metres, row-major, in the terrain's local frame.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered, or `IGX-1610` when the
   * rectangle falls outside the field or `heights` is too short.
   */
  setHeights(x: number, z: number, width: number, depth: number, heights: Float32Array): void {
    const asset = this.#require();
    asset.field.setHeights(x, z, width, depth, heights);
    this.#rebuildRegion(asset, x, z, width, depth);
    this.#onHeightsChanged.emit({ x, z, width, depth });
  }

  /**
   * Overwrites one layer's splat weights over a rectangle of control-map texels and re-uploads it.
   *
   * @remarks
   * The shader normalises the weights of a texel, so a weight is relative to the other layers there
   * rather than an absolute coverage. The control map has `resolution - 1` texels per side unless a
   * painted map declared another size.
   *
   * @param layer - The layer's control-channel index.
   * @param x - The first texel column.
   * @param z - The first texel row.
   * @param width - How many columns.
   * @param depth - How many rows.
   * @param weights - `width * depth` weights, `0` to `255`, row-major.
   * @throws IgnifxError with code `IGX-1609` before the asset is delivered, `IGX-1610` when the
   * rectangle falls outside the control map, or `IGX-1611` for an unknown layer index.
   */
  setSplat(layer: number, x: number, z: number, width: number, depth: number, weights: Uint8Array): void {
    const asset = this.#require();
    const control = asset.control;
    const size = control.size;
    if (!Number.isInteger(layer) || layer < 0 || layer >= asset.definition.layers.length) {
      throw terrainError(
        TerrainErrorCode.unknownLayer,
        `${asset.address} names the layer index ${String(layer)}, which the terrain does not declare.`,
        {
          context: { file: asset.address, layer },
          hint: `The terrain has ${String(asset.definition.layers.length)} layers.`,
        },
      );
    }
    if (x < 0 || z < 0 || width < 1 || depth < 1 || x + width > size || z + depth > size) {
      throw terrainError(
        TerrainErrorCode.regionOutOfRange,
        `The region ${String(x)},${String(z)} ${String(width)}x${String(depth)} falls outside a ${String(size)}x${String(size)} control map.`,
        { context: { x, z, width, depth, resolution: size } },
      );
    }
    const mapIndex = Math.floor(layer / LAYERS_PER_CONTROL_MAP);
    const channel = layer % LAYERS_PER_CONTROL_MAP;
    const map = control.maps[mapIndex];
    if (map === undefined) {
      return;
    }
    const patch = new Uint8Array(width * depth * BYTES_PER_TEXEL);
    for (let row = 0; row < depth; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const texel = ((z + row) * size + x + column) * BYTES_PER_TEXEL;
        map[texel + channel] = weights[row * width + column] ?? 0;
        const to = (row * width + column) * BYTES_PER_TEXEL;
        patch[to] = map[texel] ?? 0;
        patch[to + 1] = map[texel + 1] ?? 0;
        patch[to + 2] = map[texel + 2] ?? 0;
        patch[to + 3] = map[texel + 3] ?? 0;
      }
    }
    asset.controlTextures[mapIndex]?.value.update(patch, x, z, width, depth);
  }

  /**
   * Builds or tears down the chunk meshes after the asset handle changed.
   *
   * @internal
   */
  syncAsset(): void {
    const handle = this.definition;
    const next = handle !== null && handle.state === "loaded" ? handle.value : null;
    if (next === this.#asset) {
      this.#syncReceiveShadows();
      return;
    }
    this.#teardown();
    this.#asset = next;
    if (next !== null) {
      this.#build(next);
    }
  }

  /**
   * Picks each chunk's level of detail and hides the ones the camera cannot see.
   *
   * @param eyeX - The camera's world X.
   * @param eyeY - The camera's world Y.
   * @param eyeZ - The camera's world Z.
   * @param frustum - The camera's frustum, or `null` to cull nothing.
   *
   * @internal
   */
  selectLods(eyeX: number, eyeY: number, eyeZ: number, frustum: Frustum | null): void {
    const asset = this.#asset;
    if (asset === null) {
      this.#visibleChunks = 0;
      return;
    }
    this.#readTransform();
    this.#checkRotation();
    this.#writeWorldBounds();
    this.#updateSplatOrigin(asset);
    const chunks = this.#chunksPerSide * this.#chunksPerSide;
    const levels = this.#lodLevels;
    const bounds = this.#worldBounds;
    const cull = this.frustumCulling && frustum !== null;
    const lodDistance = asset.definition.chunks.lodDistance;
    const lodBias = this.lodBias > 0 ? this.lodBias : 1;
    let visible = 0;
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const at = chunk * BOX_STRIDE;
      const minX = bounds[at] ?? 0;
      const minY = bounds[at + 1] ?? 0;
      const minZ = bounds[at + 2] ?? 0;
      const maxX = bounds[at + 3] ?? 0;
      const maxY = bounds[at + 4] ?? 0;
      const maxZ = bounds[at + 5] ?? 0;
      const dx = eyeX < minX ? minX - eyeX : eyeX > maxX ? eyeX - maxX : 0;
      const dy = eyeY < minY ? minY - eyeY : eyeY > maxY ? eyeY - maxY : 0;
      const dz = eyeZ < minZ ? minZ - eyeZ : eyeZ > maxZ ? eyeZ - maxZ : 0;
      const current = this.#lods[chunk] ?? 0;
      const level = selectLod(Math.hypot(dx, dy, dz), lodDistance, lodBias, levels, current);
      this.#lods[chunk] = level;
      const inside = cull ? frustum.intersectsBox(minX, minY, minZ, maxX, maxY, maxZ) : true;
      if (inside) {
        visible += 1;
      }
      for (let lod = 0; lod < levels; lod += 1) {
        const mesh = this.#meshes[chunk * levels + lod];
        if (mesh !== null && mesh !== undefined) {
          setChunkVisible(mesh, inside && lod === level);
        }
      }
    }
    this.#visibleChunks = visible;
  }

  /**
   * The level of detail a chunk is showing.
   *
   * @param chunkX - The chunk column.
   * @param chunkZ - The chunk row.
   * @returns The level, or `0` before the asset is delivered.
   */
  lodOf(chunkX: number, chunkZ: number): number {
    const side = this.#chunksPerSide;
    if (chunkX < 0 || chunkZ < 0 || chunkX >= side || chunkZ >= side) {
      return 0;
    }
    return this.#lods[chunkZ * side + chunkX] ?? 0;
  }

  /**
   * The loaded asset, or a failure naming this entity.
   *
   * @returns The asset.
   * @throws IgnifxError with code `IGX-1609`.
   */
  #require(): TerrainAsset {
    const asset = this.#asset ?? (this.definition?.state === "loaded" ? this.definition.value : null);
    if (asset === null) {
      throw terrainError(
        TerrainErrorCode.terrainNotLoaded,
        `${this.entity.name} has no terrain field yet; wait for the asset to load before querying it.`,
        {
          context: { entity: this.entity.name },
          hint: "Await app.assets.loadAsync(...) before adding the component, or wait for the handle's promise.",
        },
      );
    }
    return asset;
  }

  /**
   * Reads the entity's world translation and scale into the scratch vectors.
   *
   * @remarks
   * Every query calls it, so it is guarded by `worldMatrixVersion` — the counter core publishes for
   * exactly this (`docs/architecture/02-scene-graph.md` §9). A terrain that has not moved decodes
   * its matrix once, not once per height query.
   */
  #readTransform(): void {
    const transform = this.transform;
    const version = transform.worldMatrixVersion;
    if (version === this.#transformVersion) {
      return;
    }
    this.#transformVersion = version;
    const matrix = transform.worldMatrix;
    Mat4.getTranslationToRef(matrix, this.#position);
    Mat4.getScaleToRef(matrix, this.#scale);
  }

  /** Warns once that a rotated terrain is read as if it were not. */
  #checkRotation(): void {
    if (this.#hasWarnedAboutRotation) {
      return;
    }
    this.transform.rotationToRef(this.#rotation);
    if (Math.abs(Math.abs(this.#rotation.w) - 1) > ROTATION_EPSILON) {
      this.#hasWarnedAboutRotation = true;
      this.app.log.warn(
        `${TerrainErrorCode.rotationUnsupported}: {entity} is rotated; Terrain queries honour ` +
          "translation and scale only.",
        this.entity.name,
      );
    }
  }

  /**
   * Builds the chunk bounds, the material, and — on a device — every chunk mesh.
   *
   * @param asset - The delivered asset.
   */
  #build(asset: TerrainAsset): void {
    this.#readTransform();
    const definition = asset.definition;
    const side = definition.chunksPerSide;
    const levels = definition.chunks.lodLevels;
    this.#chunksPerSide = side;
    this.#lodLevels = levels;
    this.#lods = new Int32Array(side * side);
    this.#localBounds = new Float32Array(side * side * BOX_STRIDE);
    this.#worldBounds = new Float32Array(side * side * BOX_STRIDE);
    this.#meshes = Array.from<LiteChunkMesh | null>({ length: side * side * levels }).fill(null);
    this.#geometry = Array.from<ChunkGeometry | null>({ length: side * side * levels }).fill(null);
    for (let chunkZ = 0; chunkZ < side; chunkZ += 1) {
      for (let chunkX = 0; chunkX < side; chunkX += 1) {
        this.#writeLocalBounds(asset.field, chunkX, chunkZ);
      }
    }
    if (this.app.isHeadless) {
      return;
    }
    this.#material = this.#createMaterial(asset);
    const liteMaterial = this.#material.value.lite.material;
    const engine = this.app.lite.engine;
    const scene = this.world.lite.scene;
    const parent = this.transform.lite;
    const chunkSize = definition.chunks.size;
    const skirtDepth = definition.chunks.skirtDepth;
    for (let chunkZ = 0; chunkZ < side; chunkZ += 1) {
      for (let chunkX = 0; chunkX < side; chunkX += 1) {
        const chunk = chunkZ * side + chunkX;
        for (let lod = 0; lod < levels; lod += 1) {
          const geometry = buildChunkGeometry(asset.field, chunkX, chunkZ, lod, chunkSize, skirtDepth);
          const mesh = createChunkMesh(
            engine,
            scene,
            `${definition.name}-chunk-${String(chunkX)}-${String(chunkZ)}-lod${String(lod)}`,
            parent,
            liteMaterial,
            geometry.positions,
            geometry.normals,
            geometry.uvs,
            geometry.indices,
          );
          setChunkBounds(mesh, this.#localBounds.subarray(chunk * BOX_STRIDE, chunk * BOX_STRIDE + BOX_STRIDE));
          setChunkReceiveShadows(mesh, this.receiveShadows);
          this.#meshes[chunk * levels + lod] = mesh;
          this.#geometry[chunk * levels + lod] = geometry;
        }
      }
    }
    this.#appliedReceiveShadows = this.receiveShadows;
  }

  /**
   * Builds the terrain's PBR material and attaches the generated splat surface shader.
   *
   * @param asset - The delivered asset.
   * @returns The material handle, with one holder — this component.
   */
  #createMaterial(asset: TerrainAsset): AssetHandle<MaterialAsset> {
    const definition = asset.definition;
    const textures: Record<string, string> = {};
    const held: AssetHandle<TextureAsset>[] = [];
    for (let index = 0; index < asset.controlTextures.length; index += 1) {
      const texture = asset.controlTextures[index];
      if (texture !== undefined) {
        textures[`control${String(index)}`] = texture.address;
        held.push(texture);
      }
    }
    if (asset.layers.albedo !== null) {
      textures["albedo"] = asset.layers.albedo.address;
      held.push(asset.layers.albedo);
    }
    if (asset.layers.normals !== null) {
      textures["normals"] = asset.layers.normals.address;
      held.push(asset.layers.normals);
    }
    this.#writeSplatUniforms(asset);
    const material = createMaterialAsset(
      this.app,
      pbrMaterialDefinition({
        name: `${definition.name}-terrain`,
        roughness: definition.material.roughness,
        metallic: definition.material.metallic,
        surfaces: [
          {
            shader: asset.shader.address,
            name: TERRAIN_SPLAT_NAME,
            // The declaration's other defaults are baked into the generated file; only where the
            // terrain sits in the world is per-entity.
            values: {
              origin: [this.#origin[0] ?? 0, this.#origin[1] ?? 0],
              invSize: [this.#invSize[0] ?? 1, this.#invSize[1] ?? 1],
            },
            textures,
            enabled: true,
            priority: SPLAT_PRIORITY,
          },
        ],
      }),
      held,
    );
    this.#splatBinding = material.value.surface(TERRAIN_SPLAT_NAME);
    return material;
  }

  /**
   * Writes where the terrain sits in world XZ and how large it is into the scratch uniforms, so the
   * shader can turn a world position into a control-map coordinate.
   *
   * @param asset - The delivered asset.
   * @returns `true` when either value changed.
   */
  #writeSplatUniforms(asset: TerrainAsset): boolean {
    const size = asset.definition.size;
    const width = size.width * this.#scale.x;
    const depth = size.depth * this.#scale.z;
    const invWidth = width === 0 ? 0 : 1 / width;
    const invDepth = depth === 0 ? 0 : 1 / depth;
    const changed =
      this.#origin[0] !== this.#position.x ||
      this.#origin[1] !== this.#position.z ||
      this.#invSize[0] !== invWidth ||
      this.#invSize[1] !== invDepth;
    this.#origin[0] = this.#position.x;
    this.#origin[1] = this.#position.z;
    this.#invSize[0] = invWidth;
    this.#invSize[1] = invDepth;
    return changed;
  }

  /**
   * Re-uploads the splat uniforms, but only on a frame where the entity moved or was rescaled.
   *
   * @param asset - The delivered asset.
   */
  #updateSplatOrigin(asset: TerrainAsset): void {
    const binding = this.#splatBinding;
    if (binding === null || !this.#writeSplatUniforms(asset)) {
      return;
    }
    binding.set("origin", this.#origin);
    binding.set("invSize", this.#invSize);
  }

  /** Pushes a changed `receiveShadows` onto every chunk. */
  #syncReceiveShadows(): void {
    if (this.receiveShadows === this.#appliedReceiveShadows) {
      return;
    }
    this.#appliedReceiveShadows = this.receiveShadows;
    for (let index = 0; index < this.#meshes.length; index += 1) {
      const mesh = this.#meshes[index];
      if (mesh !== null && mesh !== undefined) {
        setChunkReceiveShadows(mesh, this.receiveShadows);
      }
    }
  }

  /**
   * Writes one chunk's local bounding box.
   *
   * @param field - The height field.
   * @param chunkX - The chunk column.
   * @param chunkZ - The chunk row.
   */
  #writeLocalBounds(field: HeightField, chunkX: number, chunkZ: number): void {
    const definition = this.#asset?.definition;
    if (definition === undefined) {
      return;
    }
    chunkBounds(field, chunkX, chunkZ, definition.chunks.size, definition.chunks.skirtDepth, this.#box);
    const at = (chunkZ * this.#chunksPerSide + chunkX) * BOX_STRIDE;
    for (let index = 0; index < BOX_STRIDE; index += 1) {
      this.#localBounds[at + index] = this.#box[index] ?? 0;
    }
  }

  /** Transforms every chunk's local box into world space; translation and scale only. */
  #writeWorldBounds(): void {
    const local = this.#localBounds;
    const world = this.#worldBounds;
    const position = this.#position;
    const scale = this.#scale;
    for (let index = 0; index < local.length; index += BOX_STRIDE) {
      world[index] = (local[index] ?? 0) * scale.x + position.x;
      world[index + 1] = (local[index + 1] ?? 0) * scale.y + position.y;
      world[index + 2] = (local[index + 2] ?? 0) * scale.z + position.z;
      world[index + 3] = (local[index + 3] ?? 0) * scale.x + position.x;
      world[index + 4] = (local[index + 4] ?? 0) * scale.y + position.y;
      world[index + 5] = (local[index + 5] ?? 0) * scale.z + position.z;
    }
  }

  /**
   * Rewrites the positions, normals, and bounds of every chunk a sculpt touched.
   *
   * @param asset - The delivered asset.
   * @param x - The first edited sample column.
   * @param z - The first edited sample row.
   * @param width - How many columns were edited.
   * @param depth - How many rows were edited.
   */
  #rebuildRegion(asset: TerrainAsset, x: number, z: number, width: number, depth: number): void {
    const definition = asset.definition;
    const chunkSize = definition.chunks.size;
    const side = this.#chunksPerSide;
    const levels = this.#lodLevels;
    const last = side - 1;
    // Normals read one sample past the edit, so the touched band is one sample wider on each side.
    const firstX = clampIndex(Math.floor((x - NORMAL_MARGIN) / chunkSize), last);
    const lastX = clampIndex(Math.floor((x + width - 1 + NORMAL_MARGIN) / chunkSize), last);
    const firstZ = clampIndex(Math.floor((z - NORMAL_MARGIN) / chunkSize), last);
    const lastZ = clampIndex(Math.floor((z + depth - 1 + NORMAL_MARGIN) / chunkSize), last);
    const engine = this.app.isHeadless ? null : this.app.lite.engine;
    for (let chunkZ = firstZ; chunkZ <= lastZ; chunkZ += 1) {
      for (let chunkX = firstX; chunkX <= lastX; chunkX += 1) {
        this.#writeLocalBounds(asset.field, chunkX, chunkZ);
        if (engine === null) {
          continue;
        }
        const chunk = chunkZ * side + chunkX;
        const box = this.#localBounds.subarray(chunk * BOX_STRIDE, chunk * BOX_STRIDE + BOX_STRIDE);
        for (let lod = 0; lod < levels; lod += 1) {
          const geometry = this.#geometry[chunk * levels + lod];
          const mesh = this.#meshes[chunk * levels + lod];
          if (geometry === undefined || geometry === null || mesh === undefined || mesh === null) {
            continue;
          }
          writeChunkVertices(
            asset.field,
            chunkX,
            chunkZ,
            lod,
            chunkSize,
            definition.chunks.skirtDepth,
            geometry.positions,
            geometry.normals,
          );
          updateChunkMesh(engine, mesh, geometry.positions, geometry.normals, box);
        }
      }
    }
  }

  /** Destroys every chunk mesh, releases the material, and forgets the asset. */
  #teardown(): void {
    if (this.#meshes.length > 0 && !this.app.isHeadless) {
      const scene = this.world.lite.scene;
      for (let index = 0; index < this.#meshes.length; index += 1) {
        const mesh = this.#meshes[index];
        if (mesh !== null && mesh !== undefined) {
          destroyChunkMesh(scene, mesh);
        }
      }
    }
    this.#meshes = [];
    this.#geometry = [];
    this.#material?.release();
    this.#material = null;
    this.#splatBinding = null;
    this.#asset = null;
    this.#chunksPerSide = 0;
    this.#lodLevels = 0;
    this.#visibleChunks = 0;
    this.#lods = new Int32Array(0);
    this.#localBounds = new Float32Array(0);
    this.#worldBounds = new Float32Array(0);
  }
}

/**
 * Clamps a chunk index into the grid.
 *
 * @param value - The index.
 * @param last - The largest valid index.
 * @returns The clamped index.
 */
function clampIndex(value: number, last: number): number {
  return value < 0 ? 0 : value > last ? last : value;
}
