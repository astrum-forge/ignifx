import {
  createTransformNode,
  mat4Decompose,
  setParent,
  setSubtreeVisible,
  type IWorldMatrixProvider,
  type SceneNode,
} from "@babylonjs/lite";
import type { MutableQuat, MutableVec3 } from "../math/types.js";

/**
 * Scene-graph half of the Babylon Lite adapter: the transform node primitives the kernel's
 * `Transform` component is built from (`docs/architecture/02-scene-graph.md` §5, §5.1). Together
 * with the other files in this directory it is the only place in the package allowed to import
 * `@babylonjs/lite` (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * Everything here is `@internal`: the kernel decides what becomes public API and what stays behind
 * `Transform`. Nothing in this file is re-exported from `src/index.ts`.
 *
 * ## How Lite computes `worldMatrix` (verified against `@babylonjs/lite@1.27.0`
 * `lib/scene/world-matrix-state.js` and `lib/scene/scene-node.js`)
 *
 * Every node owns a *world-matrix state* holding a cached world matrix, a version counter, a
 * parent link, and a list of the states of the children that were linked through that parent
 * property. The rules that follow from the source are:
 *
 * 1. Writing any TRS value calls the node's dirty hook, which clears the cache, increments the
 *    version, and **recursively invalidates every linked descendant** — invalidation is pushed
 *    down eagerly, not polled.
 * 2. `ObservableVec3`/`ObservableQuat` per-component setters only fire that hook when the value
 *    actually changes; the bulk `set(...)`/`copyFrom(...)` methods fire it unconditionally. So
 *    `node.position.x = node.position.x` does not bump the version, while
 *    `node.position.set(sameX, sameY, sameZ)` does.
 * 3. `worldMatrix` is a getter. On a cache miss it composes the local matrix from TRS and, when a
 *    parent is linked, returns `parentWorld × local` (column-major; translation in elements
 *    12/13/14). A node with no parent returns its local matrix directly.
 * 4. A parent that is a plain {@link IWorldMatrixProvider} rather than a Lite scene node (a camera,
 *    for instance) cannot be invalidated eagerly, so the child polls `parent.worldMatrixVersion`
 *    on every `worldMatrix` and `worldMatrixVersion` read instead.
 * 5. Nothing in that path touches the scene: a transform node never needs `addToScene` for its
 *    matrices to be correct. Only renderable objects do (`docs/architecture/02-scene-graph.md`
 *    §5.1).
 */

/**
 * A mutable `{ x, y, z }` accepted as an output parameter. Deliberately the minimal shape: Lite's
 * `Vec3`, the math module's `MutableVec3` (which adds `set`/`copyFrom`), a live `ObservableVec3` over
 * a node's TRS, and a plain object literal all satisfy it, so nothing has to be converted.
 *
 * @internal
 */
export interface MutableVec3Like {
  /** The x component. */
  x: number;
  /** The y component. */
  y: number;
  /** The z component. */
  z: number;
}

/**
 * A mutable `{ x, y, z, w }` accepted as an output parameter. The minimal shape, for the same reason
 * as {@link MutableVec3Like}: Lite's `Quat`, the math module's `MutableQuat`, and a plain object
 * literal all satisfy it.
 *
 * @internal
 */
export interface MutableQuatLike {
  /** The x component of the quaternion's vector part. */
  x: number;
  /** The y component of the quaternion's vector part. */
  y: number;
  /** The z component of the quaternion's vector part. */
  z: number;
  /** The scalar part. */
  w: number;
}

/**
 * A writable 16-element matrix sink in column-major order. `Float32Array` (including the math
 * module's `Mat4.elements`), `Float64Array`, and a plain `number[]` all satisfy it, which is why
 * `length` is a plain `number`: `Float32Array` cannot express the literal `16` that Lite's read-only
 * `Mat4` and the math module's `Mat4Like` declare.
 *
 * @internal
 */
export interface MutableMat4Like {
  /** Element count; callers must supply at least 16 slots. */
  readonly length: number;
  /** Column-major element access. */
  [index: number]: number;
}

