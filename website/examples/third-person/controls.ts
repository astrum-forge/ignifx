import { defineInputActions, Script, VirtualButton, VirtualJoystick } from "ignifx";
import type { App, ScriptCallbacks } from "ignifx";

/**
 * Where the character's input comes from: one action map, one gate, and the on-screen controls.
 *
 * `ThirdPersonController` reads `Move`, `Jump` and `Sprint`; `ThirdPersonCamera` reads `Look`. All
 * four names are **fields** on those components — `controller.moveAction = "Walk"` then
 * `rebind()` — so a project renames them without subclassing, and an action no loaded map declares
 * is reported once as `IGX-1212` and then treated as absent.
 *
 * ## Why the mouse look is drag-gated
 *
 * A full-screen game binds `Look` to the mouse and locks the pointer. A frame on a web page cannot:
 * the visitor has to be able to reach the parameter panel, and a camera that spun every time the
 * mouse crossed the canvas would read as broken. So `Look` is bound to `<Pointer>/delta` and
 * {@link DragToLook} switches the whole action off unless the pointer is down or a stick is
 * pushed. `InputAction.enabled` is the switch — one assignment, and the action resolves to zero
 * with every binding on it left in place.
 *
 * A gamepad and a thumb pad need no gate, so {@link PLAYER_ACTIONS} carries a second action,
 * `LookStick`, whose only job is to say whether one of them is being pushed. It cannot be the
 * `Look` action itself: a disabled action reads as zero, so it could never re-arm itself.
 */

/** Below this magnitude a stick counts as centred, and the mouse look stays switched off. */
const STICK_EPSILON = 0.001;

/**
 * How far to the right of the safe area the two buttons sit, in CSS units.
 *
 * @remarks
 * Clear of the right thumb pad, which is 8 rem wide at its default radius.
 */
const BUTTON_RIGHT = "9.5rem";

/**
 * The action map the character and its camera read.
 *
 * @remarks
 * The two stick bindings carry a dead zone and nothing else. `ThirdPersonCamera` reads a stick as a
 * **rate** — `stickLookSpeed` degrees per second at full deflection — and a pointer delta as a
 * displacement in CSS pixels, and it normalises the pitch axis per device so that "up is up" on
 * both (`docs/architecture/12-3d-toolkit.md` §2.1, 2026-09-08). A `scale(…)` here would therefore
 * double-count the rate, and a sign flip would invert the stick against the mouse.
 */
export const PLAYER_ACTIONS = defineInputActions({
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
            { path: "<Virtual>/joystick", processors: ["deadzone(0.15)"] },
          ],
        },
        {
          name: "Look",
          type: "vector2",
          bindings: [
            { path: "<Pointer>/delta" },
            { path: "<Gamepad>/rightStick", processors: ["deadzone(0.2)"] },
            { path: "<Virtual>/look", processors: ["deadzone(0.15)"] },
          ],
        },
        {
          name: "LookStick",
          type: "vector2",
          bindings: [
            { path: "<Gamepad>/rightStick", processors: ["deadzone(0.2)"] },
            { path: "<Virtual>/look", processors: ["deadzone(0.15)"] },
          ],
        },
        { name: "Drag", bindings: [{ path: "<Pointer>/press" }] },
        {
          name: "Jump",
          bindings: [{ path: "<Keyboard>/space" }, { path: "<Gamepad>/buttonSouth" }, { path: "<Virtual>/jump" }],
        },
        {
          name: "Sprint",
          bindings: [
            { path: "<Keyboard>/shiftLeft" },
            { path: "<Gamepad>/leftStickPress" },
            { path: "<Virtual>/sprint" },
          ],
        },
      ],
    },
  ],
});

/**
 * Arms the `Look` action only while the pointer is down or a stick is pushed.
 *
 * @remarks
 * A pointer action is masked for the frame while the UI overlay holds the pointer
 * (`app.input.uiHasPointer`), so `Drag` reads as released while a slider or a thumb pad is being
 * dragged — which is why dragging one never also turns the camera, with nothing here to say so.
 * The flag lands one frame later, because actions resolve once at the top of a frame.
 */
export class DragToLook extends Script implements ScriptCallbacks {
  /** The namespaced registration id. */
  static typeId = "third-person/DragToLook";

  /** Reads this frame's gate and writes it onto the action the camera rig reads. */
  update(): void {
    const actions = this.app.input.actions;
    const look = actions.find("Look");
    const drag = actions.find("Drag");
    const stick = actions.find("LookStick");
    if (look === null || drag === null || stick === null) {
      return;
    }
    look.enabled = drag.isPressed || stick.magnitude > STICK_EPSILON;
  }
}

/**
 * Reports whether this device is likely to want on-screen controls.
 *
 * @returns `true` when the browser reports at least one touch point.
 */
export function hasTouch(): boolean {
  return navigator.maxTouchPoints > 0;
}

/**
 * Mounts two thumb pads and two buttons, which write the `<Virtual>/…` controls
 * {@link PLAYER_ACTIONS} already binds.
 *
 * @remarks
 * The widgets are `@ignifx/ui`'s, not this example's: they own the DOM, the safe area and the 44 px
 * touch targets, and nothing else in the example knows a touch happened.
 *
 * @param app - The running app; needs the `ui()` extension, which the kit always registers.
 * @returns The widgets, so a caller can dispose them.
 */
export function attachTouchControls(app: App): readonly { dispose(): void }[] {
  const bottom = "calc(1.5rem + var(--ignifx-safe-bottom, 0px))";
  return [
    new VirtualJoystick(app, { control: "joystick", style: { left: "1.5rem", bottom } }),
    new VirtualJoystick(app, { control: "look", style: { right: "1.5rem", bottom } }),
    new VirtualButton(app, { control: "jump", label: "▲", style: { right: BUTTON_RIGHT, bottom } }),
    new VirtualButton(app, { control: "sprint", label: "»", style: { right: BUTTON_RIGHT, bottom: "6.5rem" } }),
  ];
}
