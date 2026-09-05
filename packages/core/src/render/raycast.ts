import { createPickRay, raycastScene, raycastSceneWhere, setPickRay } from "../lite/picking.js";
import { acceptsEntityTag, rendererInternals } from "./renderer.js";
import type { Ray } from "./camera.js";
import type { RenderPick, RenderPickOptions } from "./renderer.js";
import type { NodeTag } from "../lite/node.js";
import type { PickRay } from "../lite/picking.js";
import type { LiteScene } from "../lite/scene.js";
import type { World } from "../world/world.js";

/**
 * `world.raycastRender` (`docs/architecture/07-rendering.md` §3): the synchronous CPU ray test
 * against renderable meshes.
 *
 * It lives here rather than on `World` so that the world module keeps knowing nothing about the
 * renderer beyond two type imports: the conversion into Lite's ray shape, the entity filter, and
 * the mapping from a Lite hit back to an entity are all rendering concerns.
 *
 * ## What it can and cannot see
 *
 * Lite's `pickWithRay` walks `scene.meshes`, skips anything with `pickable === false`, applies the
 * caller's predicate, and tests each candidate's local AABB before its triangles — reading
 * `mesh._cpuPositions`, the CPU copy every mesh factory retains. Two consequences are worth
 * repeating at the call site, because neither is obvious:
 *
 * - **Visibility is ignored.** A hidden mesh still occludes and still returns a hit. Only
 *   `pickable` and the predicate filter, which is why `MeshRenderer.pickable` exists.
 * - **A mesh with no CPU positions is skipped.** A CPU pick can therefore miss geometry a GPU pick
 *   would hit; `app.renderer.pickAsync` is the exact answer.
 */

/** One reusable ray per module, so a picking loop allocates nothing (coding standards §7). */
let scratch: PickRay | null = null;

/**
 * Casts a ray against a world's renderable meshes and resolves the hit back to its entity.
 *
 * @param world - The world being picked in, for the handle tables.
 * @param scene - The Lite render scene.
 * @param ray - The ray to cast.
 * @param options - An entity filter.
 * @returns What was hit, or `null` for a miss.
 *
 * @internal
 */
export function raycastRenderScene(
  world: World,
  scene: LiteScene,
  ray: Ray,
  options?: RenderPickOptions,
): RenderPick | null {
  const renderer = rendererInternals(world.app.renderer);
  const pickRay = (scratch ??= createPickRay());
  setPickRay(
    pickRay,
    ray.origin.x,
    ray.origin.y,
    ray.origin.z,
    ray.direction.x,
    ray.direction.y,
    ray.direction.z,
    ray.length,
  );
  const filter = options?.filter;
  const info =
    filter === undefined
      ? raycastScene(scene, pickRay)
      : raycastSceneWhere(scene, pickRay, (tag: NodeTag | null): boolean => acceptsEntityTag(world, tag, filter));
  return renderer.resolvePick(info);
}
