/**
 * The playground's own input: a click on the floor, and a key that drops a body wherever.
 *
 * It is `@ignifx/input` actions rather than DOM listeners for the reason the whole kit is: a
 * visitor reading this sees what a game writes, and one binding on `<Pointer>` covers a mouse, a
 * pen and a finger with no branch per device.
 *
 * The map is the example's own, so the kit orbit camera's `KitOrbit` map is untouched —
 * `loadActions` merges documents by map name.
 */

import { Camera, clamp, createRay, defineInputActions, Script } from "ignifx";
import { ARENA_HALF } from "./arena.ts";
import type { InputActionsDefinition, ScriptCallbacks } from "ignifx";

/** How far a pointer may travel between press and release and still count as a click, in pixels. */
const CLICK_SLOP = 6;

/**
 * How steeply a ray must aim down to be resolved against the floor.
 *
 * @remarks
 * A ray along the horizon meets the `y = 0` plane a kilometre away, or behind the camera. Refusing
 * anything flatter than this is what keeps a click on the sky from dropping a crate at the edge of
 * the pit.
 */
const MIN_DOWNWARD = 0.05;

/** The actions the playground binds: a pointer press, the pointer's position, and a drop key. */
export const PLAYGROUND_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: "Playground",
      actions: [
        { name: "dropPress", type: "button", bindings: [{ path: "<Pointer>/press" }] },
        { name: "dropPoint", type: "vector2", bindings: [{ path: "<Pointer>/position" }] },
        {
          name: "dropKey",
          type: "button",
          bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }],
        },
      ],
    },
  ],
});

/**
 * Turns a click on the canvas into a point on the floor, and a key press into a drop.
 *
 * @remarks
 * A click and a camera drag start with the same `<Pointer>/press`, so this waits for the release
 * and only reports a point when the pointer travelled less than {@link CLICK_SLOP} pixels — which
 * is what stops an orbit from also dropping a crate. A press that lands on the parameter panel is
 * ignored through `app.input.uiHasPointer`, the flag `@ignifx/ui` raises for exactly this.
 *
 * Pointer positions are **backing-store pixels** (the canvas's `width`/`height`), which is the
 * space `Camera.screenToRay` reads, so no device-pixel-ratio conversion appears anywhere here.
 *
 * @example
 * ```ts
 * const controls = cameraEntity.addComponent(DropControls);
 * controls.onFloorClick = drop;
 * ```
 */
export class DropControls extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "physics-playground/DropControls";

  /** Called with the floor point a click landed on, in metres. Assigned after `addComponent`. */
  onFloorClick: ((x: number, z: number) => void) | null = null;

  /** Called when the drop key, or the gamepad's south button, was pressed. */
  onDropKey: (() => void) | null = null;

  /** Where the current gesture started, in backing-store pixels. */
  #pressX = 0;

  /** Where the current gesture started, in backing-store pixels. */
  #pressY = 0;

  /** Whether this gesture has travelled far enough to be a drag rather than a click. */
  #dragged = true;

  /** Reused so the per-frame path allocates nothing. */
  readonly #ray = createRay();

  /** Reads the drop key, then the press, the travel and the release of a pointer gesture. */
  update(): void {
    if (this.app.input.actions.find("dropKey")?.wasPressedThisFrame === true) {
      this.onDropKey?.();
    }
    const press = this.app.input.actions.find("dropPress");
    const point = this.app.input.actions.find("dropPoint");
    const camera = this.entity.getComponent(Camera);
    if (press === null || point === null || camera === null) {
      return;
    }
    if (press.wasPressedThisFrame) {
      this.#pressX = point.vector.x;
      this.#pressY = point.vector.y;
      this.#dragged = this.app.input.uiHasPointer;
    }
    if (Math.hypot(point.vector.x - this.#pressX, point.vector.y - this.#pressY) > CLICK_SLOP) {
      this.#dragged = true;
    }
    if (!press.wasReleasedThisFrame || this.#dragged) {
      return;
    }
    const ray = camera.screenToRay(point.vector.x, point.vector.y, this.#ray);
    if (ray === null || ray.direction.y > -MIN_DOWNWARD) {
      return;
    }
    const along = -ray.origin.y / ray.direction.y;
    this.onFloorClick?.(
      clamp(ray.origin.x + ray.direction.x * along, -ARENA_HALF, ARENA_HALF),
      clamp(ray.origin.z + ray.direction.z * along, -ARENA_HALF, ARENA_HALF),
    );
  }
}
