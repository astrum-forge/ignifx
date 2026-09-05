/* oxlint-disable no-underscore-dangle -- reading Lite's private mesh fields is the point of this
   file: spike S2.4 proves that two clones share one geometry upload by object identity, and the
   only handle on that upload is `Mesh._gpu`, which `index.d.ts` does not declare. Confining the
   reads here keeps every test free of the pattern. */
import type { SceneNode } from "@babylonjs/lite";

/**
 * The private mesh fields spike S2.4 inspects, as they are written in
 * `@babylonjs/lite@1.27.0`'s `lib/scene/transform-node.js`, `lib/mesh/mesh-dispose.js`, and
 * `lib/resource/ref-count.js`.
 */
interface MeshInternals {
  /**
   * The GPU buffer wrapper. Its identity is the reference-count key, so two meshes that share one
   * upload hold the very same object.
   */
  readonly _gpu?: { readonly _refCount?: number };
  /** Set by Lite when a mesh's buffers were released because it left its last scene. */
  readonly _disposed?: boolean;
}

/**
 * Reads Lite's private fields off a node.
 *
 * @param node - The node to probe.
 * @returns The private fields.
 */
function internals(node: SceneNode): MeshInternals {
  return node as unknown as MeshInternals;
}

/**
 * The GPU buffer wrapper a mesh draws from, or `null` for a node that carries no geometry.
 *
 * @param node - The node to probe.
 * @returns The wrapper object; compare two with `toBe` to prove they share one upload.
 */
export function geometryUpload(node: SceneNode): object | null {
  return internals(node)._gpu ?? null;
}

/**
 * How many meshes co-own a mesh's geometry upload.
 *
 * @param node - The node to probe.
 * @returns The count, or `undefined` while the mesh is still the only owner — Lite only writes the
 * field on the first `retain`.
 */
export function geometryOwnerCount(node: SceneNode): number | undefined {
  return internals(node)._gpu?._refCount;
}

/**
 * Whether Lite has released a mesh's geometry.
 *
 * @param node - The node to probe.
 * @returns `true` once the buffers are gone.
 */
export function isGeometryDisposed(node: SceneNode): boolean {
  return internals(node)._disposed === true;
}
