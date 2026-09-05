import {
  createDefaults,
  defineSchema,
  MeshAsset,
  Quat,
  Vec3,
  array,
  bool,
  asset,
  enumOf,
  f32,
  u32,
  vec3,
} from "@ignifx/core";
import { PhysicsErrorCode, physicsError } from "../errors.js";
import { createHeightfieldShape, createMeshShape, createShape, ShapeGeometry } from "../lite/havok.js";
import { Collider, colliderFields } from "./collider.js";
import type { LitePhysicsShape, LitePhysicsWorld } from "../lite/havok.js";
import type { AssetHandle, LiteSceneNode, MutableVec3, Schema, Vec3Like } from "@ignifx/core";

/**
 * The concrete colliders (`docs/architecture/09-physics.md` §2.2). Each one maps to exactly one
 * Havok shape type (`index.d.ts` 8606) and bakes its `center` into the shape's own parameters, so a
 * single collider needs no compound wrapper.
 *
 * Sizes are authored in local units and multiplied by the entity's lossy scale when the shape is
 * built; Havok cannot rescale a built shape, so a later scale change needs `collider.rebuild()`.
 */

/**
 * The axis a capsule stands along.
 *
 * @public
 */
export const CAPSULE_DIRECTIONS = ["x", "y", "z"] as const;

/**
 * The union of {@link CAPSULE_DIRECTIONS}.
 *
 * @public
 */
export type CapsuleDirection = (typeof CAPSULE_DIRECTIONS)[number];

/**
 * A box collider, sized in local units (`09-physics.md` §2.2).
 *
 * @example
 * ```ts
 * const floor = world.createEntity("Floor");
 * floor.addComponent(BoxCollider, { size: { x: 20, y: 1, z: 20 } });
 * ```
 *
 * @public
 */
export class BoxCollider extends Collider {
  /** The namespaced registration id. */
  static typeId = "ignifx/BoxCollider";

  /** The serialized field declarations (ADR-0004). */
  static schema: Schema = boxSchema();

  declare size: Vec3Like;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(BoxCollider.schema));
  }

  /**
   * Builds this collider's Havok shape.
   *
   * @param world - The Havok world the shape belongs to.
   * @param scale - The entity's lossy scale, applied to the authored dimensions.
   * @returns The shape handle.
   */
  createShape(world: LitePhysicsWorld, scale: Vec3Like): LitePhysicsShape {
    return createShape(world, ShapeGeometry.box, {
      extents: { x: this.size.x * abs(scale.x), y: this.size.y * abs(scale.y), z: this.size.z * abs(scale.z) },
      center: scaled(this.center, scale),
      rotation: new Quat(),
    });
  }

  /**
   * Writes half the size of this collider's local bounding box, scale applied.
   *
   * @param scale - The entity's lossy scale.
   * @param out - The vector to write.
   */
  halfExtentsToRef(scale: Vec3Like, out: MutableVec3): void {
    out.set((this.size.x * abs(scale.x)) / 2, (this.size.y * abs(scale.y)) / 2, (this.size.z * abs(scale.z)) / 2);
  }
}

/**
 * A sphere collider. Non-uniform scale is not representable as a sphere, so the largest scale axis
 * wins — the same rule Unity applies.
 *
 * @public
 */
export class SphereCollider extends Collider {
  /** The namespaced registration id. */
  static typeId = "ignifx/SphereCollider";

  /** The serialized field declarations. */
  static schema: Schema = sphereSchema();

  declare radius: number;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(SphereCollider.schema));
  }

  /**
   * Builds this collider's Havok shape.
   *
   * @param world - The Havok world the shape belongs to.
   * @param scale - The entity's lossy scale, applied to the authored dimensions.
   * @returns The shape handle.
   */
  createShape(world: LitePhysicsWorld, scale: Vec3Like): LitePhysicsShape {
    return createShape(world, ShapeGeometry.sphere, {
      radius: this.radius * maxAxis(scale),
      center: scaled(this.center, scale),
    });
  }

  /**
   * Writes half the size of this collider's local bounding box, scale applied.
   *
   * @param scale - The entity's lossy scale.
   * @param out - The vector to write.
   */
  halfExtentsToRef(scale: Vec3Like, out: MutableVec3): void {
    const radius = this.radius * maxAxis(scale);
    out.set(radius, radius, radius);
  }
}

