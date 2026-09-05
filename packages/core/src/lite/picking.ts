import { pickMeshesWithRay, pickWithRay } from "@babylonjs/lite";
import { readNodeTag } from "./node.js";
import type { NodeTag } from "./node.js";
import type { Mesh, PickingInfo, Ray, RayPickOptions, SceneContext } from "@babylonjs/lite";

/**
 * CPU picking half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §3): the
 * synchronous ray tests behind `world.raycastRender`, and the mapping from a Lite hit back to the
 * ignifx entity that owns the mesh. The GPU picker lives in `./gpu/picker.ts` because it needs a
 * device and a rendered frame.
 *
 * Everything here is `@internal`.
 *
 * ## What Lite's ray pick does (verified against `@babylonjs/lite@1.27.0` `lib/picking/ray-pick.js`)
 *
 * - It walks `scene.meshes`, skips anything with `pickable === false` unless `skipPickableCheck` is
 *   set, then applies the caller's `predicate`, and tests the ray against each candidate's local
 *   AABB before its triangles.
 * - The triangle test reads `mesh._cpuPositions`, the CPU copy every mesh factory retains
 *   (`lib/mesh/mesh-factories.js`, `retainMeshGeometry`). A mesh with no CPU positions — one built
 *   from a GPU-only path — is silently skipped, so a CPU pick can miss a mesh a GPU pick would hit.
 * - **Visibility is ignored.** `mesh.visible === false` still occludes and still returns a hit; only
 *   `pickable` and the predicate filter. That is Lite's documented behaviour, and it is why the
 *   component layer passes a predicate rather than relying on hiding.
 */

/**
 * The result of a Babylon Lite pick — CPU ray or GPU picker — re-exported under an ignifx name so
 * feature code can name the type without importing `@babylonjs/lite` (coding standards §4).
 *
 * @internal
 */
export type LitePickInfo = PickingInfo;

/**
 * A ray in the shape Lite expects: three-element tuples that can be rewritten in place, so a
 * picking loop reuses one ray and allocates nothing (coding standards §7).
 *
 * @internal
 */
export type PickRay = Ray;

/**
 * Creates a reusable ray, pointing along `+Z` from the origin.
 *
 * @returns A fresh ray. **Allocates** — create one per picking site, not per pick.
 *
 * @example
 * ```ts
 * const ray = createPickRay();
 * screenToRay(camera, x, y, width, height, ray);
 * const hit = raycastScene(scene, ray);
 * ```
 *
 * @internal
 */
export function createPickRay(): PickRay {
  return { origin: [0, 0, 0], direction: [0, 0, 1], length: Number.MAX_VALUE };
}

/**
 * Points a ray at a world-space origin and direction, in place.
 *
 * @param ray - The ray to rewrite.
 * @param originX - The world-space origin x.
 * @param originY - The world-space origin y.
 * @param originZ - The world-space origin z.
 * @param directionX - The direction x; it need not be normalized.
 * @param directionY - The direction y.
 * @param directionZ - The direction z.
 * @param length - How far the ray reaches, in metres.
 *
 * @internal
 */
export function setPickRay(
  ray: PickRay,
  originX: number,
  originY: number,
  originZ: number,
  directionX: number,
  directionY: number,
  directionZ: number,
  length: number,
): void {
  const origin = ray.origin;
  origin[0] = originX;
  origin[1] = originY;
  origin[2] = originZ;
  const magnitude = Math.hypot(directionX, directionY, directionZ);
  const scale = magnitude > 0 ? 1 / magnitude : 0;
  const direction = ray.direction;
  direction[0] = directionX * scale;
  direction[1] = directionY * scale;
  direction[2] = directionZ * scale;
  ray.length = length;
}

/**
 * Casts a ray against every renderable mesh in a scene, on the CPU.
 *
 * @remarks
 * This is `world.raycastRender`. It is distinct from a physics raycast
 * (`docs/architecture/09-physics.md` §5): it hits render geometry, including meshes that carry no
 * collider.
 *
 * @param scene - The render scene.
 * @param ray - The ray to cast.
 * @param options - An optional mesh predicate.
 * @returns Lite's picking info. Check `hit` before reading anything else. **Allocates** one result
 * object per call — Lite builds it.
 *
 * @internal
 */
export function raycastScene(scene: SceneContext, ray: PickRay, options?: RayPickOptions): PickingInfo {
  return pickWithRay(scene, ray, options);
}

/**
 * Casts a ray against an explicit list of meshes, on the CPU.
 *
 * @param meshes - The meshes to test.
 * @param ray - The ray to cast.
 * @param options - An optional mesh predicate.
 * @returns Lite's picking info.
 *
 * @internal
 */
export function raycastMeshes(meshes: Iterable<Mesh>, ray: PickRay, options?: RayPickOptions): PickingInfo {
  return pickMeshesWithRay(meshes, ray, options);
}

/**
 * Casts a ray against a scene's renderable meshes, considering only the meshes whose ignifx tag a
 * predicate accepts.
 *
 * @remarks
 * The predicate is stated over the *tag* rather than over Lite's `Mesh` so the component layer can
 * filter by entity without naming a Lite type (`CONSTITUTION.md` §3.4). Lite's own
 * `pickable === false` exclusion still runs first.
 *
 * @param scene - The render scene.
 * @param ray - The ray to cast.
 * @param accept - Decides whether a mesh may be picked, from the ignifx tag its node carries.
 * @returns Lite's picking info.
 *
 * @internal
 */
export function raycastSceneWhere(
  scene: SceneContext,
  ray: PickRay,
  accept: (tag: NodeTag | null) => boolean,
): PickingInfo {
  const options: RayPickOptions = { predicate: (mesh: Mesh): boolean => accept(readNodeTag(mesh)) };
  return pickWithRay(scene, ray, options);
}

/**
 * Resolves a hit back to the ignifx entity and component that own the mesh.
 *
 * @param info - A result from {@link raycastScene}, {@link raycastMeshes}, or the GPU picker.
 * @returns The owning entity's tag, or `null` when the ray missed or the mesh is not one ignifx
 * created (a glTF child node inside a `Model`, for instance, whose tag lives on the model's root).
 *
 * @internal
 */
export function readPickedTag(info: PickingInfo): NodeTag | null {
  const mesh = info.pickedMesh;
  if (mesh === null) {
    return null;
  }
  return readNodeTag(mesh);
}
