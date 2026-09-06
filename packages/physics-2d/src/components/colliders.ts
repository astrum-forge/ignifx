import { array, createDefaults, defineSchema, enumOf, f32, vec2 } from "@ignifx/core";
import { Physics2DErrorCode, physics2DError } from "../errors.js";
import { Collider2D, collider2DFields } from "./collider.js";
import type { CollectedShape2D } from "./collider.js";
import type { Schema, Vec2Like } from "@ignifx/core";

/**
 * The concrete 2D colliders (`docs/architecture/11-2d-toolkit.md` §8). Each maps to one Rapier
 * shape (`geometry/shape.d.ts`), sized in local metres and multiplied by the entity's lossy scale.
 *
 * ## The two point-list colliders
 *
 * - `PolygonCollider2D` builds a **convex** shape (`ColliderDesc.convexHull`). Rapier 2D also ships
 *   `convexDecomposition`, which needs a triangle mesh with an index buffer and runs V-HACD — far
 *   too heavy for a component field. Concave outlines are expressed as several
 *   `PolygonCollider2D`s on one entity, which is what a compound body is for, or as an
 *   `EdgeCollider2D` when the outline is open.
 * - `EdgeCollider2D` builds a `polyline`, the open chain a platformer's ground contour wants. A
 *   polyline is infinitely thin: a fast body can tunnel through it, and a character controller that
 *   starts *inside* one is not pushed out. Static level geometry is what it is for.
 */

/** A quarter turn in radians, which is how a horizontal capsule is expressed. */
const QUARTER_TURN = Math.PI / 2;

/**
 * The axis a 2D capsule stands along.
 *
 * @public
 */
export const CAPSULE_2D_DIRECTIONS = ["x", "y"] as const;

/**
 * The union of {@link CAPSULE_2D_DIRECTIONS}.
 *
 * @public
 */
export type Capsule2DDirection = (typeof CAPSULE_2D_DIRECTIONS)[number];

/**
 * An axis-aligned box collider, sized in local metres.
 *
 * @example
 * ```ts
 * const floor = world.createEntity("Floor");
 * floor.addComponent(BoxCollider2D, { size: { x: 20, y: 1 } });
 * ```
 *
 * @public
 */
export class BoxCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/BoxCollider2D";

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = boxSchema();

  declare size: Vec2Like;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(BoxCollider2D.schema));
  }

  /**
   * Appends this collider's Rapier shape.
   *
   * @param scale - The entity's lossy 2D scale.
   * @param out - The list to append to.
   *
   * @internal
   */
  collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void {
    out.push({
      shape: {
        kind: "box",
        halfWidth: (this.size.x * abs(scale.x)) / 2,
        halfHeight: (this.size.y * abs(scale.y)) / 2,
      },
      offset: scaled(this.offset, scale),
      rotation: 0,
      oneWay: this.oneWay,
    });
  }
}

/**
 * A circle collider. Non-uniform scale is not representable as a circle, so the larger scale axis
 * wins — the same rule Unity applies.
 *
 * @public
 */
export class CircleCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/CircleCollider2D";

  /** The serialized field declarations. */
  static schema: Schema = circleSchema();

  declare radius: number;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(CircleCollider2D.schema));
  }

  /**
   * Appends this collider's Rapier shape.
   *
   * @param scale - The entity's lossy 2D scale.
   * @param out - The list to append to.
   *
   * @internal
   */
  collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void {
    out.push({
      shape: { kind: "circle", radius: this.radius * Math.max(abs(scale.x), abs(scale.y)) },
      offset: scaled(this.offset, scale),
      rotation: 0,
      oneWay: this.oneWay,
    });
  }
}

/**
 * A capsule collider: a rectangle with semicircular caps, standing along X or Y.
 *
 * @remarks
 * `height` is the **total** tip-to-tip height, so a capsule shorter than `2 * radius` degenerates to
 * a circle of that radius rather than inverting. Rapier's capsule always stands along Y, so an
 * `x` capsule is expressed by swapping the axes of the half-extents — which means an `x` capsule
 * and a rotated `y` capsule are the same shape.
 *
 * @public
 */
export class CapsuleCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/CapsuleCollider2D";

  /** The serialized field declarations. */
  static schema: Schema = capsuleSchema();

  declare radius: number;

  declare height: number;

  declare direction: Capsule2DDirection;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(CapsuleCollider2D.schema));
  }

  /**
   * Appends this collider's Rapier shape.
   *
   * @param scale - The entity's lossy 2D scale.
   * @param out - The list to append to.
   *
   * @internal
   */
  collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void {
    const alongY = this.direction === "y";
    const radialScale = alongY ? abs(scale.x) : abs(scale.y);
    const axisScale = alongY ? abs(scale.y) : abs(scale.x);
    const radius = this.radius * radialScale;
    const half = Math.max(0, (this.height * axisScale) / 2 - radius);
    out.push({
      shape: { kind: "capsule", halfHeight: half, radius },
      offset: scaled(this.offset, scale),
      // Rapier's 2D capsule always stands along Y (`geometry/shape.d.ts`, `Capsule`), so a
      // horizontal one is the same shape turned a quarter turn on the collider itself.
      rotation: alongY ? 0 : QUARTER_TURN,
      oneWay: this.oneWay,
    });
  }
}