/**
 * A capsule collider: a cylinder with hemispherical caps, standing along one axis.
 *
 * @remarks
 * `height` is the **total** tip-to-tip height, so a capsule shorter than `2 * radius` degenerates to
 * a sphere of that radius rather than inverting.
 *
 * @public
 */
export class CapsuleCollider extends Collider {
  /** The namespaced registration id. */
  static typeId = "ignifx/CapsuleCollider";

  /** The serialized field declarations. */
  static schema: Schema = capsuleSchema();

  declare radius: number;

  declare height: number;

  declare direction: CapsuleDirection;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(CapsuleCollider.schema));
  }

  /**
   * Builds this collider's Havok shape.
   *
   * @param world - The Havok world the shape belongs to.
   * @param scale - The entity's lossy scale, applied to the authored dimensions.
   * @returns The shape handle.
   */
  createShape(world: LitePhysicsWorld, scale: Vec3Like): LitePhysicsShape {
    const radius = this.radius * radialScale(this.direction, scale);
    const half = Math.max(0, (this.height * axisScale(this.direction, scale)) / 2 - radius);
    const center = scaled(this.center, scale);
    return createShape(world, ShapeGeometry.capsule, {
      radius,
      pointA: offsetAlong(center, this.direction, -half),
      pointB: offsetAlong(center, this.direction, half),
    });
  }

  /**
   * Writes half the size of this collider's local bounding box, scale applied.
   *
   * @param scale - The entity's lossy scale.
   * @param out - The vector to write.
   */
  halfExtentsToRef(scale: Vec3Like, out: MutableVec3): void {
    const radius = this.radius * radialScale(this.direction, scale);
    const half = Math.max(radius, (this.height * axisScale(this.direction, scale)) / 2);
    out.set(
      this.direction === "x" ? half : radius,
      this.direction === "y" ? half : radius,
      this.direction === "z" ? half : radius,
    );
  }
}

/**
 * A cylinder collider standing along Y.
 *
 * @public
 */
export class CylinderCollider extends Collider {
  /** The namespaced registration id. */
  static typeId = "ignifx/CylinderCollider";

  /** The serialized field declarations. */
  static schema: Schema = cylinderSchema();

  declare radius: number;

  declare height: number;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(CylinderCollider.schema));
  }

  /**
   * Builds this collider's Havok shape.
   *
   * @param world - The Havok world the shape belongs to.
   * @param scale - The entity's lossy scale, applied to the authored dimensions.
   * @returns The shape handle.
   */
  createShape(world: LitePhysicsWorld, scale: Vec3Like): LitePhysicsShape {
    const radius = this.radius * Math.max(abs(scale.x), abs(scale.z));
    const half = (this.height * abs(scale.y)) / 2;
    const center = scaled(this.center, scale);
    return createShape(world, ShapeGeometry.cylinder, {
      radius,
      pointA: { x: center.x, y: center.y - half, z: center.z },
      pointB: { x: center.x, y: center.y + half, z: center.z },
    });
  }

  /**
   * Writes half the size of this collider's local bounding box, scale applied.
   *
   * @param scale - The entity's lossy scale.
   * @param out - The vector to write.
   */
  halfExtentsToRef(scale: Vec3Like, out: MutableVec3): void {
    const radius = this.radius * Math.max(abs(scale.x), abs(scale.z));
    out.set(radius, (this.height * abs(scale.y)) / 2, radius);
  }
}

/**
 * A collider built from real geometry: either an explicit `MeshAsset` or, when `mesh` is
 * `null`, whatever the entity's `MeshRenderer`/`Model` put under its node.
 *
 * @remarks
 * **Headless is not supported.** `@babylonjs/lite@1.27.0` documents mesh and convex-hull colliders
 * as unavailable on the null engine (`index.d.ts` 2781), and a headless `MeshAsset` uploads no
 * geometry at all (`MeshAsset.lite.mesh` is `null`), so building one reports `IGX-0906` instead of
 * producing an empty shape. Use a primitive collider in headless tests.
 *
 * @public
 */
export class MeshCollider extends Collider {
  /** The namespaced registration id. */
  static typeId = "ignifx/MeshCollider";

  /** The serialized field declarations. */
  static schema: Schema = meshSchema();

  declare mesh: AssetHandle<MeshAsset> | null;

  declare convex: boolean;

