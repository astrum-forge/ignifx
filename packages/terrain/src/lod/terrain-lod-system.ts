import { Mat4, Vec3 } from "@ignifx/core";
import { TerrainScatter } from "../components/terrain-scatter.js";
import { Terrain } from "../components/terrain.js";
import { Frustum } from "./frustum.js";
import type { Camera, DiagnosticsGroup, MutableVec3, System, SystemContext, World } from "@ignifx/core";

/**
 * `TerrainLodSystem`: one `PreRender` pass that builds terrains whose asset has arrived, picks each
 * chunk's level of detail, and culls the chunks the camera cannot see
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2).
 *
 * Babylon Lite does not frustum-cull plain meshes (spike S0.3), so the culling is the system's own:
 * six planes from the main camera's view-projection against each chunk's world box.
 */

/**
 * The counters the terrain group publishes, in index order.
 *
 * @public
 */
export const TERRAIN_DIAGNOSTICS_COUNTERS: readonly string[] = Object.freeze([
  "chunks",
  "visibleChunks",
  "drawCalls",
  "scatterInstances",
]);

/**
 * The diagnostics group name (`docs/architecture/15-devtools-and-diagnostics.md` §3).
 *
 * @public
 */
export const TERRAIN_DIAGNOSTICS_GROUP = "terrain";

/**
 * The `PreRender` order the terrain LOD system runs at.
 *
 * @remarks
 * `10` puts it **after** core's render sync at `0`, because `Camera.getViewMatrix` reads the
 * Babylon Lite camera and that is what the sync writes; running earlier would cull against last
 * frame's view. Chunk meshes are not components, so nothing downstream needs them decided sooner.
 *
 * @public
 */
export const TERRAIN_LOD_ORDER = 10;

/** The counter indices, in the order {@link TERRAIN_DIAGNOSTICS_COUNTERS} declares them. */
const COUNTER_CHUNKS = 0;

/** The visible-chunk counter's index. */
const COUNTER_VISIBLE = 1;

/** The draw-call counter's index. */
const COUNTER_DRAW_CALLS = 2;

/** The scatter-instance counter's index. */
const COUNTER_SCATTER = 3;

/**
 * Selects every terrain's chunk levels of detail and hides what the camera cannot see.
 *
 * @public
 */
export class TerrainLodSystem implements System {
  /** The name diagnostics and error reports use. */
  readonly name = "ignifx/terrain-lod";

  readonly #frustum: Frustum = new Frustum();

  readonly #view: Mat4 = new Mat4();

  readonly #projection: Mat4 = new Mat4();

  readonly #viewProjection: Mat4 = new Mat4();

  readonly #eye: MutableVec3 = new Vec3();

  #counters: DiagnosticsGroup | null = null;

  /**
   * Builds, sculpt-syncs, and level-of-detail-selects every terrain in the world.
   *
   * @param ctx - The world, clock, phase, and delta.
   */
  update(ctx: SystemContext): void {
    const world = ctx.world;
    const terrains = world.components(Terrain);
    const scatters = world.components(TerrainScatter);
    if (terrains.length === 0 && scatters.length === 0) {
      return;
    }
    const frustum = this.#updateFrustum(world);
    const camera = world.mainCamera;
    const eye = camera === null ? null : camera.entity.transform.positionToRef(this.#eye);
    let chunks = 0;
    let visible = 0;
    for (let index = 0; index < terrains.length; index += 1) {
      const terrain = terrains[index];
      if (terrain === undefined || !terrain.isEnabledInHierarchy) {
        continue;
      }
      terrain.syncAsset();
      if (eye !== null) {
        terrain.selectLods(eye.x, eye.y, eye.z, frustum);
      }
      chunks += terrain.chunkCount;
      visible += terrain.visibleChunks;
    }
    let instances = 0;
    for (let index = 0; index < scatters.length; index += 1) {
      const scatter = scatters[index];
      if (scatter === undefined || !scatter.isEnabledInHierarchy) {
        continue;
      }
      scatter.syncPlacement();
      instances += scatter.count;
    }
    this.#publish(world, chunks, visible, instances);
  }

  /**
   * Extracts the main camera's frustum planes.
   *
   * @param world - The world being drawn.
   * @returns The frustum, or `null` when there is no camera to cull against.
   */
  #updateFrustum(world: World): Frustum | null {
    const camera: Camera | null = world.mainCamera;
    if (camera === null) {
      return null;
    }
    camera.getViewMatrix(this.#view);
    camera.getProjectionMatrix(this.#projection);
    Mat4.multiplyToRef(this.#projection.elements, this.#view.elements, this.#viewProjection);
    return this.#frustum.setFromViewProjection(this.#viewProjection.elements) ? this.#frustum : null;
  }

  /**
   * Writes this frame's counters.
   *
   * @param world - The world being drawn.
   * @param chunks - How many chunks every terrain holds.
   * @param visible - How many of them are showing.
   * @param instances - How many scatter instances are placed.
   */
  #publish(world: World, chunks: number, visible: number, instances: number): void {
    this.#counters ??= world.app.diagnostics.groupOrRegister(TERRAIN_DIAGNOSTICS_GROUP, TERRAIN_DIAGNOSTICS_COUNTERS);
    this.#counters.set(COUNTER_CHUNKS, chunks);
    this.#counters.set(COUNTER_VISIBLE, visible);
    this.#counters.set(COUNTER_DRAW_CALLS, visible);
    this.#counters.set(COUNTER_SCATTER, instances);
  }
}