/**
 * A convex polygon collider, wound in either direction, in local metres.
 *
 * @remarks
 * Rapier builds the **convex hull** of the points, so a concave outline is silently rounded out.
 * Model a concave shape as several `PolygonCollider2D`s on one entity, or as an
 * {@link EdgeCollider2D} when it is an open contour.
 *
 * @public
 */
export class PolygonCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/PolygonCollider2D";

  /** The serialized field declarations. */
  static schema: Schema = pointsSchema();

  declare points: Vec2Like[];

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(PolygonCollider2D.schema));
  }

  /**
   * Appends this collider's Rapier shape.
   *
   * @param scale - The entity's lossy 2D scale.
   * @param out - The list to append to.
   * @throws IgnifxError with code `IGX-1156` when fewer than three points are given.
   *
   * @internal
   */
  collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void {
    if (this.points.length < 3) {
      throw degenerate(this.entity.name, "PolygonCollider2D", "at least three points");
    }
    out.push({
      shape: { kind: "polygon", points: packPoints(this.points, scale) },
      offset: scaled(this.offset, scale),
      rotation: 0,
      oneWay: this.oneWay,
    });
  }
}

/**
 * An open chain of line segments — a platformer's ground contour.
 *
 * @public
 */
export class EdgeCollider2D extends Collider2D {
  /** The namespaced registration id. */
  static typeId = "ignifx/EdgeCollider2D";

  /** The serialized field declarations. */
  static schema: Schema = pointsSchema();

  declare points: Vec2Like[];

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(EdgeCollider2D.schema));
  }

  /**
   * Appends this collider's Rapier shape.
   *
   * @param scale - The entity's lossy 2D scale.
   * @param out - The list to append to.
   * @throws IgnifxError with code `IGX-1156` when fewer than two points are given.
   *
   * @internal
   */
  collectShapes(scale: Vec2Like, out: CollectedShape2D[]): void {
    if (this.points.length < 2) {
      throw degenerate(this.entity.name, "EdgeCollider2D", "at least two points");
    }
    out.push({
      shape: { kind: "polyline", points: packPoints(this.points, scale) },
      offset: scaled(this.offset, scale),
      rotation: 0,
      oneWay: this.oneWay,
    });
  }
}

/**
 * Builds the `BoxCollider2D` schema.
 *
 * @returns The schema.
 */
function boxSchema(): Schema {
  return defineSchema({ ...collider2DFields(), size: vec2({ x: 1, y: 1 }) });
}

/**
 * Builds the `CircleCollider2D` schema.
 *
 * @returns The schema.
 */
function circleSchema(): Schema {
  return defineSchema({ ...collider2DFields(), radius: f32(0.5, { min: 0 }) });
}

/**
 * Builds the `CapsuleCollider2D` schema.
 *
 * @returns The schema.
 */
function capsuleSchema(): Schema {
  return defineSchema({
    ...collider2DFields(),
    radius: f32(0.25, { min: 0 }),
    height: f32(1, { min: 0 }),
    direction: enumOf(CAPSULE_2D_DIRECTIONS, "y"),
  });
}

/**
 * Builds the schema the two point-list colliders share.
 *
 * @returns The schema.
 */
function pointsSchema(): Schema {
  return defineSchema({ ...collider2DFields(), points: array(vec2()) });
}

/**
 * The absolute value of a scale component; a negative scale mirrors geometry, so the shape uses the
 * magnitude.
 *
 * @param value - The scale component.
 * @returns Its magnitude.
 */
function abs(value: number): number {
  return Math.abs(value);
}

/**
 * Scales a local offset into shape space.
 *
 * @param offset - The authored offset.
 * @param scale - The lossy 2D scale.
 * @returns A fresh vector; shape construction is not a per-frame path.
 */
function scaled(offset: Vec2Like, scale: Vec2Like): Vec2Like {
  return { x: offset.x * scale.x, y: offset.y * scale.y };
}

/**
 * Packs a point list into the interleaved `Float32Array` Rapier's shape constructors take.
 *
 * @param points - The authored points.
 * @param scale - The lossy 2D scale.
 * @returns A fresh buffer.
 */
function packPoints(points: readonly Vec2Like[], scale: Vec2Like): Float32Array {
  const packed = new Float32Array(points.length * 2);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) {
      continue;
    }
    packed[index * 2] = point.x * scale.x;
    packed[index * 2 + 1] = point.y * scale.y;
  }
  return packed;
}

/**
 * Builds the "that geometry is degenerate" failure.
 *
 * @param entity - The entity name.
 * @param component - Which collider complained.
 * @param requirement - What it needed.
 * @returns The error to throw.
 */
function degenerate(entity: string, component: string, requirement: string): ReturnType<typeof physics2DError> {
  return physics2DError(Physics2DErrorCode.colliderGeometryInvalid, `${component} on ${entity} needs ${requirement}.`, {
    context: { entity, component },
    hint: `Give the collider ${requirement}.`,
  });
}
