import { createDefaults, defineSchema } from "@ignifx/core";
import { Collider2D, collider2DFields } from "./collider.js";
import type { CollectedShape2D } from "./collider.js";
import type { Tilemap, TilemapCollisionData } from "@ignifx/2d";
import type { Component, Schema, Vec2Like } from "@ignifx/core";

/**
 * Read tile collision data through the optional 2D toolkit's type and rebuild when it changes.
 * The sibling `Tilemap` is found by its registered type id, because `@ignifx/2d` is an optional
 * peer and must not be imported as a value. Closed polylines preserve concave tile outlines that
 * convex hulls would fill in. They are thin surfaces, so a body starting inside the map is not
 * pushed out.
 */

/** The type id `@ignifx/2d` registers `Tilemap` under. */
const TILEMAP_TYPE_ID = "ignifx/Tilemap";

/**
 * The collision surface of a tilemap, as one static body's worth of Rapier shapes.
 *
 * @remarks
 * The collider reads the `Tilemap` on its own entity, so a scene file that holds both components
 * has tile collision as soon as it loads. It follows that tilemap: a tile edit, a new map, or a
 * tilemap added later all reach physics at the next fixed step. Assign
 * {@link TilemapCollider2D.collisionData} only to use other geometry, such as data you built in
 * code or a tilemap on another entity.
 *
 * @example
 * ```ts
 * const level = world.createEntity("Level");
 * level.addComponent(Tilemap).map = app.assets.load<TilemapAsset>("level.tilemap.json");
 * level.addComponent(TilemapCollider2D); // reads the Tilemap beside it
 * ```
 *
 * @public
 */
export class TilemapCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/TilemapCollider2D";

  /** The serialized field declarations; the geometry itself comes from the tilemap asset. */
  static schema: Schema = tilemapSchema();

  /** Geometry that code assigned, which takes the place of the sibling tilemap's. */
  #override: TilemapCollisionData | null = null;

  /** The data the current shapes were built from. */
  #builtData: TilemapCollisionData | null = null;

  /** The `version` of that data when the shapes were built. */
  #builtVersion = -1;

  /** Applies the shared defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(TilemapCollider2D.schema));
  }

  /**
   * The merged chunk geometry this collider builds shapes from: the assigned data, or else the
   * `Tilemap` on the same entity.
   *
   * @remarks
   * Reading it works in an edit-mode app too, where no body is built (ADR-0028), so an editor can
   * draw the outlines.
   *
   * @returns The data, or `null` when nothing was assigned and the entity has no `Tilemap`.
   */
  get collisionData(): TilemapCollisionData | null {
    return this.#override ?? siblingCollisionData(this);
  }

  /**
   * Uses other geometry instead of the sibling tilemap's, and schedules a rebuild.
   *
   * @param value - The merged chunk geometry, or `null` to go back to the `Tilemap` on the same
   * entity (no shapes when there is none).
   */
  set collisionData(value: TilemapCollisionData | null) {
    this.#override = value;
    this.#builtData = null;
    this.#builtVersion = -1;
    this.rebuild();
  }

  /**
   * Whether the supplied data has changed since the shapes were built. The runtime polls this once
   * per fixed step, which is how a tile edit reaches physics without a cross-package subscription.
   *
   * @remarks
   * A disabled collider, or one on an inactive entity, builds no shapes, so it answers `false`
   * rather than asking for the same empty rebuild every step. Enabling it again finds the data
   * changed and rebuilds.
   *
   * @returns `true` when a rebuild is due.
   *
   * @internal
   */
  needsRebuild(): boolean {
    if (!this.isEnabledInHierarchy) {
      return false;
    }
    const data = this.collisionData;
    return data !== this.#builtData || (data?.version ?? -1) !== this.#builtVersion;
  }

  /**
   * Appends one shape per merged outline and one per one-way edge.
   *
   * @param scale - The entity's lossy 2D scale.
   * @param out - The list to append to.
   *
   * @internal
   */
  collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void {
    const data = this.collisionData;
    this.#builtData = data;
    this.#builtVersion = data?.version ?? -1;
    if (data === null) {
      return;
    }
    const offset = { x: this.offset.x * scale.x, y: this.offset.y * scale.y };
    for (const chunk of data.chunks) {
      for (const polygon of chunk.polygons) {
        if (polygon.length < 3) {
          continue;
        }
        out.push({
          shape: { kind: "polyline", points: closedLoop(polygon, scale) },
          offset,
          rotation: 0,
          oneWay: false,
        });
      }
      for (const edge of chunk.oneWayEdges) {
        out.push({
          shape: { kind: "polyline", points: segment(edge[0], edge[1], scale) },
          offset,
          rotation: 0,
          oneWay: true,
        });
      }
    }
  }
}

/**
 * Reads the collision data of the `Tilemap` on a collider's entity.
 *
 * @param collider - The collider.
 * @returns The tilemap's merged geometry, or `null` when the entity has no `Tilemap` or the 2D
 * toolkit is not registered.
 */
function siblingCollisionData(collider: TilemapCollider2D): TilemapCollisionData | null {
  const type = collider.world.registry.get(TILEMAP_TYPE_ID);
  const tilemap = type === null ? null : collider.entity.getComponent(type);
  return tilemap !== null && isTilemap(tilemap) ? tilemap.collisionData : null;
}

/**
 * Whether a component registered as `ignifx/Tilemap` has the shape this package reads.
 *
 * @param component - The component.
 * @returns `true` when it carries `collisionData`.
 */
function isTilemap(component: Component): component is Tilemap {
  return "collisionData" in component;
}

/**
 * Builds the `TilemapCollider2D` schema.
 *
 * @returns The schema.
 */
function tilemapSchema(): Schema {
  return defineSchema({ ...collider2DFields() });
}

/**
 * Packs an outline as a closed chain of vertices.
 *
 * @param points - The outline, wound counter-clockwise.
 * @param scale - The entity's lossy 2D scale.
 * @returns A fresh buffer whose last vertex repeats the first.
 */
function closedLoop(points: readonly Vec2Like[], scale: Vec2Like): Float32Array {
  const packed = new Float32Array((points.length + 1) * 2);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) {
      continue;
    }
    packed[index * 2] = point.x * scale.x;
    packed[index * 2 + 1] = point.y * scale.y;
  }
  packed[points.length * 2] = packed[0] ?? 0;
  packed[points.length * 2 + 1] = packed[1] ?? 0;
  return packed;
}

/**
 * Packs one one-way edge as a two-vertex chain.
 *
 * @param from - The edge's start.
 * @param to - The edge's end.
 * @param scale - The entity's lossy 2D scale.
 * @returns A fresh buffer.
 */
function segment(from: Vec2Like, to: Vec2Like, scale: Vec2Like): Float32Array {
  return new Float32Array([from.x * scale.x, from.y * scale.y, to.x * scale.x, to.y * scale.y]);
}
