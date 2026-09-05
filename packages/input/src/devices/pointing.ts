import { ControlKind } from "./control.js";
import { DeviceKind, InputDevice } from "./device.js";
import type { ControlSpec } from "./control.js";

/**
 * The three pointing devices of `docs/architecture/08-input.md` §3: the mouse, the unified
 * `Pointer` (mouse, pen, or the primary touch), and `Touch` with its ten slots.
 *
 * All three are fed from DOM **pointer** events. A browser that fires `touchstart` also fires
 * `pointerdown` with `pointerType === "touch"`, so one adapter serves every pointing device and
 * there is no double counting (`src/dom/pointer-source.ts` documents the decision).
 */

/**
 * How many simultaneous touches `Touch` tracks; `<Touch>/touch0` … `<Touch>/touch9`.
 *
 * @public
 */
export const TOUCH_SLOTS = 10;

/**
 * The mouse control names, in index order.
 *
 * @returns `leftButton`, `rightButton`, `middleButton`, `position`, `delta`, `scroll`.
 *
 * @public
 */
export function mouseControlNames(): readonly string[] {
  return ["leftButton", "rightButton", "middleButton", "position", "delta", "scroll"];
}

/**
 * Builds the mouse device.
 *
 * @returns The device behind `<Mouse>/…` paths.
 *
 * @public
 */
export function createMouseDevice(): InputDevice {
  return new InputDevice(DeviceKind.mouse, 0, [
    { name: "leftButton", kind: ControlKind.button },
    { name: "rightButton", kind: ControlKind.button },
    { name: "middleButton", kind: ControlKind.button },
    { name: "position", kind: ControlKind.vector2 },
    { name: "delta", kind: ControlKind.vector2 },
    { name: "scroll", kind: ControlKind.vector2 },
  ]);
}

/**
 * Builds the unified pointer device: whichever of mouse, pen, or first touch acted last.
 *
 * @returns The device behind `<Pointer>/…` paths.
 *
 * @public
 */
export function createPointerDevice(): InputDevice {
  return new InputDevice(DeviceKind.pointer, 0, [
    { name: "press", kind: ControlKind.button },
    { name: "position", kind: ControlKind.vector2 },
    { name: "delta", kind: ControlKind.vector2 },
  ]);
}

/**
 * The touch control names, in index order.
 *
 * @returns `primaryTouch/…`, `touch0/…` through `touch9/…`, and `touchCount`.
 *
 * @public
 */
export function touchControlNames(): readonly string[] {
  const names: string[] = ["primaryTouch/press", "primaryTouch/position", "primaryTouch/delta"];
  for (let slot = 0; slot < TOUCH_SLOTS; slot += 1) {
    names.push(`touch${String(slot)}/press`, `touch${String(slot)}/position`, `touch${String(slot)}/delta`);
  }
  names.push("touchCount");
  return names;
}

/**
 * Builds the touch device.
 *
 * @returns The device behind `<Touch>/…` paths.
 *
 * @public
 */
export function createTouchDevice(): InputDevice {
  const specs: ControlSpec[] = [];
  for (const name of touchControlNames()) {
    if (name === "touchCount") {
      specs.push({ name, kind: ControlKind.axis });
      continue;
    }
    specs.push({ name, kind: name.endsWith("/press") ? ControlKind.button : ControlKind.vector2 });
  }
  return new InputDevice(DeviceKind.touch, 0, specs);
}
