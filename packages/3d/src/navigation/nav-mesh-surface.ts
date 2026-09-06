import {
  bool,
  Component,
  createDefaults,
  defineSchema,
  f32,
  layerMask,
  LayerMask,
  MeshRenderer,
  Signal,
  str,
  u32,
  Vec3,
} from "@ignifx/core";
import { threeDError, ThreeDErrorCode } from "../errors.js";
import {
  bakeFromMeshes,
  bakeFromSources,
  castRay,
  computeCorners,
  destroyPlugin,
  makeCrowd,
  seed,
  snap,
  toSource,
} from "../lite/navigation/plugin.js";
import type { LiteNavCrowd, LiteNavMeshSource, LiteNavigationPlugin } from "../lite/types.js";
import type { ComponentHooks, LiteSceneNode, MutableVec3, Schema, Vec3Like } from "@ignifx/core";

/**
 * `NavMeshSurface` (`docs/architecture/12-3d-toolkit.md` §5): one baked navmesh and the crowd its
 * agents belong to.
 *
 * A surface owns a Babylon Lite navigation plugin of its own. Recast's module is a process-wide
 * singleton, but each plugin object holds its own navmesh, tile cache, and query
 * (`lib/navigation/navigation.js` 30-45), so two surfaces in one world — an indoor mesh and an
 * outdoor one, say — never see each other's geometry.
 *
 * ## Where the geometry comes from
 *
 * Two paths, and a surface uses whichever it has:
 *
 * - {@link NavMeshSurface.addSource} takes world-space `{ positions, indices }` directly. This is
 *   the path a procedural level uses, and the only one that works under a headless app — which is
 *   what makes the navigation tests of Phase 7 run in plain Node.
 * - Otherwise the surface collects the Lite meshes of every enabled `MeshRenderer` whose entity's
 *   layer is in {@link NavMeshSurface.layerMask} and lets Lite transform and merge them.
 *
 * ## Pre-baked navmeshes
 *
 * `12-3d-toolkit.md` §5 also describes loading a `.navmesh.bin` produced by `ignifx bake navmesh`.
 * Babylon Lite 1.27.0 declares no navmesh serialization at all — there is no `getNavMeshData` and
 * no `buildFromNavMeshData` in `index.d.ts` — so a surface that names one reports `IGX-1210` and
 * bakes at runtime instead. `docs/adr/0017-navigation-wasm.md` records the finding.
 */

/** Recast's default cell size, in metres. */
const DEFAULT_CELL_SIZE = 0.2;

/** Recast's default cell height, in metres. */
const DEFAULT_CELL_HEIGHT = 0.2;

/** The default walkable slope, in degrees. */
const DEFAULT_SLOPE = 45;

/** How many agents a surface's crowd holds unless the game says otherwise. */
const DEFAULT_MAX_AGENTS = 64;

/**
 * Builds the `NavMeshSurface` field declarations.
 *
 * @returns The schema.
 */
function navMeshSurfaceSchema(): Schema {
  return defineSchema({
    layers: layerMask([], { tooltip: "Which layers' MeshRenderers are baked; empty means every layer." }),
    bakeOnAwake: bool(true, { tooltip: "Whether the surface bakes itself as soon as it is enabled." }),
    cellSize: f32(DEFAULT_CELL_SIZE, { min: 0.01, tooltip: "Recast voxel width, in metres." }),
    cellHeight: f32(DEFAULT_CELL_HEIGHT, { min: 0.01, tooltip: "Recast voxel height, in metres." }),
    walkableSlopeAngle: f32(DEFAULT_SLOPE, { min: 0, max: 90, tooltip: "The steepest walkable slope, in degrees." }),
    agentHeight: f32(2, { min: 0.01, tooltip: "The headroom an agent needs, in metres." }),
    agentRadius: f32(0.5, { min: 0, tooltip: "How far agents stay from a wall, in metres." }),
    agentClimb: f32(0.4, { min: 0, tooltip: "The tallest step an agent walks up, in metres." }),
    maxEdgeLength: f32(12, { min: 0, tooltip: "The longest contour edge, in voxels." }),
    maxSimplificationError: f32(1.3, { min: 0, tooltip: "How far a simplified edge may stray, in voxels." }),
    minRegionArea: f32(8, { min: 0, tooltip: "Regions smaller than this are discarded, in voxels squared." }),
    mergeRegionArea: f32(20, { min: 0, tooltip: "Regions smaller than this are merged, in voxels squared." }),
    maxVertsPerPoly: u32(6, { min: 3, tooltip: "The largest navmesh polygon, in vertices." }),
    detailSampleDistance: f32(6, { min: 0, tooltip: "Detail-mesh sampling distance, in voxels." }),
    detailSampleMaxError: f32(1, { min: 0, tooltip: "Detail-mesh vertical error, in voxels." }),
    tileSize: u32(0, { tooltip: "Tile size in voxels; 32-64 when maxObstacles is above zero." }),
    maxObstacles: u32(0, { tooltip: "How many NavMeshObstacles fit; above zero builds a tile cache." }),
    maxAgents: u32(DEFAULT_MAX_AGENTS, { min: 1, tooltip: "How many NavMeshAgents this surface's crowd holds." }),
    maxAgentRadius: f32(1, { min: 0.01, tooltip: "The largest agent radius the crowd will see, in metres." }),
    randomSeed: u32(0, { tooltip: "The seed Recast's randomized queries use, so paths are reproducible." }),
    prebaked: str("", { tooltip: "A .navmesh.bin address; unsupported by the pinned Babylon Lite." }),
  });
}