  declare includeChildren: boolean;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(MeshCollider.schema));
  }

  /**
   * Builds this collider's Havok shape from real geometry.
   *
   * @param world - The Havok world the shape belongs to.
   * @param _scale - Unused: a mesh shape carries the geometry's own world scale.
   * @param node - The entity's node, whose meshes supply the vertices when `mesh` is `null`.
   * @returns The shape handle.
   */
  createShape(world: LitePhysicsWorld, _scale: Vec3Like, node: LiteSceneNode): LitePhysicsShape {
    const source = this.#sourceNode(node);
    return createMeshShape(world, source, this.convex, this.includeChildren);
  }

  /**
   * Writes half the size of this collider's local bounding box — zero, because measuring a triangle
   * soup means reading its vertices, which is GPU territory.
   *
   * @param _scale - Unused.
   * @param out - The vector to write.
   */
  halfExtentsToRef(_scale: Vec3Like, out: MutableVec3): void {
    // The bounds index cannot measure a triangle soup without reading its vertices, which is GPU
    // territory. A mesh collider therefore contributes a point to `overlap`/`shapeCast` resolution
    // and is documented as such.
    out.set(0, 0, 0);
  }

  /**
   * The node whose meshes supply the geometry.
   *
   * @param entityNode - The entity's own node.
   * @returns The node to hand Lite.
   * @throws IgnifxError with code `IGX-0906` when there is no geometry to read.
   */
  #sourceNode(entityNode: LiteSceneNode): LiteSceneNode {
    const explicit = this.mesh?.value.lite.mesh ?? null;
    if (explicit !== null) {
      return explicit;
    }
    if (this.mesh !== null) {
      throw physicsError(
        PhysicsErrorCode.colliderGeometryUnavailable,
        "The MeshCollider's mesh asset has no geometry.",
        {
          context: { entity: this.entity.name },
          hint: "Mesh colliders need a GPU app; a headless MeshAsset uploads nothing to build a shape from.",
        },
      );
    }
    if (entityNode.children.length === 0) {
      throw physicsError(PhysicsErrorCode.colliderGeometryUnavailable, "The MeshCollider has no mesh to read.", {
        context: { entity: this.entity.name },
        hint: "Add a MeshRenderer or Model to the entity, or set the collider's mesh field.",
      });
    }
    return entityNode;
  }
}

/**
 * A heightfield collider: a regular grid of height samples in the XZ plane, which is what a terrain
 * uses (`index.d.ts` 2601, 6266).
 *
 * @remarks
 * Only Lite's **explicit** heightfield path is used, because the `groundMesh` path reads
 * `mesh._cpuPositions` and `worldMatrix` and therefore needs a GPU. `heights` is row-major with
 * `samplesX * samplesZ` entries.
 *
 * @public
 */
export class HeightfieldCollider extends Collider {
  /** The namespaced registration id. */
  static typeId = "ignifx/HeightfieldCollider";

  /** The serialized field declarations. */
  static schema: Schema = heightfieldSchema();

  declare heights: number[];

  declare samplesX: number;

  declare samplesZ: number;

  declare size: Vec3Like;

  /** Applies this collider's defaults on top of the shared ones. */
  constructor() {
    super();
    Object.assign(this, createDefaults(HeightfieldCollider.schema));
  }

  /**
   * Builds this collider's Havok shape.
   *
   * @param world - The Havok world the shape belongs to.
   * @param scale - The entity's lossy scale, applied to the authored dimensions.
   * @returns The shape handle.
   */
  createShape(world: LitePhysicsWorld, scale: Vec3Like): LitePhysicsShape {
    const expected = this.samplesX * this.samplesZ;
    if (this.samplesX < 2 || this.samplesZ < 2 || this.heights.length !== expected) {
      throw physicsError(
        PhysicsErrorCode.colliderGeometryUnavailable,
        "The HeightfieldCollider's sample grid is invalid.",
        {
          context: { entity: this.entity.name, expected, actual: this.heights.length },
          hint: "heights must hold samplesX * samplesZ values, and both counts must be at least 2.",
        },
      );
    }
    const data = new Float32Array(expected);
    for (let index = 0; index < expected; index += 1) {
      data[index] = (this.heights[index] ?? 0) * abs(scale.y);
    }
    return createHeightfieldShape(
      world,
      this.samplesX,
      this.samplesZ,
      this.size.x * abs(scale.x),
      this.size.z * abs(scale.z),
      data,
    );
  }

