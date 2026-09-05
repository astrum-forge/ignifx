import { createPhysicsViewer, disposePhysicsViewer, showPhysicsBody } from "@babylonjs/lite";
import type { LitePhysicsBody, LitePhysicsWorld } from "../havok.js";
import type { PhysicsViewer } from "@babylonjs/lite";
import type { LiteScene } from "@ignifx/core";

/**
 * The debug-viewer half of this package's Babylon Lite adapter
 * (`docs/architecture/09-physics.md` §9).
 *
 * `createPhysicsViewer(scene, world)` (`index.d.ts` 2909) draws wireframe bodies **into the scene it
 * is given**, and `showPhysicsBody` (11580) builds a `Mesh` per body — which needs a GPU device, so
 * the viewer targets the **render** scene and is refused on a headless app.
 *
 * The module sits under `src/lite/gpu/` for the same reason `@ignifx/core`'s does: every line of it
 * needs `engine._device`, so it is unreachable from the Vitest `node` project and is covered by the
 * browser one instead. `vitest.config.ts` already excludes every package's `src/lite/gpu`
 * directory from the unit-run coverage report.
 *
 * Everything here is `@internal`.
 */

/**
 * Lite's viewer handle.
 *
 * @internal
 */
export type LitePhysicsViewer = PhysicsViewer;

/**
 * Creates a viewer on the render scene.
 *
 * @param scene - The render scene the wireframes are drawn into.
 * @param world - The Havok world being visualised.
 * @returns The viewer handle.
 *
 * @internal
 */
export function createViewer(scene: LiteScene, world: LitePhysicsWorld): LitePhysicsViewer {
  return createPhysicsViewer(scene, world);
}

/**
 * Starts drawing one body.
 *
 * @param viewer - The viewer.
 * @param body - The body to show.
 *
 * @internal
 */
export function showBody(viewer: LitePhysicsViewer, body: LitePhysicsBody): void {
  showPhysicsBody(viewer, body);
}

/**
 * Disposes every debug mesh and unregisters the viewer's update hook.
 *
 * @param viewer - The viewer.
 *
 * @internal
 */
export function destroyViewer(viewer: LitePhysicsViewer): void {
  disposePhysicsViewer(viewer);
}