/**
 * The ignifx identity written into a Lite node's metadata bag so picking results and physics bodies
 * resolve back to the owning entity (`docs/architecture/00-overview.md` §5,
 * `docs/architecture/02-scene-graph.md` §10).
 *
 * @internal
 */
export interface NodeTag {
  /** The dense runtime handle of the entity that owns the node. */
  readonly entity: number;
  /** The component that created the node, when the node is not the entity's own transform. */
  readonly component?: number;
}

/** The single key ignifx owns inside Lite's open `metadata` record. */
const METADATA_KEY = "ignifx";

/** Number of elements in a 4x4 matrix. */
const MATRIX_LENGTH = 16;

/**
 * Creates a pure transform node at the origin with an identity rotation and unit scale.
 *
 * @remarks
 * The node is deliberately **not** added to any Lite scene: a transform node is only a matrix
 * provider, and `worldMatrix` is valid the moment the node exists (see rule 5 in the module
 * documentation). Renderable Lite objects created by components are parented under it and added
 * with `addToScene` separately.
 *
 * @param name - A human-readable name; Lite never uses it for lookup and it need not be unique.
 * @returns A fresh, unparented transform node.
 *
 * @example
 * ```ts
 * const node = createNode("Player");
 * node.position.set(1, 2, 3);
 * ```
 *
 * @internal
 */
export function createNode(name: string): SceneNode {
  return createTransformNode(name);
}

/**
 * Releases a pure transform node.
 *
 * @remarks
 * Lite requires nothing to release a transform node that was never added to a scene: verified in
 * `lib/scene/transform-node.js` and `lib/scene/scene-node.js`, the node is a plain object holding
 * three observable values, one `Float32Array` for the cached world matrix, and closures — no GPU
 * resource, no ref count, no scene registry. (Reference counting in `lib/resource/ref-count.js`
 * applies to meshes and their GPU buffers only, and `disposeScene` never walks transform nodes.)
 *
 * What *does* need doing is breaking the parent link: a linked parent keeps a reference to this
 * node's world-matrix state so it can invalidate it, so a node dropped while still parented is
 * retained by its parent. This function therefore unlinks the node and drops the ignifx tag. It
 * leaves the node's own `children` alone: the kernel destroys children before parents
 * (`docs/architecture/01-lifecycle-and-time.md` §3 step 9), so each child unlinks itself first.
 *
 * @param node - A node from {@link createNode}.
 *
 * @internal
 */
export function disposeNode(node: SceneNode): void {
  linkParent(node, null);
  const metadata = node.metadata;
  if (metadata !== undefined) {
    delete metadata[METADATA_KEY];
  }
}

/**
 * Links `child` under `parent`, **keeping the child's local values** — its world transform moves
 * with the new parent. This is `setParent(parent, { worldPositionStays: false })` in
 * `docs/architecture/02-scene-graph.md` §5.1.
 *
 * @remarks
 * Lite has no public helper for this case (its own `setParent` preserves the world transform), so
 * the adapter does the linking itself: it assigns `child.parent`, which is the setter that
 * re-registers the child's world-matrix state with the new parent and invalidates the subtree, and
 * maintains the `children` arrays on both the old and the new parent so tree traversal stays
 * consistent. Passing the parent the child already has is a no-op.
 *
 * @param child - The node to move.
 * @param parent - The new parent, or `null` to detach the child to world space.
 *
 * @example
 * ```ts
 * linkParent(child, parent); // child keeps localPosition; its world position changes
 * ```
 *
 * @internal
 */
export function linkParent(child: SceneNode, parent: SceneNode | null): void {
  const previous = child.parent;
  if (previous === parent) {
    return;
  }
  const previousChildren = childrenOf(previous);
  if (previousChildren !== null) {
    const index = previousChildren.indexOf(child);
    if (index >= 0) {
      previousChildren.splice(index, 1);
    }
  }
  // The setter, not a field write: it swaps the world-matrix state's parent, re-registers this
  // node in the new parent's invalidation list, and bumps `worldMatrixVersion` down the subtree.
  child.parent = parent;
  if (parent !== null && !parent.children.includes(child)) {
    parent.children.push(child);
  }
}

