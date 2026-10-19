import { createGpuPicker, disposePicker, enableDetailedPicking, pickAsync } from "@babylonjs/lite";
import { readOwnerTag } from "../picking.js";
import type { PickAccept, PickedIdentity } from "../picking.js";
import type { GpuPicker, Mesh, PickIgnore, PickingInfo, PickOptions, SceneContext } from "@babylonjs/lite";

/**
 * GPU picking half of the Babylon Lite adapter (`docs/architecture/07-rendering.md` §3): the
 * pixel-exact pick behind `app.renderer.pickAsync`.
 *
 * Everything here is `@internal`.
 *
 * ## How the pick runs (verified against `@babylonjs/lite@1.27.0` `lib/picking/gpu-picker.js`, and
 * the coordinate handling again against 1.34.0)
 *
 * - `createGpuPicker(scene)` allocates nothing; the 1×1 pick targets and staging buffers are created
 *   on the first pick and reused, and they are re-created when the engine's device changes (after a
 *   device loss).
 * - The picker draws every candidate mesh into a one-pixel target with its identity in the colour
 *   attachment, then reads it back. `pickable === false` meshes and anything the `filter` predicate
 *   rejects are excluded from the candidate list entirely, so they neither occlude nor return.
 * - **Lite takes CSS pixels.** `pickAsync` multiplies `x` and `y` by `canvas.width / clientWidth`
 *   and `canvas.height / clientHeight` (`clientWidth || width` and `clientHeight || height`, so an
 *   `OffscreenCanvas` or a canvas with no layout box has a ratio of 1) before it does anything else
 *   (`lib/picking/gpu-picker.js` lines 186–195 in 1.34.0; `index.d.ts`: "CSS-space canvas
 *   coordinates"). ignifx speaks backing-store pixels, so {@link pickScenePixel} divides by the same
 *   ratio first and Lite's multiplication lands back on the caller's pixel.
 * - The pixel is mapped through the camera's **pixel** viewport, and a pick outside that viewport
 *   returns a miss rather than a clamped hit.
 * - Without detailed picking a hit still carries `pickedPoint` and `distance`: Lite reads the depth
 *   of the winning fragment back and unprojects it. Normals, `faceId` and barycentrics need
 *   {@link enableScenePickerDetail}. `subMeshId` is always `0`.
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
 * const hit = await pickScenePixel(picker, scene, 120, 80, null, []);
 * ```
 *
 * @internal
 */
export function createScenePicker(scene: SceneContext): GpuPicker {
  return createGpuPicker(scene);
}

/**
 * The ratio Lite's picker multiplies a CSS pixel by, on one axis.
 *
 * @param backing - The canvas's backing-store size on that axis.
 * @param client - Its CSS layout size, or `0` when it has none.
 * @returns `backing / (client || backing)`, exactly as Lite computes it, or `1` for an empty canvas.
 */
function liteScale(backing: number, client: number): number {
  const css = client || backing;
  return css > 0 && backing > 0 ? backing / css : 1;
}

/**
 * Converts a backing-store coordinate to the CSS coordinate Lite's picker multiplies back.
 *
 * @remarks
 * `x / scale * scale` can land one unit in the last place below `x`, and Lite floors the product to
 * choose a pixel, so a whole-pixel `x` could select the pixel before it. The result is nudged up
 * until Lite's product is not below `x`.
 *
 * @param value - The backing-store coordinate.
 * @param scale - Lite's ratio on that axis.
 * @returns The CSS coordinate.
 *
 * @internal
 */
export function toLitePickCoordinate(value: number, scale: number): number {
  if (scale === 1) {
    return value;
  }
  let css = value / scale;
  for (let attempt = 0; attempt < 4 && css * scale < value; attempt += 1) {
    css += Math.max(Math.abs(css) * Number.EPSILON, Number.MIN_VALUE);
  }
  return css;
}

/**
 * Picks the object under one backing-store pixel of the scene's canvas.
 *
 * @remarks
 * Coordinates are backing-store pixels — `canvas.width`/`height`, the space `Camera.worldToScreen`
 * and `<Pointer>/position` use. They are converted to the CSS pixels Lite's picker takes (see the
 * module notes). Meshes `accept` rejects, and the identities in `ignore`, neither occlude nor return.
 *
 * @param picker - The picker.
 * @param scene - The scene the picker was created for; its surface's canvas sets the ratio.
 * @param x - The backing-store pixel x, from the canvas's left edge.
 * @param y - The backing-store pixel y, from the canvas's top edge.
 * @param accept - Decides whether a mesh may be picked, from the ignifx tag that owns it, or `null`
 * to consider every mesh.
 * @param ignore - Earlier hits to look through; a thin-instance hit skips only that instance.
 * @returns The hit. Calls on one picker run one at a time.
 *
 * @example
 * ```ts
 * const picker = createScenePicker(scene);
 * const hit = await pickScenePixel(picker, scene, 120, 80, null, []);
 * ```
 *
 * @internal
 */
export function pickScenePixel(
  picker: GpuPicker,
  scene: SceneContext,
  x: number,
  y: number,
  accept: PickAccept | null,
  ignore: readonly PickedIdentity[],
): Promise<PickingInfo> {
  const canvas = scene.surface.canvas;
  const clientWidth = "clientWidth" in canvas ? canvas.clientWidth : 0;
  const clientHeight = "clientHeight" in canvas ? canvas.clientHeight : 0;
  const cssX = toLitePickCoordinate(x, liteScale(canvas.width, clientWidth));
  const cssY = toLitePickCoordinate(y, liteScale(canvas.height, clientHeight));
  const options: PickOptions = {};
  if (accept !== null) {
    options.filter = (mesh: Mesh): boolean => accept(readOwnerTag(mesh), mesh);
  }
  if (ignore.length > 0) {
    options.ignore = toLiteIgnore(ignore);
  }
  return pickAsync(picker, cssX, cssY, options);
}

/**
 * Folds earlier hits into Lite's ignore list, one entry per mesh.
 *
 * @remarks
 * Lite reads only the **first** entry it finds for a mesh (`lib/picking/picking-ignore.js`,
 * `forMesh`), so several hits on one mesh are merged here: a whole-mesh hit wins, thin instances
 * that form one contiguous run become a range, and otherwise the lowest index is kept — a Lite
 * 1.34 limit, which a caller cycling through instances of one renderer can meet.
 *
 * @param ignore - The hits to look through.
 * @returns Lite's entries.
 */
function toLiteIgnore(ignore: readonly PickedIdentity[]): PickIgnore[] {
  const byMesh = new Map<Mesh, number[] | null>();
  for (const identity of ignore) {
    const indices = byMesh.get(identity.mesh);
    if (identity.thinInstanceIndex < 0 || indices === null) {
      byMesh.set(identity.mesh, null);
    } else if (indices === undefined) {
      byMesh.set(identity.mesh, [identity.thinInstanceIndex]);
    } else {
      indices.push(identity.thinInstanceIndex);
    }
  }
  const entries: PickIgnore[] = [];
  for (const [mesh, indices] of byMesh) {
    if (indices === null) {
      entries.push({ mesh });
      continue;
    }
    const sorted = [...new Set(indices)].toSorted((a, b) => a - b);
    const first = sorted[0] ?? 0;
    const last = sorted.at(-1) ?? first;
    entries.push(
      sorted.length === 1 || last - first + 1 !== sorted.length
        ? { mesh, thinInstanceIndex: first }
        : { mesh, thinInstanceRange: { start: first, count: sorted.length } },
    );
  }
  return entries;
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
