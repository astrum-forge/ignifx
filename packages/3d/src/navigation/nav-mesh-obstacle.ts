import { Component, createDefaults, defineSchema, entityRef, enumOf, f32, vec3 } from "@ignifx/core";
import { threeDError, ThreeDErrorCode } from "../errors.js";
import { addBox, addCylinder, dropObstacle, flushObstacles } from "../lite/navigation/plugin.js";
import { NavMeshSurface } from "./nav-mesh-surface.js";
import type { LiteObstacleHandle } from "../lite/types.js";
import type { ComponentHooks, Entity, Schema, Vec3Like } from "@ignifx/core";

/**
 * `NavMeshObstacle` (`docs/architecture/12-3d-toolkit.md` §5): a hole punched in a tile-cache
 * navmesh at runtime.
 *
 * Obstacles need a surface baked with `maxObstacles > 0`, which is what makes Lite build a tile
 * cache rather than a solo navmesh (`index.d.ts` 7331-7335). A surface without one reports
 * `IGX-1208` and the obstacle does nothing — better than a silent no-op, because "my crate does not
 * block the guards" is otherwise a very long afternoon.
 *
 * Adding and removing an obstacle re-bakes the affected tiles synchronously
 * (`index.d.ts` 54-58), so an obstacle is a level-scale object — a crate, a closed door — not
 * something to move every frame.
 */

/**
 * Every obstacle shape Lite's tile cache supports.
 *
 * @public
 */
export const NAV_OBSTACLE_SHAPES = ["box", "cylinder"] as const;

/**
 * The union of {@link NAV_OBSTACLE_SHAPES}.
 *
 * @public
 */
export type NavObstacleShape = (typeof NAV_OBSTACLE_SHAPES)[number];

/**
 * Builds the `NavMeshObstacle` field declarations.
 *
 * @returns The schema.
 */
function navMeshObstacleSchema(): Schema {
  return defineSchema({
    surface: entityRef({ tooltip: "The entity carrying the NavMeshSurface to cut; the first baked one when unset." }),
    shape: enumOf(NAV_OBSTACLE_SHAPES, "box", { tooltip: "Whether the hole is a box or a cylinder." }),
    size: vec3({ x: 1, y: 2, z: 1 }, { tooltip: "The box's full size, in metres." }),
    radius: f32(0.5, { min: 0.01, tooltip: "The cylinder's radius, in metres." }),
    height: f32(2, { min: 0.01, tooltip: "The cylinder's height, in metres." }),
  });
}

/**
 * A runtime hole in a navmesh.
 *
 * @example
 * ```ts
 * crate.addComponent(NavMeshObstacle, { shape: "box", size: { x: 1, y: 1, z: 1 } });
 * ```
 *
 * @public
 */
export class NavMeshObstacle extends Component implements ComponentHooks {
  /** The registration id the serializer writes into scene files. */
  static typeId = "ignifx/NavMeshObstacle";

  /** One obstacle per entity. */
  static allowMultiple = false;

  /** The declarative fields (ADR-0004). */
  static schema: Schema = navMeshObstacleSchema();

  /** The entity carrying the surface to cut; the first baked surface when unset. */
  declare surface: Entity | null;

  /** Whether the hole is a box or a cylinder. */
  declare shape: NavObstacleShape;

  /** The box's full size, in metres. */
  declare size: Vec3Like;

  /** The cylinder's radius, in metres. */
  declare radius: number;

  /** The cylinder's height, in metres. */
  declare height: number;

  #handle: LiteObstacleHandle | null = null;

  #surface: NavMeshSurface | null = null;

  /** Applies the schema defaults, exactly as `Component.define` would. */
  constructor() {
    super();
    Object.assign(this, createDefaults(NavMeshObstacle.schema));
  }

  /**
   * Whether the hole is currently cut into a navmesh.
   *
   * @returns Whether the hole is currently cut into a navmesh.
   */
  get isCarved(): boolean {
    return this.#handle !== null;
  }

  /** Fills the hole back in. */
  onDetach(): void {
    this.remove();
  }

  /**
   * Cuts the hole, using the entity's current world position.
   *
   * @param fallback - The surface to use when the component names none.
   * @returns `true` when a hole was cut.
   *
   * @internal
   */
  carve(fallback: NavMeshSurface | null): boolean {
    if (this.#handle !== null) {
      return true;
    }
    const surface = this.surface?.getComponent(NavMeshSurface) ?? fallback;
    const plugin = surface?.plugin ?? null;
    if (surface === null || plugin === null || !surface.isBaked) {
      return false;
    }
    if (surface.maxObstacles <= 0) {
      this.app.onError.emit({
        error: threeDError(
          ThreeDErrorCode.obstaclesNotEnabled,
          `${surface.entity.name} was baked with maxObstacles 0, so it carries no tile cache for obstacles.`,
          { context: { surface: surface.entity.name }, hint: "Set NavMeshSurface.maxObstacles before baking." },
        ),
        source: "lifecycle",
        phase: null,
        entity: this.entity,
        component: this,
      });
      return false;
    }
    const transform = this.entity.transform;
    const position = transform.position;
    this.#handle =
      this.shape === "cylinder"
        ? addCylinder(plugin, position, this.radius, this.height)
        : addBox(
            plugin,
            position,
            { x: this.size.x / 2, y: this.size.y / 2, z: this.size.z / 2 },
            (transform.eulerAngles.y * Math.PI) / 180,
          );
    this.#surface = surface;
    return this.#handle !== null;
  }

  /** Fills the hole back in and flushes the tile cache. */
  remove(): void {
    const handle = this.#handle;
    const plugin = this.#surface?.plugin ?? null;
    this.#handle = null;
    this.#surface = null;
    if (handle !== null && plugin !== null) {
      dropObstacle(plugin, handle);
      flushObstacles(plugin);
    }
  }
}
