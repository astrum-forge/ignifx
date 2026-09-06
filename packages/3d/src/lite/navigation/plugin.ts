import {
  addAgent,
  addBoxObstacle,
  addCylinderObstacle,
  agentGoto,
  computePath,
  createNavCrowd,
  createNavigationPluginAsync,
  createNavMesh,
  createNavMeshFromSources,
  disposeNavigationPlugin,
  getAgentPosition,
  getAgentVelocity,
  getClosestPoint,
  raycast as navRaycast,
  removeObstacle,
  setNavigationRandomSeed,
  updateNavCrowd,
  updateNavMeshObstacles,
} from "@babylonjs/lite";
import type {
  AgentParameters,
  Mesh,
  NavCrowd,
  NavigationPlugin,
  NavMeshParameters,
  NavMeshSource,
  ObstacleHandle,
  SceneNode,
  Vec3 as LiteVec3,
} from "@babylonjs/lite";
import type { MutableVec3, Vec3Like } from "@ignifx/core";

/**
 * The Babylon Lite half of navigation (`docs/architecture/12-3d-toolkit.md` §5, coding standards §4
 * — this file and the animation mixer next door are the only places in the package that may import
 * `@babylonjs/lite`).
 *
 * ## What Lite gives us, verified against `@babylonjs/lite@1.27.0`
 *
 * - `createNavigationPluginAsync(options?)` (`index.d.ts` 2736) loads the Recast WebAssembly and
 *   returns a plugin object. The module is a process-wide singleton
 *   (`lib/navigation/navigation.js` 4-29) and every later call reuses it; the returned *plugin*
 *   object is fresh and owns its own navmesh, so one plugin per `NavMeshSurface` is correct.
 * - The wasm is **inlined** as a `data:application/wasm;base64,` URL inside
 *   `lib/_chunks/vendor/recast-navigation-Ddkygka3.js`, so nothing has to be copied into
 *   `ignifx.assets.public` and a plain Node process loads it with no configuration at all. See
 *   `docs/adr/0017-navigation-wasm.md`; `locateFile` overrides it for a build that would rather
 *   serve the `.wasm` separately.
 * - `createNavMesh(plugin, meshes, params)` (`index.d.ts` 2751) bakes from Lite meshes, reading
 *   their CPU positions and transforming by each mesh's world matrix.
 *   `createNavMeshFromSources(plugin, sources, params)` (`index.d.ts` 2756) is the non-rendering
 *   twin, taking world-space `{ positions, indices }` — which is what makes a headless bake
 *   possible at all.
 * - `createNavCrowd(plugin, maxAgents, maxAgentRadius)` (`index.d.ts` 2722) is explicitly **not**
 *   auto-updated: *"call `updateNavCrowd(crowd, dt)` each frame for full determinism"*
 *   (`index.d.ts` 2718-2721), which is exactly ADR-0003's rule.
 * - `addAgent` (`index.d.ts` 15), `agentGoto` (246), `getAgentPosition` (5704),
 *   `getAgentVelocity` (5707), `updateNavCrowd` (13341).
 * - `computePath` (`index.d.ts` 1945), `getClosestPoint` (5751), `raycast` (9360),
 *   `setNavigationRandomSeed` (10579).
 * - `addBoxObstacle` (`index.d.ts` 62), `addCylinderObstacle` (79), `removeObstacle` (9630) and
 *   `updateNavMeshObstacles` (13344) need a navmesh baked with `maxObstacles > 0`
 *   (`index.d.ts` 7331-7335).
 *
 * ## What Lite does not give us
 *
 * There is **no navmesh serialization** in 1.27.0: `index.d.ts` declares no `getNavMeshData`, no
 * `buildFromNavMeshData`, and nothing else that turns a baked navmesh into bytes or back. The
 * `.navmesh.bin` asset and the `ignifx bake navmesh` CLI command of `12-3d-toolkit.md` §5 are
 * therefore not implementable against this version, and `NavMeshSurface` reports `IGX-1210` rather
 * than pretending. There is also no `removeAgent`: an agent joins a crowd for the crowd's lifetime,
 * so a destroyed `NavMeshAgent` is parked rather than removed.
 */

/** How many components a Lite `Vec3` has, for the scratch conversions. */
const VECTOR_COMPONENTS = 3;

/**
 * Converts an ignifx vector to the plain object Lite's navigation takes.
 *
 * @param value - The ignifx vector.
 * @returns A Lite vector.
 */
