import { createDefaults, defineSchema } from "@ignifx/core";
import { Collider2D, collider2DFields } from "./collider.js";
import type { CollectedShape2D } from "./collider.js";
import type { TilemapCollisionData } from "@ignifx/2d";
import type { Schema, Vec2Like } from "@ignifx/core";

/**
 * `TilemapCollider2D` (`docs/architecture/11-2d-toolkit.md` §2.5, §8): the merged collision surface
 * of a `Tilemap`, turned into Rapier geometry.
 *
 * ## How it reaches the data
 *
 * `@ignifx/2d` is an **optional** peer of `@ignifx/physics-2d` (a physics-only 2D game needs no
 * sprite toolkit), so this component never imports the toolkit as a value — only the
 * `TilemapCollisionData` type. A game, or `@ignifx/2d`'s own tilemap loader, assigns
 * {@link TilemapCollider2D.collisionData}; the runtime compares the data's `version` at the start of
 * every fixed step and rebuilds the shapes when it changes, which is the same moment
 * `Tilemap.onCollisionChanged` fires and needs no signal subscription across the package boundary.
 *
 * ## Why closed polylines rather than polygons
 *
 * A merged run of solid tiles is not convex in general — an L of tiles merges into an L — and
 * Rapier's polygon shape is a **convex hull** (`geometry/shape.d.ts`, `ConvexPolygon`), which would
 * silently fill the notch. A closed `polyline` reproduces the outline exactly and is the shape
 * static level geometry wants; the trade-off is that a polyline is infinitely thin, so a body that
 * starts inside the tilemap is not pushed out.
 */

/**
 * The collision surface of a tilemap, as one static body's worth of Rapier shapes.
 *
 * @example
 * ```ts
 * const map = world.createEntity("Map");
 * const collider = map.addComponent(TilemapCollider2D);
 * collider.collisionData = tilemap.collisionData;
 * ```
 *
 * @public
 */
export class TilemapCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/TilemapCollider2D";

  /** The serialized field declarations; the geometry itself comes from the tilemap asset. */
  static schema: Schema = tilemapSchema();

  /** The merged chunk geometry, or `null` until a tilemap supplies it. */
  #data: TilemapCollisionData | null = null;

  /** The `version` of the data the current shapes were built from. */
  #builtVersion = -1;

  /** Applies the shared defaults. */
  constructor() {
    super();
    Object.assign(this, createDefaults(TilemapCollider2D.schema));
  }

  /**
   * The merged chunk geometry this collider builds shapes from.
   *
   * @returns The data, or `null` when none has been supplied.
   */
  get collisionData(): TilemapCollisionData | null {
    return this.#data;
  }

  /**
   * Replaces the tilemap geometry and schedules a rebuild.
   *
   * @param value - The merged chunk geometry, or `null` to drop the shapes.
   */
  set collisionData(value: TilemapCollisionData | null) {
    this.#data = value;
    this.#builtVersion = -1;
    this.rebuild();
  }

  /**
   * Whether the supplied data has changed since the shapes were built. The runtime polls this once
   * per fixed step, which is how a tile edit reaches physics without a cross-package subscription.
   *
   * @returns `true` when a rebuild is due.
   *
   * @internal
   */
  needsRebuild(): boolean {
    return (this.#data?.version ?? -1) !== this.#builtVersion;
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
    const data = this.#data;
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
