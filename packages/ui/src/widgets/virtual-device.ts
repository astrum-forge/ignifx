import { uiError, UiErrorCode } from "../errors.js";
import type { App } from "@ignifx/core";

/**
 * How `@ignifx/ui` reaches `@ignifx/input`'s virtual device without importing it
 * (`docs/architecture/13-ui.md` §3, `08-input.md` §8).
 *
 * `@ignifx/input` is an **optional** peer: the overlay host, the text components, and the
 * localization service do not need it, and only the two touch widgets do. Importing it — even
 * `import type` — would pull its `declare module "@ignifx/core"` augmentation into every consumer's
 * program, so an app that installs `@ignifx/ui` alone would suddenly have a typed `app.input` that
 * does not exist at runtime. The device is therefore reached structurally: the two methods the
 * widgets call, found by name on `app.input.devices.virtual`.
 *
 * `VirtualDevice` satisfies {@link VirtualDeviceLike} exactly
 * (`packages/input/src/devices/virtual.ts`), so nothing is lost by not naming the class.
 */

/**
 * The part of `@ignifx/input`'s virtual device the touch widgets use.
 *
 * @remarks
 * Structural on purpose. A test passes a recording double; a game passes
 * `app.input.devices.virtual`.
 *
 * @public
 */
export interface VirtualDeviceLike {
  /**
   * Writes a scalar control, creating it when it does not exist.
   *
   * @param name - The control name, as it appears after `<Virtual>/`.
   * @param value - The new value.
   */
  set(name: string, value: number): void;
  /**
   * Writes a vector control, creating it when it does not exist.
   *
   * @param name - The control name.
   * @param x - The new x component.
   * @param y - The new y component.
   */
  setVector(name: string, x: number, y: number): void;
}

/**
 * Whether a value has the two methods {@link VirtualDeviceLike} declares.
 *
 * @param value - The candidate.
 * @returns `true` when both methods are functions.
 */
function isVirtualDevice(value: unknown): value is VirtualDeviceLike {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return typeof Reflect.get(value, "set") === "function" && typeof Reflect.get(value, "setVector") === "function";
}

/**
 * Finds `app.input.devices.virtual`, if `@ignifx/input` is registered.
 *
 * @param app - The running app.
 * @returns The device, or `null` when the input extension is not installed.
 *
 * @example
 * ```ts
 * const device = findVirtualDevice(app);
 * device?.setVector("joystick", 0, 1);
 * ```
 *
 * @public
 */
export function findVirtualDevice(app: App): VirtualDeviceLike | null {
  const input: unknown = Reflect.get(app, "input");
  if (input === null || typeof input !== "object") {
    return null;
  }
  const devices: unknown = Reflect.get(input, "devices");
  if (devices === null || typeof devices !== "object") {
    return null;
  }
  const virtual: unknown = Reflect.get(devices, "virtual");
  return isVirtualDevice(virtual) ? virtual : null;
}

/**
 * Finds the virtual device, or explains why the widget cannot work.
 *
 * @param app - The running app.
 * @param widget - The widget's name, for the error's context.
 * @returns The device.
 * @throws IgnifxError with code `IGX-1305` when `@ignifx/input` is not registered.
 *
 * @internal
 */
export function requireVirtualDevice(app: App, widget: string): VirtualDeviceLike {
  const device = findVirtualDevice(app);
  if (device === null) {
    throw uiError(UiErrorCode.inputExtensionMissing, `${widget} needs the @ignifx/input extension.`, {
      context: { widget },
      hint: "Add input() to createApp({ extensions }) before constructing the widget.",
    });
  }
  return device;
}

/**
 * Claims a pointer for an element, best effort.
 *
 * @remarks
 * `setPointerCapture` throws `NotFoundError` when the id names no *active* pointer — a pointer that
 * was already released, or a synthetic `PointerEvent` dispatched by a test. Capture is an
 * improvement, not a requirement: without it a drag that leaves the widget stops updating, and the
 * `pointerup` still arrives. Losing the frame over it would be worse than losing the capture.
 *
 * @param element - The element to capture on.
 * @param pointerId - The pointer to claim.
 *
 * @internal
 */
export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // See the remarks: capture is best effort.
  }
}