function toLite(value: Vec3Like): LiteVec3 {
  return { x: value.x, y: value.y, z: value.z };
}

/**
 * Loads Recast and creates a plugin.
 *
 * @param locateFile - Overrides where the `.wasm` is fetched from; omit to use the inlined copy.
 * @returns The plugin.
 *
 * @internal
 */
export function createPlugin(locateFile?: (url: string) => string): Promise<NavigationPlugin> {
  return locateFile === undefined ? createNavigationPluginAsync() : createNavigationPluginAsync({ locateFile });
}

/**
 * Releases a plugin's navmesh, tile cache, and query.
 *
 * @param plugin - The plugin.
 *
 * @internal
 */
export function destroyPlugin(plugin: NavigationPlugin): void {
  disposeNavigationPlugin(plugin);
}

/**
 * Bakes a navmesh from raw world-space geometry.
 *
 * @param plugin - The plugin.
 * @param sources - The `{ positions, indices }` sources.
 * @param params - The Recast build parameters.
 *
 * @internal
 */
export function bakeFromSources(
  plugin: NavigationPlugin,
  sources: readonly NavMeshSource[],
  params: NavMeshParameters,
): void {
  createNavMeshFromSources(plugin, [...sources], params);
}

/**
 * Bakes a navmesh from Lite meshes already in the scene.
 *
 * @param plugin - The plugin.
 * @param meshes - The meshes.
 * @param params - The Recast build parameters.
 *
 * @internal
 */
export function bakeFromMeshes(
  plugin: NavigationPlugin,
  meshes: readonly SceneNode[],
  params: NavMeshParameters,
): void {
  // `Mesh extends SceneNode` (`index.d.ts` 7156), and `MeshRenderer.lite.mesh` hands out the clone
  // as the widest of the two. Lite refuses a node with no CPU geometry by name
  // (`lib/navigation/navigation.js` 147-153), which is a better diagnostic than anything a
  // structural check here could produce.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Lite names a geometry-less node.
  const geometry = meshes as readonly Mesh[];
  createNavMesh(plugin, [...geometry], params);
}

/**
 * Seeds Recast's randomized queries.
 *
 * @param plugin - The plugin.
 * @param value - The seed.
 *
 * @internal
 */
export function seed(plugin: NavigationPlugin, value: number): void {
  setNavigationRandomSeed(plugin, value);
}

/**
 * Creates a crowd.
 *
 * @param plugin - The plugin.
 * @param maxAgents - How many agents fit.
 * @param maxAgentRadius - The largest agent radius the crowd will see.
 * @returns The crowd.
 *
 * @internal
 */
export function makeCrowd(plugin: NavigationPlugin, maxAgents: number, maxAgentRadius: number): NavCrowd {
  return createNavCrowd(plugin, maxAgents, maxAgentRadius);
}

/**
 * Adds an agent to a crowd.
 *
 * @param crowd - The crowd.
 * @param position - Where the agent starts, in world space.
 * @param params - The Recast agent parameters.
 * @returns The agent index.
 *
 * @internal
 */
export function joinCrowd(crowd: NavCrowd, position: Vec3Like, params: AgentParameters): number {
  return addAgent(crowd, toLite(position), params);
}

/**
 * Sends an agent to a destination.
 *
 * @param crowd - The crowd.
 * @param index - The agent index.
 * @param destination - Where to go, in world space.
 *
 * @internal
 */
export function sendAgent(crowd: NavCrowd, index: number, destination: Vec3Like): void {
  agentGoto(crowd, index, toLite(destination));
}

/**
 * Reads an agent's world position.
 *
 * @param crowd - The crowd.
 * @param index - The agent index.
 * @param out - Where to write it.
 *
 * @internal
 */
export function readAgentPosition(crowd: NavCrowd, index: number, out: MutableVec3): void {
  const value = getAgentPosition(crowd, index);
  out.x = value.x;
  out.y = value.y;
  out.z = value.z;
}

/**
 * Reads an agent's world velocity.
 *
 * @param crowd - The crowd.
 * @param index - The agent index.
 * @param out - Where to write it.
 *
 * @internal
 */
export function readAgentVelocity(crowd: NavCrowd, index: number, out: MutableVec3): void {
  const value = getAgentVelocity(crowd, index);
  out.x = value.x;
  out.y = value.y;
  out.z = value.z;
}

/**
 * Advances a crowd.
 *
 * @param crowd - The crowd.
 * @param deltaSeconds - The fixed step, in seconds.
 *
 * @internal
 */
