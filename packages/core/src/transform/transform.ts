import { Component } from "../component/component.js";
import { localPosition, localRotation, localScale, parentNode, readWorldMatrix } from "../lite/node.js";
import { Mat4 } from "../math/mat4.js";
import { Quat } from "../math/quat.js";
import { Vec2 } from "../math/vec2.js";
import { Vec3 } from "../math/vec3.js";
import { TRANSFORM_NODE, transformIsNotRemovable, transformNode } from "./transform-internals.js";
import type { LiteSceneNode } from "../lite/node.js";
import type { Mat4Like, MutableQuat, MutableVec3, QuatLike, Vec3Like } from "../math/types.js";

/**
 * The view over an entity's Babylon Lite `SceneNode`
 * (`docs/architecture/02-scene-graph.md` §5). Every entity has exactly one; it cannot be removed
 * and cannot be disabled (`IGX-0205`).
 *
 * @remarks
 * There is no second copy of position, rotation, or scale anywhere in ignifx: physics, animation,
 * and scripts all read and write the same Lite node. `localPosition`, `localRotation`, and
 * `localScale` are the node's own live values, so `transform.localPosition.x += 1` writes straight
 * through with no copy and no dirty flag of ignifx's own.
 *
 * World-space getters (`position`, `rotation`, `eulerAngles`, `lossyScale`, `forward`, `right`,
 * `up`) allocate a fresh value; every one of them has a `ToRef` twin that writes into a caller-owned
 * object and allocates nothing, and hot code uses those (coding standards §7).
 *
 * @example
 * ```ts
 * class Follow extends Script implements ScriptCallbacks {
 *   #target = new Vec3();
 *   lateUpdate(dt: number): void {
 *     this.player.transform.positionToRef(this.#target);   // no allocation
 *     this.transform.localPosition.copyFrom(this.#target); // straight into the Lite node
 *   }
 * }
 * ```
 *
 * @public
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- the merged interface below declares one engine-owned property that the constructor always assigns.
export class Transform extends Component {
  /** The registration id of the one component every entity carries. */
  static typeId = "ignifx/Transform";

  /** An entity has exactly one transform. */
  static allowMultiple = false;

  /** Creates an unbound transform. The entity constructor binds it to a Lite node immediately. */
  constructor() {
    super();
    this[TRANSFORM_NODE] = null;
  }

  /** The world matrix, copied out of Lite lazily; created on first read. */
  #worldMatrix: Mat4 | null = null;

  /** The `worldMatrixVersion` the cached world matrix was copied at. */
  #worldMatrixVersion = -1;

  /** The local matrix, composed lazily; created on first read. */
  #localMatrix: Mat4 | null = null;

  /** The `worldMatrixVersion` the cached local matrix was composed at. */
  #localMatrixVersion = -1;

  /**
   * A transform is always enabled: it is the entity's only view of its own position, and the
   * engine, physics, and animation all write through it.
   *
   * @returns Always `true`.
   * @throws IgnifxError with code `IGX-0205` on any attempt to set it to `false`. Deactivate the
   * entity instead (`docs/architecture/01-lifecycle-and-time.md` §6).
   */
  override get enabled(): boolean {
    return super.enabled;
  }

  override set enabled(value: boolean) {
    if (!value) {
      throw transformIsNotRemovable();
    }
    super.enabled = value;
  }

  /**
   * A transform cannot be destroyed on its own.
   *
   * @throws IgnifxError with code `IGX-0205`. Destroy the entity instead.
   */
  override destroy(): void {
    throw transformIsNotRemovable();
  }

  /**
   * The Babylon Lite node this transform is a view over. Unstable escape hatch
   * (`docs/architecture/00-overview.md` §3); excluded from the stability guarantees of
   * `CONSTITUTION.md` Article IV.
   *
   * @returns The node.
   */
  get lite(): LiteSceneNode {
    return transformNode(this);
  }

  /**
   * The position relative to the parent, as a **live** view over the Lite node: writing to it moves
   * the entity and invalidates the subtree's world matrices.
   *
   * @returns The live local position. Never hold it past the entity's lifetime.
   */
  get localPosition(): MutableVec3 {
    return localPosition(transformNode(this));
  }

  /**
   * The rotation relative to the parent, as a live view over the Lite node.
   *
   * @returns The live local rotation.
   */
  get localRotation(): MutableQuat {
    return localRotation(transformNode(this));
  }

  /**
   * The scale relative to the parent, as a live view over the Lite node. Non-uniform scale is
   * supported; negative scale is allowed but shadows and physics shapes do not support it.
   *
   * @returns The live local scale.
   */
  get localScale(): MutableVec3 {
    return localScale(transformNode(this));
  }

  /**
   * The local rotation as intrinsic XYZ Euler angles in **degrees** (ADR-0011).
   *
   * @returns A freshly allocated vector. Use `Transform.localEulerAnglesToRef` in hot code.
   */
  get localEulerAngles(): Vec3 {
    return this.localEulerAnglesToRef(new Vec3());
  }

  set localEulerAngles(value: Vec3Like) {
    Quat.fromEulerDegreesToRef(value.x, value.y, value.z, localRotation(transformNode(this)));
  }

  /**
   * The world position.
   *
   * @returns A freshly allocated vector. Use `Transform.positionToRef` in hot code.
   */
  get position(): Vec3 {
    return this.positionToRef(new Vec3());
  }

  set position(value: Vec3Like) {
    const node = transformNode(this);
    const parent = parentNode(node);
    if (parent === null) {
      localPosition(node).set(value.x, value.y, value.z);
      return;
    }
    const scratch = getScratch();
    readWorldMatrix(parent, scratch.matrixA.elements);
    if (!Mat4.invertToRef(scratch.matrixA.elements, scratch.matrixB)) {
      // A singular parent matrix cannot be inverted, so no local value reproduces the world one.
      // Lite's own `setParent` takes the same escape hatch: keep the value as a local one.
      localPosition(node).set(value.x, value.y, value.z);
      return;
    }
    Mat4.transformPointToRef(scratch.matrixB.elements, value, localPosition(node));
  }

  /**
   * The world rotation.
   *
   * @returns A freshly allocated quaternion. Use `Transform.rotationToRef` in hot code.
   */
  get rotation(): Quat {
    return this.rotationToRef(new Quat());
  }

  set rotation(value: QuatLike) {
    const node = transformNode(this);
    const parent = parentNode(node);
    if (parent === null) {
      localRotation(node).set(value.x, value.y, value.z, value.w);
      return;
    }
    const scratch = getScratch();
    readWorldMatrix(parent, scratch.matrixA.elements);
    Mat4.getRotationToRef(scratch.matrixA.elements, scratch.setRotA);
    Quat.invertToRef(scratch.setRotA, scratch.setRotB);
    Quat.multiplyToRef(scratch.setRotB, value, localRotation(node));
  }

  /**
   * The world rotation as intrinsic XYZ Euler angles in degrees.
   *
   * @returns A freshly allocated vector. Use `Transform.eulerAnglesToRef` in hot code.
   */
  get eulerAngles(): Vec3 {
    return this.eulerAnglesToRef(new Vec3());
  }

  set eulerAngles(value: Vec3Like) {
    const scratch = getScratch();
    Quat.fromEulerDegreesToRef(value.x, value.y, value.z, scratch.quatC);
    this.rotation = scratch.quatC;
  }

  /**
   * The world scale, read as the lengths of the world matrix's basis columns. It is *lossy*: a
   * rotated parent with non-uniform scale has no exact per-axis world scale, so this is the closest
   * approximation, exactly as Unity's `lossyScale` is.
   *
   * @returns A freshly allocated vector. Use `Transform.lossyScaleToRef` in hot code.
   */
  get lossyScale(): Vec3 {
    return this.lossyScaleToRef(new Vec3());
  }

  /**
   * The world unit vector pointing along the entity's local +Z (ADR-0011: left-handed, Y up, +Z
   * forward).
   *
   * @returns A freshly allocated vector. Use `Transform.forwardToRef` in hot code.
   */
  get forward(): Vec3 {
    return this.forwardToRef(new Vec3());
  }

  /**
   * The world unit vector pointing along the entity's local +X.
   *
   * @returns A freshly allocated vector. Use `Transform.rightToRef` in hot code.
   */
  get right(): Vec3 {
    return this.rightToRef(new Vec3());
  }

  /**
   * The world unit vector pointing along the entity's local +Y.
   *
   * @returns A freshly allocated vector. Use `Transform.upToRef` in hot code.
   */
  get up(): Vec3 {
    return this.upToRef(new Vec3());
  }

  /**
   * The world matrix, copied out of Lite's cache the first time it is read after a change.
   *
   * @remarks
   * Lite documents its `Mat4` as opaque and recomputes it lazily up the parent chain, so the
   * adapter copies it element by element rather than handing out Lite's own object (ADR-0003
   * Validation). The returned view is this transform's own storage: it is read-only, its identity
   * is stable, and its contents change the next time the matrix is read after the entity moves.
   *
   * @returns The 16 column-major elements, translation in slots 12/13/14.
   */
  get worldMatrix(): Mat4Like {
    const node = transformNode(this);
    const version = node.worldMatrixVersion;
    let matrix = this.#worldMatrix;
    if (matrix === null) {
      matrix = new Mat4();
      this.#worldMatrix = matrix;
    }
    if (this.#worldMatrixVersion !== version) {
      readWorldMatrix(node, matrix.elements);
      this.#worldMatrixVersion = version;
    }
    return matrix.elements;
  }

  /**
   * The matrix that takes local space to the parent's space, composed from the local TRS as
   * `T * R * S`.
   *
   * @returns The 16 column-major elements. The same storage and staleness rules as
   * `Transform.worldMatrix`.
   */
  get localMatrix(): Mat4Like {
    const node = transformNode(this);
    const version = node.worldMatrixVersion;
    let matrix = this.#localMatrix;
    if (matrix === null) {
      matrix = new Mat4();
      this.#localMatrix = matrix;
    }
    if (this.#localMatrixVersion !== version) {
      Mat4.composeToRef(localPosition(node), localRotation(node), localScale(node), matrix);
      this.#localMatrixVersion = version;
    }
    return matrix.elements;
  }

  /**
   * A counter that increases whenever this transform's world matrix is invalidated, by its own TRS
   * or by any ancestor's. Snapshot it to detect movement without comparing matrices — how
   * extensions feed spatial acceleration structures (`docs/architecture/02-scene-graph.md` §9).
   *
   * @returns The current version.
   */
  get worldMatrixVersion(): number {
    return transformNode(this).worldMatrixVersion;
  }

  /**
   * The world position, in metres, in the plane 2D games use.
   *
   * @returns A freshly allocated 2D vector.
   */
  get position2D(): Vec2 {
    const scratch = getScratch();
    this.positionToRef(scratch.vecA);
    return new Vec2(scratch.vecA.x, scratch.vecA.y);
  }

  set position2D(value: Vec2) {
    const scratch = getScratch();
    this.positionToRef(scratch.vecA);
    scratch.vecA.set(value.x, value.y, scratch.vecA.z);
    this.position = scratch.vecA;
  }

  /**
   * The local position in the 2D plane; the Z depth is left alone by the setter, because 2D uses it
   * only as a sorting fallback (`docs/architecture/00-overview.md` §4).
   *
   * @returns A freshly allocated 2D vector.
   */
  get localPosition2D(): Vec2 {
    const local = localPosition(transformNode(this));
    return new Vec2(local.x, local.y);
  }

  set localPosition2D(value: Vec2) {
    const local = localPosition(transformNode(this));
    local.set(value.x, value.y, local.z);
  }

  /**
   * The local rotation about +Z in degrees, counter-clockwise — the only rotation 2D uses
   * (ADR-0011).
   *
   * @returns The angle in degrees.
   */
  get rotation2D(): number {
    const scratch = getScratch();
    Quat.toEulerDegreesToRef(localRotation(transformNode(this)), scratch.vecA);
    return scratch.vecA.z;
  }

  set rotation2D(degrees: number) {
    Quat.fromEulerDegreesToRef(0, 0, degrees, localRotation(transformNode(this)));
  }

  /**
   * The local scale in the 2D plane.
   *
   * @returns A freshly allocated 2D vector.
   */
  get localScale2D(): Vec2 {
    const scale = localScale(transformNode(this));
    return new Vec2(scale.x, scale.y);
  }

  set localScale2D(value: Vec2) {
    const scale = localScale(transformNode(this));
    scale.set(value.x, value.y, scale.z);
  }

  /**
   * Writes the world position into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  positionToRef<TOut extends MutableVec3>(out: TOut): TOut {
    return Mat4.getTranslationToRef(this.worldMatrix, out);
  }

  /**
   * Writes the world rotation into a caller-owned quaternion. Allocates nothing.
   *
   * @param out - The quaternion to write.
   * @returns `out`.
   */
  rotationToRef<TOut extends MutableQuat>(out: TOut): TOut {
    return Mat4.getRotationToRef(this.worldMatrix, out);
  }

  /**
   * Writes the world Euler angles in degrees into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  eulerAnglesToRef<TOut extends MutableVec3>(out: TOut): TOut {
    const scratch = getScratch();
    this.rotationToRef(scratch.quatA);
    return Quat.toEulerDegreesToRef(scratch.quatA, out);
  }

  /**
   * Writes the local Euler angles in degrees into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  localEulerAnglesToRef<TOut extends MutableVec3>(out: TOut): TOut {
    return Quat.toEulerDegreesToRef(localRotation(transformNode(this)), out);
  }

  /**
   * Writes the lossy world scale into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`.
   */
  lossyScaleToRef<TOut extends MutableVec3>(out: TOut): TOut {
    return Mat4.getScaleToRef(this.worldMatrix, out);
  }

  /**
   * Writes the world +Z axis into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`, normalised.
   */
  forwardToRef<TOut extends MutableVec3>(out: TOut): TOut {
    return axisToRef(this.worldMatrix, 8, out);
  }

  /**
   * Writes the world +X axis into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`, normalised.
   */
  rightToRef<TOut extends MutableVec3>(out: TOut): TOut {
    return axisToRef(this.worldMatrix, 0, out);
  }

  /**
   * Writes the world +Y axis into a caller-owned vector. Allocates nothing.
   *
   * @param out - The vector to write.
   * @returns `out`, normalised.
   */
  upToRef<TOut extends MutableVec3>(out: TOut): TOut {
    return axisToRef(this.worldMatrix, 4, out);
  }

  /**
   * Moves the entity by a delta. Allocates nothing.
   *
   * @param delta - How far to move, in metres.
   * @param space - `"local"` (the default) rotates the delta by the entity's own rotation first, so
   * `{ z: 1 }` means "one metre forward"; `"world"` adds the delta to the world position.
   *
   * @example
   * ```ts
   * this.transform.translate({ x: 0, y: 0, z: this.speed * dt }); // forward
   * ```
   */
  translate(delta: Vec3Like, space: "local" | "world" = "local"): void {
    const node = transformNode(this);
    if (space === "local") {
      const scratch = getScratch();
      Quat.rotateVectorToRef(localRotation(node), delta, scratch.vecA);
      const local = localPosition(node);
      local.set(local.x + scratch.vecA.x, local.y + scratch.vecA.y, local.z + scratch.vecA.z);
      return;
    }
    const scratch = getScratch();
    this.positionToRef(scratch.vecB);
    scratch.vecB.set(scratch.vecB.x + delta.x, scratch.vecB.y + delta.y, scratch.vecB.z + delta.z);
    this.position = scratch.vecB;
  }

  /**
   * Rotates the entity by intrinsic XYZ Euler angles in degrees. Allocates nothing.
   *
   * @param eulerDegrees - The rotation to apply.
   * @param space - `"local"` (the default) applies the rotation in the entity's own space;
   * `"world"` applies it in world space.
   */
  rotate(eulerDegrees: Vec3Like, space: "local" | "world" = "local"): void {
    const scratch = getScratch();
    Quat.fromEulerDegreesToRef(eulerDegrees.x, eulerDegrees.y, eulerDegrees.z, scratch.quatC);
    const local = localRotation(transformNode(this));
    if (space === "local") {
      Quat.multiplyToRef(local, scratch.quatC, local);
      return;
    }
    this.rotationToRef(scratch.quatA);
    Quat.multiplyToRef(scratch.quatC, scratch.quatA, scratch.quatB);
    this.rotation = scratch.quatB;
  }

  /**
   * Orbits the entity around a world-space point.
   *
   * @param point - The pivot, in world space.
   * @param axis - The axis to rotate about, in world space; need not be normalised.
   * @param degrees - How far to rotate, counter-clockwise about the axis.
   */
  rotateAround(point: Vec3Like, axis: Vec3Like, degrees: number): void {
    const scratch = getScratch();
    Quat.fromAxisAngleToRef(axis, degrees, scratch.quatC);
    this.positionToRef(scratch.vecA);
    scratch.vecA.set(scratch.vecA.x - point.x, scratch.vecA.y - point.y, scratch.vecA.z - point.z);
    Quat.rotateVectorToRef(scratch.quatC, scratch.vecA, scratch.vecB);
    scratch.vecB.set(scratch.vecB.x + point.x, scratch.vecB.y + point.y, scratch.vecB.z + point.z);
    this.rotationToRef(scratch.quatA);
    Quat.multiplyToRef(scratch.quatC, scratch.quatA, scratch.quatB);
    this.setPositionAndRotation(scratch.vecB, scratch.quatB);
  }

  /**
   * Points the entity's +Z axis at a world-space target.
   *
   * @param target - Where to look, in world space.
   * @param up - The world up hint; defaults to +Y.
   */
  lookAt(target: Vec3Like, up: Vec3Like = WORLD_UP): void {
    const scratch = getScratch();
    this.positionToRef(scratch.vecA);
    scratch.vecB.set(target.x - scratch.vecA.x, target.y - scratch.vecA.y, target.z - scratch.vecA.z);
    Quat.lookRotationToRef(scratch.vecB, up, scratch.quatC);
    this.rotation = scratch.quatC;
  }

  /**
   * Sets world position and rotation together, which is cheaper than setting them one at a time
   * because the parent's world matrix is read once.
   *
   * @param position - The world position, in metres.
   * @param rotation - The world rotation.
   */
  setPositionAndRotation(position: Vec3Like, rotation: QuatLike): void {
    const node = transformNode(this);
    const parent = parentNode(node);
    if (parent === null) {
      localPosition(node).set(position.x, position.y, position.z);
      localRotation(node).set(rotation.x, rotation.y, rotation.z, rotation.w);
      return;
    }
    const scratch = getScratch();
    readWorldMatrix(parent, scratch.matrixA.elements);
    Mat4.getRotationToRef(scratch.matrixA.elements, scratch.setRotA);
    Quat.invertToRef(scratch.setRotA, scratch.setRotB);
    Quat.multiplyToRef(scratch.setRotB, rotation, localRotation(node));
    if (Mat4.invertToRef(scratch.matrixA.elements, scratch.matrixB)) {
      Mat4.transformPointToRef(scratch.matrixB.elements, position, localPosition(node));
      return;
    }
    localPosition(node).set(position.x, position.y, position.z);
  }

  /**
   * Takes a point from this entity's local space to world space.
   *
   * @param local - The point, in the entity's local space.
   * @param out - Where to write the result; a fresh `Vec3` is allocated when omitted.
   * @returns The world point.
   */
  transformPoint(local: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 {
    return Mat4.transformPointToRef(this.worldMatrix, local, out);
  }

  /**
   * Takes a direction from this entity's local space to world space; translation is ignored.
   *
   * @param local - The direction, in the entity's local space.
   * @param out - Where to write the result; a fresh `Vec3` is allocated when omitted.
   * @returns The world direction.
   */
  transformDirection(local: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 {
    return Mat4.transformDirectionToRef(this.worldMatrix, local, out);
  }

  /**
   * Takes a point from world space to this entity's local space.
   *
   * @param world - The point, in world space.
   * @param out - Where to write the result; a fresh `Vec3` is allocated when omitted.
   * @returns The local point; unchanged input when the world matrix is singular.
   */
  inverseTransformPoint(world: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 {
    const scratch = getScratch();
    if (!Mat4.invertToRef(this.worldMatrix, scratch.matrixB)) {
      out.set(world.x, world.y, world.z);
      return out;
    }
    return Mat4.transformPointToRef(scratch.matrixB.elements, world, out);
  }

  /**
   * Takes a direction from world space to this entity's local space.
   *
   * @param world - The direction, in world space.
   * @param out - Where to write the result; a fresh `Vec3` is allocated when omitted.
   * @returns The local direction; unchanged input when the world matrix is singular.
   */
  inverseTransformDirection(world: Vec3Like, out: MutableVec3 = new Vec3()): MutableVec3 {
    const scratch = getScratch();
    if (!Mat4.invertToRef(this.worldMatrix, scratch.matrixB)) {
      out.set(world.x, world.y, world.z);
      return out;
    }
    return Mat4.transformDirectionToRef(scratch.matrixB.elements, world, out);
  }
}

/**
 * The Babylon Lite node a transform views, declared through interface merging: a symbol-keyed class
 * field is rejected by `isolatedDeclarations` (coding standards §3).
 *
 * @public
 */
// Merging is deliberate and safe here: the class constructor assigns the one property the
// interface declares. See the note on `Component`.
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the note above
export interface Transform {
  /**
   * The Lite node, bound by the entity constructor.
   *
   * @internal
   */
  [TRANSFORM_NODE]: LiteSceneNode | null;
}

/** The default up hint for `Transform.lookAt`. Frozen, so it is safe at module scope. */
const WORLD_UP: Vec3Like = Object.freeze({ x: 0, y: 1, z: 0 });

/** Scratch values shared by every transform in the process. */
interface TransformScratch {
  /** General-purpose vector slot A. */
  readonly vecA: Vec3;
  /** General-purpose vector slot B. */
  readonly vecB: Vec3;
  /** General-purpose quaternion slot A. */
  readonly quatA: Quat;
  /** General-purpose quaternion slot B. */
  readonly quatB: Quat;
  /** General-purpose quaternion slot C. */
  readonly quatC: Quat;
  /** Slot reserved for the world-rotation setters, so a caller may pass a general slot. */
  readonly setRotA: Quat;
  /** Second slot reserved for the world-rotation setters. */
  readonly setRotB: Quat;
  /** Matrix slot A, normally the parent's world matrix. */
  readonly matrixA: Mat4;
  /** Matrix slot B, normally an inverse. */
  readonly matrixB: Mat4;
}

/**
 * The shared scratch, created on first use rather than at import time (`CONSTITUTION.md` §3.5).
 *
 * Sharing one set across every transform is safe because nothing in this module calls out to user
 * code between taking a slot and finishing with it, and each method uses distinct slots — so no
 * re-entrant call can be in flight. Per-transform scratch would cost seven objects per entity for
 * no benefit.
 */
let sharedScratch: TransformScratch | null = null;

/**
 * The shared scratch values, allocated on first use.
 *
 * @returns The scratch slots.
 */
function getScratch(): TransformScratch {
  sharedScratch ??= {
    vecA: new Vec3(),
    vecB: new Vec3(),
    quatA: new Quat(),
    quatB: new Quat(),
    quatC: new Quat(),
    setRotA: new Quat(),
    setRotB: new Quat(),
    matrixA: new Mat4(),
    matrixB: new Mat4(),
  };
  return sharedScratch;
}

/**
 * Reads a normalised basis column out of a world matrix.
 *
 * @param matrix - The world matrix.
 * @param offset - The first element of the column: `0` for +X, `4` for +Y, `8` for +Z.
 * @param out - The vector to write.
 * @returns `out`, normalised, or the raw column when it has zero length.
 */
function axisToRef<TOut extends MutableVec3>(matrix: Mat4Like, offset: number, out: TOut): TOut {
  const x = matrix[offset] ?? 0;
  const y = matrix[offset + 1] ?? 0;
  const z = matrix[offset + 2] ?? 0;
  const length = Math.hypot(x, y, z);
  if (length === 0) {
    out.set(x, y, z);
    return out;
  }
  const inverse = 1 / length;
  out.set(x * inverse, y * inverse, z * inverse);
  return out;
}
