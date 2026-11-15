/**
 * The render scene's drawn meshes for `pickRect`: each visible mesh's local bounds and world matrix,
 * with the entity node it hangs under. The projection and the tests are plain arithmetic in
 * `../scene/rect-pick.ts`; only this walk touches Lite (`CONSTITUTION.md` §3.4).
 */

import { EDITOR_ONLY_METADATA_KEY } from "@ignifx/core";
import type { AppLiteHandles } from "@ignifx/core";

/** One drawn mesh. */
export interface DrawnMesh<T> {
  /** What the mesh's owner node maps to. */
  readonly owner: T;
  /** The local bounds' low corner. */
  readonly min: readonly [number, number, number];
  /** The local bounds' high corner. */
  readonly max: readonly [number, number, number];
  /** The world matrix, column-major. */
  readonly world: ArrayLike<number>;
}

/**
 * A node's parent. Lite types it as a bare world-matrix provider, so it is followed by identity only.
 *
 * @param node - The node.
 * @returns The parent, or `null` at a root.
 */
function parentNode(node: object): object | null {
  const parent: unknown = Reflect.get(node, "parent");
  return typeof parent === "object" && parent !== null ? parent : null;
}

/**
 * Lists the visible meshes of the render scene that hang under one of the given nodes, each with
 * the nearest such node's value. A `Model` parents its glTF root with a bare `parent` assignment, so
 * the walk follows `parent` up from each mesh rather than `children` down. Meshes marked with core's
 * `EDITOR_ONLY_METADATA_KEY` (the host's grid and lines) are skipped.
 *
 * @param handles - The app's Lite handles (`app.lite`).
 * @param owners - The nodes to attribute meshes to (an entity's `transform.lite`), and their values.
 * @returns The meshes, in the render scene's order.
 */
export function drawnMeshes<T>(handles: AppLiteHandles, owners: ReadonlyMap<object, T>): DrawnMesh<T>[] {
  const memo = new Map<object, T | null>();
  const ownerOf = (start: object): T | null => {
    const walked: object[] = [];
    let found: T | null = null;
    for (let node: object | null = start; node !== null; node = parentNode(node)) {
      const known = memo.get(node);
      if (known !== undefined) {
        found = known;
        break;
      }
      walked.push(node);
      const value = owners.get(node);
      if (value !== undefined) {
        found = value;
        break;
      }
    }
    for (const node of walked) {
      memo.set(node, found);
    }
    return found;
  };
  const result: DrawnMesh<T>[] = [];
  for (const mesh of handles.scene.meshes) {
    const min = mesh.boundMin;
    const max = mesh.boundMax;
    if (min === undefined || max === undefined || mesh.visible === false) {
      continue;
    }
    if (mesh.metadata?.[EDITOR_ONLY_METADATA_KEY] === true) {
      continue;
    }
    const owner = ownerOf(mesh);
    if (owner !== null) {
      result.push({ owner, min, max, world: mesh.worldMatrix });
    }
  }
  return result;
}
