import { ControlKind } from "./control.js";
import { DeviceKind, InputDevice } from "./device.js";
import type { ControlDescriptor } from "./control.js";

/**
 * The synthetic device (`docs/architecture/08-input.md` §8). On-screen controls in `@ignifx/2d` and
 * `@ignifx/ui` feed it, and `<Virtual>/joystick`, `<Virtual>/buttonA` and friends bind to it like
 * any hardware control.
 *
 * Its control table grows: a control is created the first time a binding names it, or the first
 * time game code writes it. Growth reallocates the value array, which is why it happens at binding
 * time and never inside a frame's steady state (coding standards §7).
 */

/**
 * A device whose controls are created on demand.
 *
 * @example
 * ```ts
 * const stick = app.input.devices.virtual.declare("joystick", "vector2");
 * app.input.devices.virtual.setVector("joystick", 0, 1);
 * ```
 *
 * @public
 */
export class VirtualDevice extends InputDevice {
  /** Builds an empty virtual device. */
  constructor() {
    super(DeviceKind.virtual, 0, []);
  }

  /**
   * Returns the named control, creating it when the device does not have it yet.
   *
   * @param name - The control name, as it appears after `<Virtual>/`.
   * @param kind - What the control produces. Ignored when the control already exists.
   * @returns The descriptor.
   */
  declare(name: string, kind: ControlKind = ControlKind.button): ControlDescriptor {
    const existing = this.control(name);
    if (existing !== null) {
      return existing;
    }
    const appended = this.appendControls([{ name, kind }]);
    return appended[0] ?? { name, index: -1, offset: -1, kind, components: 1 };
  }

  /**
   * Writes a scalar control, creating it when it does not exist.
   *
   * @param name - The control name.
   * @param value - The new value.
   */
  set(name: string, value: number): void {
    this.write(this.declare(name, ControlKind.axis), value);
  }

  /**
   * Writes a vector control, creating it when it does not exist.
   *
   * @param name - The control name.
   * @param x - The new x component.
   * @param y - The new y component.
   */
  setVector(name: string, x: number, y: number): void {
    this.writeVector(this.declare(name, ControlKind.vector2), x, y);
  }
}