/**
 * Reparents `child` under `parent` **keeping its world transform**, by delegating to Lite's own
 * `setParent`. This is `setParent(parent, { worldPositionStays: true })`, the ignifx default
 * (`docs/architecture/02-scene-graph.md` §5.1).
 *
 * @remarks
 * Lite snapshots the child's world matrix, relinks the node (maintaining both `children` arrays),
 * then decomposes `inverse(parentWorld) × childWorld` back into local TRS. Two documented caveats
 * carry straight through to ignifx:
 *
 * - **Singular parent matrices.** When the parent's world matrix has a collapsed axis it cannot be
 *   inverted, so no local transform can reproduce the child's world. Lite then keeps the parent
 *   link and copies the child's world *position* into its local position, leaving rotation and
 *   scale uncompensated. Non-uniform-but-invertible parents are fine; zero scale on any axis is
 *   not.
 * - **Canonical, not sign-faithful, decomposition.** The local TRS comes from `mat4Decompose`,
 *   which folds a reflection into a negative Y scale. The world matrix is reproduced exactly, but a
 *   child that had a negative X scale comes back with a negative Y scale and a different rotation.
 *
 * A third caveat in Lite's TSDoc — that `child.parent` links are only established by `addToScene`,
 * so a node from a freshly loaded asset must have its container added before it is reparented —
 * does not apply to nodes ignifx creates, because {@link linkParent} establishes the link itself.
 *
 * @param child - The node to move.
 * @param parent - The new parent, or `null` to detach the child to world space.
 *
 * @internal
 */
export function reparentKeepingWorld(child: SceneNode, parent: SceneNode | null): void {
  setParent(child, parent);
}

/**
 * Copies a node's world matrix into `out`.
 *
 * @remarks
 * Allocation-free on the ignifx side, which is why the destination is a parameter: Lite's
 * `worldMatrix` getter may recompute up the parent chain, and the object it returns is Lite's own
 * cache — never hold on to it. Lite documents `Mat4` as opaque ("callers MUST NOT depend on the
 * underlying storage"); it is a `Float32Array` in 1.27.0 (`lib/math/_matrix-allocator.js`), so
 * copying element by element is the only supported read.
 *
 * @param node - The node to read.
 * @param out - A sink of at least 16 elements, written in column-major order.
 * @returns `out`, for chaining.
 *
 * @internal
 */
export function readWorldMatrix(node: SceneNode, out: MutableMat4Like): MutableMat4Like {
  const matrix = node.worldMatrix;
  for (let index = 0; index < MATRIX_LENGTH; index += 1) {
    out[index] = matrix[index] ?? 0;
  }
  return out;
}

/**
 * Reads a node's world-matrix version — the counter that increases whenever the node's world
 * matrix is invalidated, by its own TRS or by any ancestor's.
 *
 * @remarks
 * Snapshot it to detect movement without comparing matrices; systems that maintain acceleration
 * structures do exactly that (`docs/architecture/02-scene-graph.md` §9). The counter is
 * monotonically increasing but not a change *count*: it moves on invalidation, not on
 * recomputation, and a bulk `position.set(...)` bumps it even when the values are unchanged.
 *
 * @param node - The node to read.
 * @returns The current version.
 *
 * @internal
 */
export function worldMatrixVersion(node: SceneNode): number {
  return node.worldMatrixVersion;
}

/**
 * Decomposes a node's world matrix into translation, rotation, and scale, writing into the three
 * output parameters.
 *
 * @remarks
 * The decomposition is canonical rather than sign-faithful: a mirror is folded into a negative Y
 * scale, so recomposing reproduces the matrix but a matrix built from a negative X or Z scale comes
 * back as a negative Y scale plus a different rotation. A degenerate axis (scale below `1e-8`) is
 * tolerated: the rotation stays finite but is meaningless for that axis.
 *
 * ignifx allocates nothing here, but Lite's `mat4Decompose` allocates its own TRS triple per call
 * (`lib/math/mat4-decompose.js`), so this is not yet a zero-allocation path in the sense of coding
 * standards §7. The math module's in-place decomposition replaces the Lite call when it lands.
 *
 * @param node - The node to read.
 * @param outPosition - Receives the world translation.
 * @param outRotation - Receives the world rotation as a unit quaternion.
 * @param outScale - Receives the per-axis world scale.
 *
 * @internal
 */
