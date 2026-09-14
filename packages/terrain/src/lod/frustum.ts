/**
 * A view frustum for CPU culling (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2).
 *
 * Babylon Lite does not frustum-cull plain meshes, so a chunked terrain culls its own chunks:
 * six planes are extracted from the camera's view-projection matrix (Gribb & Hartmann 2001) for
 * WebGPU's clip space — `x, y` in `-w..w`, `z` in `0..w`.
 */

/** Floats per plane: `a, b, c, d` with `a x + b y + c z + d >= 0` inside. */
const PLANE_STRIDE = 4;

/** How many planes a frustum has. */
const PLANE_COUNT = 6;

/**
 * Six planes extracted from a view-projection matrix.
 *
 * @example
 * ```ts
 * const frustum = new Frustum();
 * frustum.setFromViewProjection(viewProjection.elements);
 * frustum.intersectsBox(-1, 0, -1, 1, 2, 1);
 * ```
 *
 * @public
 */
export class Frustum {
  /** The planes, four floats each, normalised: left, right, bottom, top, near, far. */
  readonly planes: Float32Array = new Float32Array(PLANE_COUNT * PLANE_STRIDE);

  #isValid = false;

  /**
   * Whether the last matrix given produced a usable frustum. A headless camera with no surface, or
   * a matrix with a non-finite element, does not; then nothing is culled.
   *
   * @returns `true` when {@link Frustum.intersectsBox} can answer.
   */
  get isValid(): boolean {
    return this.#isValid;
  }

  /**
   * Extracts the planes from a column-major view-projection matrix.
   *
   * @param m - Sixteen column-major elements, `m[column * 4 + row]`.
   * @returns Whether the frustum is valid.
   */
  setFromViewProjection(m: ArrayLike<number>): boolean {
    const planes = this.planes;
    let valid = m.length >= 16;
    // Row r of the column-major matrix is (m[r], m[4 + r], m[8 + r], m[12 + r]). The six half-spaces
    // are row3 ± row0, row3 ± row1, row2, and row3 - row2; under reverse depth the last two swap
    // names, which changes nothing because a box is tested against all six.
    writePlane(planes, 0, m, 3, 0, 1);
    writePlane(planes, 1, m, 3, 0, -1);
    writePlane(planes, 2, m, 3, 1, 1);
    writePlane(planes, 3, m, 3, 1, -1);
    writePlane(planes, 4, m, 2, -1, 0);
    writePlane(planes, 5, m, 3, 2, -1);
    for (let plane = 0; plane < PLANE_COUNT && valid; plane += 1) {
      const at = plane * PLANE_STRIDE;
      const a = planes[at] ?? 0;
      const b = planes[at + 1] ?? 0;
      const c = planes[at + 2] ?? 0;
      const d = planes[at + 3] ?? 0;
      const length = Math.hypot(a, b, c);
      if (!Number.isFinite(length) || length < 1e-12 || !Number.isFinite(d)) {
        valid = false;
        break;
      }
      planes[at] = a / length;
      planes[at + 1] = b / length;
      planes[at + 2] = c / length;
      planes[at + 3] = d / length;
    }
    this.#isValid = valid;
    return valid;
  }

  /**
   * Whether an axis-aligned box is at least partly inside the frustum.
   *
   * @remarks
   * Conservative: a box that straddles a corner may be reported inside when it is not, which costs
   * a draw, never a missing chunk. An invalid frustum reports everything inside.
   *
   * @param minX - The box's smallest X.
   * @param minY - The box's smallest Y.
   * @param minZ - The box's smallest Z.
   * @param maxX - The box's largest X.
   * @param maxY - The box's largest Y.
   * @param maxZ - The box's largest Z.
   * @returns `false` only when the box is wholly outside one plane.
   */
  intersectsBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    if (!this.#isValid) {
      return true;
    }
    const planes = this.planes;
    for (let plane = 0; plane < PLANE_COUNT; plane += 1) {
      const at = plane * PLANE_STRIDE;
      const a = planes[at] ?? 0;
      const b = planes[at + 1] ?? 0;
      const c = planes[at + 2] ?? 0;
      const d = planes[at + 3] ?? 0;
      // The box corner furthest along the plane normal; if even that is outside, all of it is.
      const px = a >= 0 ? maxX : minX;
      const py = b >= 0 ? maxY : minY;
      const pz = c >= 0 ? maxZ : minZ;
      if (a * px + b * py + c * pz + d < 0) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Writes one plane as `rowA + sign * rowB` of the matrix; `sign` `0` takes `rowA` alone.
 *
 * @param planes - The plane array.
 * @param plane - Which plane to write.
 * @param m - The matrix elements.
 * @param rowA - The first row index.
 * @param rowB - The second row index.
 * @param sign - `1`, `-1`, or `0` to use `rowA` by itself.
 */
function writePlane(
  planes: Float32Array,
  plane: number,
  m: ArrayLike<number>,
  rowA: number,
  rowB: number,
  sign: number,
): void {
  const at = plane * PLANE_STRIDE;
  for (let column = 0; column < 4; column += 1) {
    const a = m[column * 4 + rowA] ?? 0;
    const b = m[column * 4 + rowB] ?? 0;
    planes[at + column] = sign === 0 ? a : a + sign * b;
  }
}