  /**
   * Writes half the size of this collider's local bounding box, scale applied.
   *
   * @param scale - The entity's lossy scale.
   * @param out - The vector to write.
   */
  halfExtentsToRef(scale: Vec3Like, out: MutableVec3): void {
    out.set((this.size.x * abs(scale.x)) / 2, (this.size.y * abs(scale.y)) / 2, (this.size.z * abs(scale.z)) / 2);
  }
}

/**
 * Builds the `BoxCollider` schema.
 *
 * @returns The schema.
 */
function boxSchema(): Schema {
  return defineSchema({ ...colliderFields(), size: vec3({ x: 1, y: 1, z: 1 }) });
}

/**
 * Builds the `SphereCollider` schema.
 *
 * @returns The schema.
 */
function sphereSchema(): Schema {
  return defineSchema({ ...colliderFields(), radius: f32(0.5, { min: 0 }) });
}

/**
 * Builds the `CapsuleCollider` schema.
 *
 * @returns The schema.
 */
function capsuleSchema(): Schema {
  return defineSchema({
    ...colliderFields(),
    radius: f32(0.5, { min: 0 }),
    height: f32(2, { min: 0 }),
    direction: enumOf(CAPSULE_DIRECTIONS, "y"),
  });
}

/**
 * Builds the `CylinderCollider` schema.
 *
 * @returns The schema.
 */
function cylinderSchema(): Schema {
  return defineSchema({ ...colliderFields(), radius: f32(0.5, { min: 0 }), height: f32(2, { min: 0 }) });
}

/**
 * Builds the `MeshCollider` schema.
 *
 * @returns The schema.
 */
function meshSchema(): Schema {
  return defineSchema({
    ...colliderFields(),
    mesh: asset(MeshAsset),
    convex: bool(false),
    includeChildren: bool(true),
  });
}

/**
 * Builds the `HeightfieldCollider` schema.
 *
 * @returns The schema.
 */
function heightfieldSchema(): Schema {
  return defineSchema({
    ...colliderFields(),
    heights: array(f32()),
    samplesX: u32(2, { min: 2 }),
    samplesZ: u32(2, { min: 2 }),
    size: vec3({ x: 1, y: 1, z: 1 }),
  });
}

/**
 * The absolute value of a scale component; a negative scale mirrors geometry, which Havok cannot
 * represent, so the shape uses the magnitude (`09-physics.md` §2.2).
 *
 * @param value - The scale component.
 * @returns Its magnitude.
 */
function abs(value: number): number {
  return Math.abs(value);
}

/**
 * The largest scale magnitude, used by shapes that have one radius.
 *
 * @param scale - The lossy scale.
 * @returns The largest magnitude.
 */
function maxAxis(scale: Vec3Like): number {
  return Math.max(abs(scale.x), abs(scale.y), abs(scale.z));
}

/**
 * Scales a local offset into shape space.
 *
 * @param center - The authored offset.
 * @param scale - The lossy scale.
 * @returns A fresh vector; shape construction is not a per-frame path.
 */
function scaled(center: Vec3Like, scale: Vec3Like): Vec3 {
  return new Vec3(center.x * scale.x, center.y * scale.y, center.z * scale.z);
}

/**
 * The scale along a capsule's own axis.
 *
 * @param direction - The capsule axis.
 * @param scale - The lossy scale.
 * @returns The magnitude along that axis.
 */
function axisScale(direction: CapsuleDirection, scale: Vec3Like): number {
  if (direction === "x") {
    return abs(scale.x);
  }
  return direction === "y" ? abs(scale.y) : abs(scale.z);
}

/**
 * The scale across a capsule's axis, which drives its radius.
 *
 * @param direction - The capsule axis.
 * @param scale - The lossy scale.
 * @returns The larger of the two perpendicular magnitudes.
 */
function radialScale(direction: CapsuleDirection, scale: Vec3Like): number {
  if (direction === "x") {
    return Math.max(abs(scale.y), abs(scale.z));
  }
  return direction === "y" ? Math.max(abs(scale.x), abs(scale.z)) : Math.max(abs(scale.x), abs(scale.y));
}

/**
 * Offsets a point along one axis.
 *
 * @param center - The starting point.
 * @param direction - Which axis to move along.
 * @param distance - How far to move.
 * @returns A fresh vector.
 */
function offsetAlong(center: Vec3Like, direction: CapsuleDirection, distance: number): Vec3 {
  return new Vec3(
    center.x + (direction === "x" ? distance : 0),
    center.y + (direction === "y" ? distance : 0),
    center.z + (direction === "z" ? distance : 0),
  );
}
