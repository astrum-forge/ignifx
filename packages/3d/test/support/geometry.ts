/**
 * Navigation test geometry, built in code.
 *
 * `NavMeshSurface.addSource` takes world-space positions and indices, so a headless test can bake a
 * navmesh with no GPU, no `MeshAsset`, and no glTF anywhere in sight — which is exactly what makes
 * the Phase 7 navigation exit criteria runnable in plain Node.
 */

/** One piece of world-space geometry. */
export interface Geometry {
  /** Three floats per vertex. */
  readonly positions: readonly number[];
  /** Three indices per triangle. */
  readonly indices: readonly number[];
}

/**
 * A horizontal quad, wound so its normal points up.
 *
 * @param halfSize - Half the quad's extent on X and Z, in metres.
 * @param y - The height of the quad.
 * @returns The geometry.
 */
export function floorGeometry(halfSize: number, y: number = 0): Geometry {
  return {
    positions: [-halfSize, y, -halfSize, halfSize, y, -halfSize, halfSize, y, halfSize, -halfSize, y, halfSize],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

/**
 * A closed box.
 *
 * @param center - The box's centre.
 * @param halfExtents - Half the box's size on each axis.
 * @returns The geometry.
 */
export function boxGeometry(
  center: readonly [number, number, number],
  halfExtents: readonly [number, number, number],
): Geometry {
  const positions: number[] = [];
  for (const corner of CORNERS) {
    positions.push(
      center[0] + corner[0] * halfExtents[0],
      center[1] + corner[1] * halfExtents[1],
      center[2] + corner[2] * halfExtents[2],
    );
  }
  return { positions, indices: BOX_INDICES };
}

/** The eight corners of a unit box, in the order {@link BOX_INDICES} assumes. */
const CORNERS: readonly (readonly [number, number, number])[] = Object.freeze([
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
]);

/** The twelve triangles of a closed box. */
const BOX_INDICES: readonly number[] = Object.freeze([
  0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0,
]);
