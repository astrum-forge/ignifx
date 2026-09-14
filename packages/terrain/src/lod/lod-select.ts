/**
 * Level-of-detail selection for terrain chunks
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.2).
 *
 * The thresholds double per level: level 1 takes over at `lodDistance * lodBias`, level 2 at twice
 * that, level `n` at `lodDistance * lodBias * 2^(n-1)`. A camera sitting on a threshold would
 * otherwise flip a chunk between two meshes every frame, so {@link selectLod} keeps the current
 * level until the camera is {@link LOD_HYSTERESIS} past the boundary in the direction it is moving.
 */

/**
 * How far past a threshold, as a fraction, a chunk waits before switching level.
 *
 * @public
 */
export const LOD_HYSTERESIS = 0.1;

/**
 * The camera distance at which a level takes over.
 *
 * @param level - The level, at least 1.
 * @param lodDistance - The terrain's `chunks.lodDistance`, in metres.
 * @param lodBias - The `Terrain.lodBias` multiplier.
 * @returns The threshold, in metres.
 *
 * @public
 */
export function lodThreshold(level: number, lodDistance: number, lodBias: number): number {
  return lodDistance * lodBias * 2 ** (level - 1);
}

/**
 * Picks a chunk's level for a camera distance, with hysteresis around the level it shows now.
 *
 * @param distance - The camera's distance from the chunk, in metres.
 * @param lodDistance - The terrain's `chunks.lodDistance`.
 * @param lodBias - The `Terrain.lodBias` multiplier.
 * @param levels - How many levels the chunk has.
 * @param current - The level currently showing.
 * @returns The level to show.
 *
 * @example
 * ```ts
 * selectLod(150, 96, 1, 4, 0); // 1: past 96 m, level 1 takes over
 * selectLod(100, 96, 1, 4, 1); // 1: 100 m is inside the 10 % band, so level 1 stays
 * ```
 *
 * @public
 */
export function selectLod(
  distance: number,
  lodDistance: number,
  lodBias: number,
  levels: number,
  current: number,
): number {
  const last = levels - 1;
  let level = current < 0 ? 0 : current > last ? last : current;
  // Coarser while the camera is well past the next threshold.
  while (level < last && distance >= lodThreshold(level + 1, lodDistance, lodBias) * (1 + LOD_HYSTERESIS)) {
    level += 1;
  }
  // Finer while the camera is well inside the current threshold.
  while (level > 0 && distance < lodThreshold(level, lodDistance, lodBias) * (1 - LOD_HYSTERESIS)) {
    level -= 1;
  }
  return level;
}

/**
 * The distance from a point to the nearest point of an axis-aligned box; zero inside it.
 *
 * @param x - The point's X.
 * @param y - The point's Y.
 * @param z - The point's Z.
 * @param bounds - `[minX, minY, minZ, maxX, maxY, maxZ]`, read from `offset`.
 * @param offset - Where the six values start.
 * @returns The distance, in the box's units.
 *
 * @public
 */
export function distanceToBox(x: number, y: number, z: number, bounds: ArrayLike<number>, offset = 0): number {
  const dx = axisDistance(x, bounds[offset] ?? 0, bounds[offset + 3] ?? 0);
  const dy = axisDistance(y, bounds[offset + 1] ?? 0, bounds[offset + 4] ?? 0);
  const dz = axisDistance(z, bounds[offset + 2] ?? 0, bounds[offset + 5] ?? 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * How far a coordinate is outside an interval.
 *
 * @param value - The coordinate.
 * @param min - The interval's low end.
 * @param max - The interval's high end.
 * @returns Zero inside, else the distance to the nearer end.
 */
function axisDistance(value: number, min: number, max: number): number {
  if (value < min) {
    return min - value;
  }
  return value > max ? value - max : 0;
}