export function decomposeWorld(
  node: SceneNode,
  outPosition: MutableVec3Like,
  outRotation: MutableQuatLike,
  outScale: MutableVec3Like,
): void {
  const decomposed = mat4Decompose(node.worldMatrix);
  outPosition.x = decomposed.translation.x;
  outPosition.y = decomposed.translation.y;
  outPosition.z = decomposed.translation.z;
  outRotation.x = decomposed.rotation.x;
  outRotation.y = decomposed.rotation.y;
  outRotation.z = decomposed.rotation.z;
  outRotation.w = decomposed.rotation.w;
  outScale.x = decomposed.scale.x;
  outScale.y = decomposed.scale.y;
  outScale.z = decomposed.scale.z;
}

/**
 * Shows or hides a node and its whole subtree.
 *
 * @remarks
 * Lite materializes the cascade at write time — it walks `children` and writes `visible` on every
 * descendant — so a node added to the subtree afterwards does not inherit the state and must be
 * set separately. This is how entity deactivation hides render objects
 * (`docs/architecture/01-lifecycle-and-time.md` §6); removing a mesh from its last scene disposes
 * it permanently, so visibility, never removal, is the deactivation path.
 *
 * @param node - The subtree root.
 * @param visible - `true` to show the subtree, `false` to hide it.
 *
 * @internal
 */
export function setNodeVisible(node: SceneNode, visible: boolean): void {
  setSubtreeVisible(node, visible);
}

/**
 * Shows or hides **one** node, without touching its subtree.
 *
 * @remarks
 * Lite's `visible` is per node — the renderer reads each node's own flag, and `setSubtreeVisible`
 * is only a bulk helper that materialises a cascade at write time. ignifx already materialises
 * `activeInHierarchy` over the subtree itself, so it writes one flag per entity: correct for a
 * subtree that mixes active and inactive entities, and linear rather than quadratic.
 *
 * @param node - The node to show or hide.
 * @param visible - `true` to show it, `false` to hide it.
 *
 * @internal
 */
export function setNodeSelfVisible(node: SceneNode, visible: boolean): void {
  node.visible = visible;
}

/**
 * Writes the ignifx identity into a node's Lite metadata bag, under the single `ignifx` key.
 *
 * @remarks
 * `LiteMetadata` is an open record (`{ gltf?: GltfMetadata; [key: string]: unknown }`), so the tag
 * coexists with the `gltf.extras` a glTF load writes. The metadata object is created on demand;
 * nodes ignifx never tags keep `metadata` undefined.
 *
 * @param node - The node to tag.
 * @param tag - The owning entity, and the component that created the node when it is not the
 * entity's own transform.
 *
 * @internal
 */
export function tagNode(node: SceneNode, tag: NodeTag): void {
  const metadata = (node.metadata ??= {});
  metadata[METADATA_KEY] = tag;
}

/**
 * Reads the ignifx identity back from a node.
 *
 * @param node - The node to read; it may be any Lite node, including one ignifx never created.
 * @returns The tag {@link tagNode} wrote, or `null` when the node carries none.
 *
 * @internal
 */
export function readNodeTag(node: SceneNode): NodeTag | null {
  const metadata = node.metadata;
  if (metadata === undefined) {
    return null;
  }
  const value = metadata[METADATA_KEY];
  if (typeof value !== "object" || value === null || !("entity" in value)) {
    return null;
  }
  const entity = value.entity;
  if (typeof entity !== "number") {
    return null;
  }
  const component = "component" in value ? value.component : undefined;
  return typeof component === "number" ? { entity, component } : { entity };
}

