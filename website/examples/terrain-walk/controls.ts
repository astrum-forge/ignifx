/**
 * The walker's input: one action map, and the gate that arms the mouse look only while the pointer
 * is down.
 *
 * `ThirdPersonController` reads `Move`, `Jump` and `Sprint` and `ThirdPersonCamera` reads `Look`,
 * all four by **name**, so an example only has to declare a map that carries them. A page cannot
 * lock the pointer the way a full-screen game does — the visitor has to be able to reach the
 * parameter panel — so `Look` is bound to `<Pointer>/delta` and switched off unless the pointer is
 * down or a stick is pushed.
 */

import { defineInputActions, Script } from "ignifx";
import type { InputActionsDefinition, ScriptCallbacks } from "ignifx";

/** Below this magnitude a stick counts as centred, and the mouse look stays switched off. */
const STICK_EPSILON = 0.001;

/** The actions the character and its camera read. */
export const PLAYER_ACTIONS: InputActionsDefinition = defineInputActions({
  maps: [
    {
      name: "Player",
      actions: [
        {
          name: "Move",
          type: "vector2",
          bindings: [
            {
              composite: "2DVector",
              up: "<Keyboard>/w",
              down: "<Keyboard>/s",
              left: "<Keyboard>/a",
              right: "<Keyboard>/d",
            },
            {
              composite: "2DVector",
              up: "<Keyboard>/arrowUp",
              down: "<Keyboard>/arrowDown",
              left: "<Keyboard>/arrowLeft",
              right: "<Keyboard>/arrowRight",
            },
            { path: "<Gamepad>/leftStick", processors: ["deadzone(0.2)"] },
            { path: "<Gamepad>/dpad" },
          ],
        },
        {
          name: "Look",
          type: "vector2",
          bindings: [{ path: "<Pointer>/delta" }, { path: "<Gamepad>/rightStick", processors: ["deadzone(0.2)"] }],
        },
        {
          name: "LookStick",
          type: "vector2",
          bindings: [{ path: "<Gamepad>/rightStick", processors: ["deadzone(0.2)"] }],
        },
        { name: "Drag", bindings: [{ path: "<Pointer>/press" }] },
        { name: "Jump", bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }] },
        { name: "Sprint", bindings: [{ path: "<Keyboard>/shiftLeft" }, { path: "<Gamepad>/leftStickPress" }] },
      ],
    },
  ],
});

/**
 * Arms the `Look` action only while the pointer is down or a stick is pushed.
 *
 * @remarks
 * A pointer action is masked for the frame while the UI overlay holds the pointer, so `Drag` reads
 * as released while a slider is being dragged — which is why dragging one never also turns the
 * camera.
 */
export class DragToLook extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "terrain-walk/DragToLook";

  /** Switches `Look` on and off for the frame. */
  update(): void {
    const look = this.app.input.actions.find("Look");
    if (look === null) {
      return;
    }
    const held = this.app.input.actions.find("Drag")?.isPressed ?? false;
    const stick = this.app.input.actions.find("LookStick")?.vector;
    const pushed = stick !== undefined && Math.hypot(stick.x, stick.y) > STICK_EPSILON;
    look.enabled = held || pushed;
  }
}