export function stepCrowd(crowd: NavCrowd, deltaSeconds: number): void {
  updateNavCrowd(crowd, deltaSeconds);
}

/**
 * Computes a path across the navmesh.
 *
 * @param plugin - The plugin.
 * @param from - The start, in world space.
 * @param to - The end, in world space.
 * @returns The corner points, start first. Empty when no path exists.
 *
 * @internal
 */
export function computeCorners(plugin: NavigationPlugin, from: Vec3Like, to: Vec3Like): readonly LiteVec3[] {
  return computePath(plugin, toLite(from), toLite(to));
}

/**
 * Snaps a point onto the navmesh.
 *
 * @param plugin - The plugin.
 * @param point - The point, in world space.
 * @param out - Where to write the snapped point.
 * @returns `true` when a point was written.
 *
 * @internal
 */
export function snap(plugin: NavigationPlugin, point: Vec3Like, out: MutableVec3): boolean {
  const value = getClosestPoint(plugin, toLite(point));
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return false;
  }
  out.x = value.x;
  out.y = value.y;
  out.z = value.z;
  return true;
}

/**
 * Casts a walkability ray across the navmesh.
 *
 * @param plugin - The plugin.
 * @param from - The start, in world space.
 * @param to - The end, in world space.
 * @param out - Where to write the hit point, when there is one.
 * @returns `true` when the ray hit an edge before reaching `to`.
 *
 * @internal
 */
export function castRay(plugin: NavigationPlugin, from: Vec3Like, to: Vec3Like, out: MutableVec3): boolean {
  const result = navRaycast(plugin, toLite(from), toLite(to));
  const point = result.hitPoint;
  if (!result.hit || point === undefined) {
    return false;
  }
  out.x = point.x;
  out.y = point.y;
  out.z = point.z;
  return true;
}

/**
 * Adds a box obstacle to a tile-cache navmesh.
 *
 * @param plugin - The plugin.
 * @param position - The centre, in world space.
 * @param halfExtents - Half the box's size on each axis.
 * @param angleRadians - Rotation around Y.
 * @returns The handle, or `null` when the navmesh has no tile cache.
 *
 * @internal
 */
export function addBox(
  plugin: NavigationPlugin,
  position: Vec3Like,
  halfExtents: Vec3Like,
  angleRadians: number,
): ObstacleHandle | null {
  return addBoxObstacle(plugin, toLite(position), toLite(halfExtents), angleRadians);
}

/**
 * Adds a cylinder obstacle to a tile-cache navmesh.
 *
 * @param plugin - The plugin.
 * @param position - The base centre, in world space.
 * @param radius - The cylinder radius.
 * @param height - The cylinder height.
 * @returns The handle, or `null` when the navmesh has no tile cache.
 *
 * @internal
 */
export function addCylinder(
  plugin: NavigationPlugin,
  position: Vec3Like,
  radius: number,
  height: number,
): ObstacleHandle | null {
  return addCylinderObstacle(plugin, toLite(position), radius, height);
}

/**
 * Removes an obstacle.
 *
 * @param plugin - The plugin.
 * @param handle - The handle `addBox`/`addCylinder` returned.
 *
 * @internal
 */
export function dropObstacle(plugin: NavigationPlugin, handle: ObstacleHandle): void {
  removeObstacle(plugin, handle);
}

/**
 * Flushes every pending tile-cache obstacle request.
 *
 * @param plugin - The plugin.
 *
 * @internal
 */
export function flushObstacles(plugin: NavigationPlugin): void {
  updateNavMeshObstacles(plugin);
}

/**
 * Builds a `{ positions, indices }` source from an ignifx geometry description, applying a world
 * matrix if one is supplied.
 *
 * @param positions - Three floats per vertex, in local space.
 * @param indices - Three indices per triangle.
 * @param matrix - A column-major 4x4 world matrix, or `null` for geometry already in world space.
 * @returns The source Lite bakes from.
 *
 * @internal
 */
export function toSource(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  matrix: ArrayLike<number> | null,
): NavMeshSource {
  if (matrix === null) {
    return { positions, indices };
  }
  const out = new Float32Array(positions.length);
  for (let index = 0; index + VECTOR_COMPONENTS - 1 < positions.length; index += VECTOR_COMPONENTS) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    out[index] = (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0);
    out[index + 1] = (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0);
    out[index + 2] = (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0);
  }
  return { positions: out, indices };
}