/**
 * One baked navmesh.
 *
 * @example
 * ```ts
 * const surface = level.addComponent(NavMeshSurface, { agentRadius: 0.4, maxObstacles: 8 });
 * surface.onBaked.connect(() => app.log.info("navmesh ready"), { owner: surface });
 * await surface.bake();
 * ```
 *
 * @public
 */
export class NavMeshSurface extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/NavMeshSurface";

  /** One surface per entity; a second navmesh wants its own. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = navMeshSurfaceSchema();

  /** Which layers' `MeshRenderer`s are baked; an empty list means every layer. */
  declare layers: readonly string[];

  /** Whether the surface bakes itself as soon as it is enabled. */
  declare bakeOnAwake: boolean;

  /** Recast voxel width, in metres. */
  declare cellSize: number;

  /** Recast voxel height, in metres. */
  declare cellHeight: number;

  /** The steepest walkable slope, in degrees. */
  declare walkableSlopeAngle: number;

  /** The headroom an agent needs, in metres. */
  declare agentHeight: number;

  /** How far agents stay from a wall, in metres. */
  declare agentRadius: number;

  /** The tallest step an agent walks up, in metres. */
  declare agentClimb: number;

  /** The longest contour edge, in voxels. */
  declare maxEdgeLength: number;

  /** How far a simplified edge may stray, in voxels. */
  declare maxSimplificationError: number;

  /** Regions smaller than this are discarded. */
  declare minRegionArea: number;

  /** Regions smaller than this are merged. */
  declare mergeRegionArea: number;

  /** The largest navmesh polygon, in vertices. */
  declare maxVertsPerPoly: number;

  /** Detail-mesh sampling distance, in voxels. */
  declare detailSampleDistance: number;

  /** Detail-mesh vertical error, in voxels. */
  declare detailSampleMaxError: number;

  /** Tile size in voxels. */
  declare tileSize: number;

  /** How many obstacles fit; above zero builds a tile cache. */
  declare maxObstacles: number;

  /** How many agents this surface's crowd holds. */
  declare maxAgents: number;

  /** The largest agent radius the crowd will see. */
  declare maxAgentRadius: number;

  /** The seed Recast's randomized queries use. */
  declare randomSeed: number;

  /** A `.navmesh.bin` address; unsupported by the pinned Babylon Lite. */
  declare prebaked: string;

  #plugin: LiteNavigationPlugin | null = null;

  #crowd: LiteNavCrowd | null = null;

  #isBaked = false;

  #isBaking = false;

  #agentCount = 0;

  readonly #sources: LiteNavMeshSource[] = [];

  readonly #onBaked: Signal<NavMeshSurface> = new Signal<NavMeshSurface>();

  readonly #scratch: MutableVec3 = new Vec3();

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(NavMeshSurface.schema));
  }

  /**
   * Fires once each time the surface finishes baking.
   *
   * @returns Fires once each time the surface finishes baking.
   */
  get onBaked(): Signal<NavMeshSurface> {
    return this.#onBaked;
  }

  /**
   * Whether a navmesh exists and queries will answer.
   *
   * @returns Whether a navmesh exists and queries will answer.
   */
  get isBaked(): boolean {
    return this.#isBaked;
  }

  /**
   * Whether a bake is in flight.
   *
   * @returns Whether a bake is in flight.
   */
  get isBaking(): boolean {
    return this.#isBaking;
  }

  /**
   * How many geometry sources have been added by hand.
   *
   * @returns How many geometry sources have been added by hand.
   */
  get sourceCount(): number {
    return this.#sources.length;
  }

  /**
   * The Babylon Lite objects this surface owns. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3).
   *
   * @returns The Recast plugin and the crowd, or `null` before the bake.
   */
  get lite(): { readonly plugin: LiteNavigationPlugin | null; readonly crowd: LiteNavCrowd | null } {
    return { plugin: this.#plugin, crowd: this.#crowd };
  }

  /** Releases the plugin's navmesh, tile cache, and query. */
  onDetach(): void {
    const plugin = this.#plugin;
    this.#plugin = null;
    this.#crowd = null;
    this.#isBaked = false;
    this.#sources.length = 0;
    if (plugin !== null) {
      destroyPlugin(plugin);
    }
  }

  /**
   * Adds a piece of geometry to bake from.
   *
   * @remarks
   * This is the headless path: Lite's `createNavMeshFromSources` takes plain arrays, so a level
   * built in code — or a test's floor and wall — can be baked with no GPU anywhere in sight.
   *
   * @param positions - Three floats per vertex.
   * @param indices - Three indices per triangle.
   * @param worldMatrix - A column-major 4x4 to transform the positions by, or `null` when they are
   * already in world space.
   *
   * @example
   * ```ts
   * surface.addSource(floorPositions, floorIndices, null);
   * ```
   */
  addSource(positions: ArrayLike<number>, indices: ArrayLike<number>, worldMatrix: ArrayLike<number> | null): void {
    this.#sources.push(toSource(positions, indices, worldMatrix));
  }

  /** Drops every hand-added source, so the next bake starts clean. */
  clearSources(): void {
    this.#sources.length = 0;
  }

  /**
   * Loads Recast if it is not loaded yet, then bakes the navmesh and creates the crowd.
   *
   * @remarks
   * Baking replaces whatever the surface had: agents that had already joined the old crowd are
   * asked to rejoin on their next fixed step.
   *
   * @returns `true` when a navmesh was built.
   * @throws IgnifxError with code `IGX-1206` when Recast cannot be loaded.
   *
   * @example
   * ```ts
   * await surface.bake();
   * ```
   */
  async bake(): Promise<boolean> {
    if (this.#isBaking) {
      return false;
    }
    this.#isBaking = true;
    try {
      if (this.prebaked !== "") {
        this.app.log.warn(
          "{surface} names the pre-baked navmesh {file}, which the pinned Babylon Lite cannot read; baking at runtime.",
          this.entity.name,
          this.prebaked,
        );
      }
      const plugin = await this.app.navigation.acquirePlugin();
      this.#plugin = plugin;
      const baked = this.#buildMesh(plugin);
      if (!baked) {
        this.#isBaked = false;
        return false;
      }
      seed(plugin, this.randomSeed);
      this.#crowd = makeCrowd(plugin, this.maxAgents, this.maxAgentRadius);
      this.#agentCount = 0;
      this.#isBaked = true;
      this.#onBaked.emit(this);
      return true;
    } finally {
      this.#isBaking = false;
    }
  }

  /**
   * Computes a path across this surface.
   *
   * @param from - The start, in world space.
   * @param to - The end, in world space.
   * @returns The corner points, start first. Empty when there is no navmesh or no path.
   */
  findPath(from: Vec3Like, to: Vec3Like): readonly Vec3[] {
    const plugin = this.#plugin;
    if (plugin === null || !this.#isBaked) {
      return [];
    }
    const corners = computeCorners(plugin, from, to);
    const out: Vec3[] = [];
    for (const corner of corners) {
      out.push(new Vec3(corner.x, corner.y, corner.z));
    }
    return out;
  }

  /**
   * Snaps a point onto this surface.
   *
   * @param point - The point, in world space.
   * @param out - Where to write the snapped point; a fresh `Vec3` when omitted.
   * @returns The snapped point, or `null` when there is no navmesh.
   */
  closestPoint(point: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 | null {
    const plugin = this.#plugin;
    if (plugin === null || !this.#isBaked) {
      return null;
    }
    return snap(plugin, point, out) ? out : null;
  }

  /**
   * Casts a walkability ray across this surface.
   *
   * @param from - The start, in world space.
   * @param to - The end, in world space.
   * @param out - Where to write the hit point; a fresh `Vec3` when omitted.
   * @returns The point where the walkable surface ends, or `null` when the segment is clear.
   */
  raycast(from: Vec3Like, to: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 | null {
    const plugin = this.#plugin;
    if (plugin === null || !this.#isBaked) {
      return null;
    }
    return castRay(plugin, from, to, out) ? out : null;
  }

  /**
   * Reserves a slot in this surface's crowd.
   *
   * @returns `true` when there is room.
   *
   * @internal
   */
  reserveAgent(): boolean {
    if (this.#agentCount >= this.maxAgents) {
      return false;
    }
    this.#agentCount += 1;
    return true;
  }

  /**
   * The crowd agents join, or `null` before the bake.
   *
   * @returns The crowd agents join, or `null` before the bake.
   */
  get crowd(): LiteNavCrowd | null {
    return this.#crowd;
  }

  /**
   * The plugin obstacles are added to, or `null` before the bake.
   *
   * @returns The plugin obstacles are added to, or `null` before the bake.
   */
  get plugin(): LiteNavigationPlugin | null {
    return this.#plugin;
  }

  /**
   * Scratch the agent system borrows, so a fixed step allocates nothing.
   *
   * @returns Scratch the agent system borrows, so a fixed step allocates nothing.
   */
  get scratch(): MutableVec3 {
    return this.#scratch;
  }

  /**
   * Bakes from whichever geometry the surface has.
   *
   * @param plugin - The Recast plugin.
   * @returns `true` when geometry was found and a navmesh was built.
   */
  #buildMesh(plugin: LiteNavigationPlugin): boolean {
    const params = this.#parameters();
    if (this.#sources.length > 0) {
      bakeFromSources(plugin, this.#sources, params);
      return true;
    }
    const meshes = this.#collectMeshes();
    if (meshes.length === 0) {
      this.app.onError.emit({
        error: threeDError(
          ThreeDErrorCode.emptyNavMesh,
          `${this.entity.name} was baked from no source geometry; every navigation query will fail.`,
          { context: { surface: this.entity.name }, hint: "Call addSource(), or widen the surface's layerMask." },
        ),
        source: "lifecycle",
        phase: null,
        entity: this.entity,
        component: this,
      });
      return false;
    }
    bakeFromMeshes(plugin, meshes, params);
    return true;
  }

  /**
   * Gathers the Lite meshes of every enabled `MeshRenderer` on a matching layer.
   *
   * @returns The meshes; empty under a headless app, which uploads no geometry.
   */
  #collectMeshes(): readonly LiteSceneNode[] {
    const out: LiteSceneNode[] = [];
    const mask =
      this.layers.length === 0 ? LayerMask.everything() : LayerMask.fromNames(this.world.layers, this.layers);
    const renderers = this.world.components(MeshRenderer);
    for (let index = 0; index < renderers.length; index += 1) {
      const renderer = renderers[index];
      if (renderer === undefined || !renderer.isEnabledInHierarchy) {
        continue;
      }
      if (!mask.has(renderer.entity.layer)) {
        continue;
      }
      const mesh = renderer.lite.mesh;
      if (mesh !== null) {
        out.push(mesh);
      }
    }
    return out;
  }

  /**
   * The Recast build parameters this surface's fields describe.
   *
   * @returns The parameters, with the tile size forced above zero when obstacles are wanted.
   */
  #parameters(): NavMeshParametersLike {
    const wantsTileCache = this.maxObstacles > 0;
    return {
      cs: this.cellSize,
      ch: this.cellHeight,
      walkableSlopeAngle: this.walkableSlopeAngle,
      // Recast counts height, climb, and radius in voxels, not metres.
      walkableHeight: Math.ceil(this.agentHeight / this.cellHeight),
      walkableClimb: Math.floor(this.agentClimb / this.cellHeight),
      walkableRadius: Math.ceil(this.agentRadius / this.cellSize),
      maxEdgeLen: this.maxEdgeLength,
      maxSimplificationError: this.maxSimplificationError,
      minRegionArea: this.minRegionArea,
      mergeRegionArea: this.mergeRegionArea,
      maxVertsPerPoly: this.maxVertsPerPoly,
      detailSampleDist: this.detailSampleDistance,
      detailSampleMaxError: this.detailSampleMaxError,
      ...(this.tileSize > 0 ? { tileSize: this.tileSize } : wantsTileCache ? { tileSize: 32 } : {}),
      ...(wantsTileCache ? { maxObstacles: this.maxObstacles } : {}),
    };
  }
}

/** The subset of Lite's `NavMeshParameters` a surface fills in. */
interface NavMeshParametersLike {
  readonly cs: number;
  readonly ch: number;
  readonly walkableSlopeAngle: number;
  readonly walkableHeight: number;
  readonly walkableClimb: number;
  readonly walkableRadius: number;
  readonly maxEdgeLen: number;
  readonly maxSimplificationError: number;
  readonly minRegionArea: number;
  readonly mergeRegionArea: number;
  readonly maxVertsPerPoly: number;
  readonly detailSampleDist: number;
  readonly detailSampleMaxError: number;
  readonly tileSize?: number;
  readonly maxObstacles?: number;
}