/**
 * The `children` array of a world-matrix provider, when it has one.
 *
 * @remarks
 * `SceneNode.parent` is typed as the minimal {@link IWorldMatrixProvider}, which declares no
 * `children`, but every parent ignifx links is a scene node. Lite's own `setParent` solves this the
 * same way (`lib/scene/set-parent.js`), and the array check keeps a non-node provider — a camera,
 * say — from being treated as a tree node.
 *
 * @param provider - The candidate parent.
 * @returns The provider's children, or `null` when it is not a tree node.
 */
function childrenOf(provider: IWorldMatrixProvider | null): SceneNode[] | null {
  if (provider === null || !("children" in provider)) {
    return null;
  }
  const children = provider.children;
  // The invariant is that a world-matrix provider with
  // an array-valued `children` is a `SceneNode`, which is what Lite itself assumes here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Array.isArray(children) ? (children as SceneNode[]) : null;
}

/**
 * The Babylon Lite node an ignifx `Transform` wraps, re-exported under an ignifx name so that
 * feature code can name the type without importing `@babylonjs/lite`
 * (`CONSTITUTION.md` §3.4, coding standards §4).
 *
 * @remarks
 * Unstable: it is Lite's type, reachable only through documented `.lite` escape hatches, and it is
 * excluded from the stability guarantees of `CONSTITUTION.md` Article IV.
 *
 * @public
 */
export type LiteSceneNode = SceneNode;

/**
 * The node's local position as a live, writable view.
 *
 * @remarks
 * Zero-copy: the returned object *is* Lite's `ObservableVec3` over the node's TRS, so `.x += 1`,
 * `.set(x, y, z)`, and `.copyFrom(v)` write straight through and invalidate the subtree's world
 * matrices (`docs/architecture/02-scene-graph.md` §5). Never hold it past the node's lifetime.
 *
 * @param node - The node to view.
 * @returns The live local position.
 *
 * @internal
 */
export function localPosition(node: SceneNode): MutableVec3 {
  return node.position;
}

/**
 * The node's local rotation as a live, writable view.
 *
 * @param node - The node to view.
 * @returns The live local rotation quaternion.
 *
 * @internal
 */
export function localRotation(node: SceneNode): MutableQuat {
  return node.rotationQuaternion;
}

/**
 * The node's local scale as a live, writable view.
 *
 * @param node - The node to view.
 * @returns The live local scale.
 *
 * @internal
 */
export function localScale(node: SceneNode): MutableVec3 {
  return node.scaling;
}

/**
 * Reads a node's own visibility flag.
 *
 * @remarks
 * Lite leaves `visible` `undefined` on a node that was never hidden, which means *visible*; this
 * normalises that to `true` so callers never have to spell the tri-state out. Only
 * {@link setNodeVisible} writes it, and it materialises the cascade at write time.
 *
 * @param node - The node to read.
 * @returns `true` when the node renders.
 *
 * @internal
 */
export function isNodeVisible(node: SceneNode): boolean {
  return node.visible !== false;
}

/**
 * Renames a node.
 *
 * @remarks
 * Lite never uses the name for lookup, so this is purely for debugging and for the names that show
 * up in Lite-side tooling; ignifx keeps `Entity.name` as the source of truth and mirrors it here.
 *
 * @param node - The node to rename.
 * @param name - The new name.
 *
 * @internal
 */
export function setNodeName(node: SceneNode, name: string): void {
  node.name = name;
}

/**
 * The parent a node is currently linked to, when that parent is itself a scene node.
 *
 * @param node - The node to read.
 * @returns The parent node, or `null` when the node is unparented or its parent is a bare
 * world-matrix provider such as a camera.
 *
 * @internal
 */
export function parentNode(node: SceneNode): SceneNode | null {
  const parent = node.parent;
  if (parent === null || !("children" in parent)) {
    return null;
  }
  // A world-matrix provider that carries `children` is
  // a `SceneNode` — the same invariant Lite's own `setParent` relies on.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return parent as SceneNode;
}
