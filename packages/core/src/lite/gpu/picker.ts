import { createGpuPicker, disposePicker, enableDetailedPicking, pickAsync } from "@babylonjs/lite";
import { readNodeTag } from "../node.js";
import type { NodeTag } from "../node.js";
import type { GpuPicker, Mesh, PickingInfo, PickOptions, SceneContext } from "@babylonjs/lite";

/**
 * GPU picking half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §3): the
 * pixel-exact pick behind `app.renderer.pickAsync`.
 *
 * Everything here is `@internal`.
 *
 * ## How the pick runs (verified against `@babylonjs/lite@1.27.0` `lib/picking/gpu-picker.js`)
 *
 * - `createGpuPicker(scene)` allocates nothing; the 1×1 pick targets and staging buffers are created
 *   on the first pick and reused, and they are re-created when the engine's device changes (after a
 *   device loss).
 * - The picker draws every candidate mesh into a one-pixel target with its identity in the colour
 *   attachment, then reads it back. `pickable === false` meshes and anything the `filter` predicate
 *   rejects are excluded from the candidate list entirely, so they neither occlude nor return.
 * - The pixel is mapped through the camera's **pixel** viewport, and a pick outside that viewport
 *   returns a miss rather than a clamped hit.
 * - **Picks are serialised per picker.** `pickAsync` chains each call onto the previous one's
 *   promise — including a rejected one — because the picker owns exactly one set of staging
 *   buffers. Concurrent picks are therefore correct but not concurrent; a picker per pointer is the
 *   way to overlap them.
 * - A scene with no camera resolves to a miss immediately.
 */

/**
 * The Babylon Lite GPU picker an app owns, re-exported under an ignifx name (coding standards §4).
 *
 * @internal
 */
export type LiteGpuPicker = GpuPicker;

/**
 * Creates a picker for a scene.
 *
 * @param scene - The scene to pick in.
 * @returns The picker. Release it with {@link disposeScenePicker}.
 *
 * @example
 * ```ts
 * const picker = createScenePicker(scene);
 * const hit = await pickScenePixel(picker, event.offsetX, event.offsetY);
 * ```
 *
 * @internal
 */
export function createScenePicker(scene: SceneContext): GpuPicker {
  return createGpuPicker(scene);
}

/**
 * Picks the object under one CSS pixel of the canvas.
 *
 * @remarks
 * Coordinates are in CSS pixels relative to the canvas; Lite scales them by the backing-store ratio
 * itself. The returned info carries `pickedPoint` and `pickedNormal` only when detailed picking is
 * on ({@link enableScenePickerDetail}); without it, `pickedMesh` and `distance` are what a pick
 * yields.
 *
 * @param picker - The picker.
 * @param x - The CSS pixel x, from the canvas's left edge.
 * @param y - The CSS pixel y, from the canvas's top edge.
 * @param options - A mesh filter, identities to ignore, or a WGSL discard rule.
 * @returns The hit. Calls on one picker run one at a time.
 *
 * @internal
 */
export function pickScenePixel(picker: GpuPicker, x: number, y: number, options?: PickOptions): Promise<PickingInfo> {
  return pickAsync(picker, x, y, options);
}

/**
 * Picks the object under one CSS pixel, considering only the meshes whose ignifx tag a predicate
 * accepts.
 *
 * @remarks
 * The predicate is stated over the *tag* rather than over Lite's `Mesh` so that the component layer
 * can filter by entity without naming a Lite type (`CONSTITUTION.md` §3.4). A rejected mesh is
 * excluded from the candidate list entirely, so it neither occludes nor returns.
 *
 * @param picker - The picker.
 * @param x - The CSS pixel x, from the canvas's left edge.
 * @param y - The CSS pixel y, from the canvas's top edge.
 * @param accept - Decides whether a mesh may be picked, from the ignifx tag its node carries.
 * @returns The hit.
 *
 * @internal
 */
export function pickScenePixelWhere(
  picker: GpuPicker,
  x: number,
  y: number,
  accept: (tag: NodeTag | null) => boolean,
): Promise<PickingInfo> {
  const options: PickOptions = { filter: (mesh: Mesh): boolean => accept(readNodeTag(mesh)) };
  return pickAsync(picker, x, y, options);
}

/**
 * Turns on triangle-exact picking, so hits carry a point, a normal, and barycentric coordinates.
 *
 * @remarks
 * It costs an extra render target and a second readback per pick, so it is opt-in: the common
 * "which entity did I click" question does not need it.
 *
 * @param picker - The picker to upgrade.
 *
 * @internal
 */
export function enableScenePickerDetail(picker: GpuPicker): void {
  enableDetailedPicking(picker);
}

/**
 * Releases a picker's GPU resources.
 *
 * @param picker - The picker to release.
 *
 * @internal
 */
export function disposeScenePicker(picker: GpuPicker): void {
  disposePicker(picker);
}
